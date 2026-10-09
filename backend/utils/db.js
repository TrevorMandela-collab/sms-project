const fs = require("fs");
const path = require("path");
const { AsyncLocalStorage } = require("async_hooks");
const { toCents } = require("./money");
const Database = require("better-sqlite3");
const { Pool } = require("pg");
const legacyMigration = require("../migrations/002_import_legacy_store");

const usePostgres = Boolean(process.env.DATABASE_URL);
const transactionStorage = new AsyncLocalStorage();
let pool = null;
let sqlite = null;
let schemaReady = null;
let sqliteLock = Promise.resolve();
let activeSqliteLock = null;

function integerSetting(name, fallback, minimum, maximum) {
  const value = process.env[name] === undefined ? fallback : Number(process.env[name]);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function logDatabaseError(operation, error) {
  const detail = error?.code || error?.name || "unknown database error";
  console.error(`[db] ${operation} failed (${detail}).`);
}

if (usePostgres) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: integerSetting("PG_POOL_MAX", 10, 1, 100),
    idleTimeoutMillis: integerSetting("PG_IDLE_TIMEOUT_MS", 30000, 1000, 300000),
    connectionTimeoutMillis: integerSetting(
      "PG_CONNECTION_TIMEOUT_MS",
      5000,
      100,
      120000,
    ),
  });
  pool.on("error", (error) => logDatabaseError("idle PostgreSQL client", error));
} else {
  const sqlitePath =
    process.env.SQLITE_PATH || path.join(__dirname, "..", "data", "sms.sqlite");
  fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });
  sqlite = new Database(sqlitePath, {
    timeout: integerSetting("SQLITE_BUSY_TIMEOUT_MS", 5000, 0, 120000),
  });
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma(`busy_timeout = ${integerSetting("SQLITE_BUSY_TIMEOUT_MS", 5000, 0, 120000)}`);
  console.warn(`[db] DATABASE_URL is not set; using SQLite at ${sqlitePath}`);
}

async function acquireSqliteLock() {
  let release;
  const previous = sqliteLock;
  sqliteLock = new Promise((resolve) => {
    release = resolve;
  });
  await previous;

  let finish;
  const lock = {
    done: new Promise((resolve) => {
      finish = resolve;
    }),
    finish: null,
    release: null,
  };
  lock.finish = finish;
  lock.release = release;
  activeSqliteLock = lock;
  return lock;
}

function releaseSqliteLock(lock) {
  if (activeSqliteLock === lock) activeSqliteLock = null;
  lock.finish();
  lock.release();
}

async function withSqliteAccess(operation) {
  const current = transactionStorage.getStore();
  if (current?.sqliteLock === activeSqliteLock) return operation();

  const lock = await acquireSqliteLock();
  try {
    return operation();
  } finally {
    releaseSqliteLock(lock);
  }
}

function queryPostgres(sql, values = []) {
  const current = transactionStorage.getStore();
  return (current?.client || pool).query(sql, values);
}

function normalizePostgresPlaceholders(sql) {
  if (!usePostgres || !sql.includes("?")) return sql;
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

function querySqlite(method, sql, values = []) {
  const execute = () => sqlite.prepare(sql)[method](...values);
  return withSqliteAccess(execute);
}

function mappingFor(collection) {
  return legacyMigration.mappings[collection] || null;
}

function decodeJson(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function recordFromRow(collection, row) {
  if (!row) return null;
  const mapping = mappingFor(collection);
  const record = decodeJson(row.extra_data) || {};
  for (const [apiField, definition] of Object.entries(mapping.fields)) {
    const column = Array.isArray(definition) ? definition[0] : definition;
    if (row[column] === undefined || row[column] === null) continue;
    let value = row[column];
    if (value instanceof Date) value = value.toISOString();
    if (Array.isArray(definition) && definition[1] === "json") value = decodeJson(value);
    if (Array.isArray(definition) && definition[1] === "boolean") value = Boolean(value);
    if (Array.isArray(definition) && ["integer", "number"].includes(definition[1])) {
      value = Number(value);
    }
    record[apiField] = value;
  }
  if (row.created_at !== undefined && row.created_at !== null) {
    record.createdAt =
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : row.created_at;
  }
  if (row.updated_at !== undefined && row.updated_at !== null) {
    record.updatedAt =
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : row.updated_at;
  }
  if (collection === "library-loans") {
    record.itemId = row.legacy_book_id;
  }
  if (collection === "timetable" && row.day_of_week) {
    record.day = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][row.day_of_week - 1];
  }
  if (collection === "audit-logs" && record.timestamp === undefined) {
    record.timestamp = record.createdAt;
  }
  if (collection === "password-resets") record.used = Boolean(row.used_at);
  return record;
}

function activeRecordClause(collection, prefix = "") {
  if (["users", "students", "teachers"].includes(collection)) {
    return ` AND ${prefix}deleted_at IS NULL`;
  }
  if (["schools", "classes", "subjects", "assignments", "exams", "fees", "library"].includes(collection)) {
    return ` AND ${prefix}archived_at IS NULL`;
  }
  if (["attendance", "assignment-submissions", "library-loans"].includes(collection)) {
    return ` AND ${prefix}archived_at IS NULL`;
  }
  return "";
}

function insertSql(table, values) {
  const columns = Object.keys(values);
  const placeholders = columns.map((_, index) =>
    usePostgres ? `$${index + 1}` : "?",
  );
  return `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders.join(", ")})`;
}

function encodeRelationalRecord(collection, record) {
  const values = legacyMigration.mapRecord(
    collection,
    record,
    usePostgres ? "postgres" : "sqlite",
  );
  if (collection === "fees") {
    values.issued_at =
      values.issued_at ||
      (usePostgres
        ? record.createdAt || new Date().toISOString()
        : record.createdAt || new Date().toISOString());
  }
  return values;
}

async function insertRelations(collection, record) {
  const stamp = record.createdAt || new Date().toISOString();
  const run = async (sql, values) => queryPostgres(sql, values);
  const runSqlite = async (sql, values) => querySqlite("run", sql, values);
  const execute = usePostgres ? run : runSqlite;
  const placeholder = (index) => usePostgres ? `$${index}` : "?";

  if (collection === "users") {
    await execute(
      `INSERT INTO user_roles (user_id, role_code, created_at) VALUES (${placeholder(1)}, ${placeholder(2)}, ${placeholder(3)})`,
      [record.id, record.role, stamp],
    );
    if (record.role === "parent") {
      const guardian = {
        id: `guardian:${record.id}`,
        school_id: record.schoolId,
        user_id: record.id,
        name: record.name,
        email: record.email || null,
        phone: record.phone || null,
        created_at: stamp,
        updated_at: record.updatedAt || stamp,
        extra_data: usePostgres ? {} : "{}",
      };
      await execute(insertSql("guardians", guardian), Object.values(guardian));
      for (const studentId of new Set(Array.isArray(record.childIds) ? record.childIds : [])) {
        await execute(
          `INSERT INTO guardian_students (guardian_id, student_id, relationship, created_at) VALUES (${placeholder(1)}, ${placeholder(2)}, ${placeholder(3)}, ${placeholder(4)})`,
          [guardian.id, studentId, null, stamp],
        );
      }
    }
  }

  if (collection === "chats") {
    for (const userId of new Set(Array.isArray(record.memberIds) ? record.memberIds : [])) {
      await execute(
        `INSERT INTO chat_members (chat_id, user_id, created_at) VALUES (${placeholder(1)}, ${placeholder(2)}, ${placeholder(3)})`,
        [record.id, userId, stamp],
      );
    }
  }

  if (collection === "classes") {
    for (const subjectId of new Set(Array.isArray(record.subjectIds) ? record.subjectIds : [])) {
      await execute(
        `INSERT INTO class_subjects (class_id, subject_id, created_at) VALUES (${placeholder(1)}, ${placeholder(2)}, ${placeholder(3)})`,
        [record.id, subjectId, stamp],
      );
    }
    for (const teacherId of new Set(Array.isArray(record.teacherIds) ? record.teacherIds : [])) {
      const assignment = {
        id: `legacy-assignment:${record.id}:${teacherId}`,
        school_id: record.schoolId,
        teacher_id: teacherId,
        class_id: record.id,
        subject_id: null,
        academic_year_id: null,
        created_at: stamp,
        updated_at: record.updatedAt || stamp,
      };
      await execute(
        insertSql("teacher_assignments", assignment),
        Object.values(assignment),
      );
    }
  }
}

async function synchronizeRelations(collection, record, previous) {
  const execute = (sql, values) =>
    usePostgres
      ? queryPostgres(sql, values)
      : querySqlite("run", sql, values);
  const placeholder = (index) => usePostgres ? `$${index}` : "?";

  if (collection === "users" && record.role !== previous.role) {
    await execute(
      `DELETE FROM user_roles WHERE user_id = ${placeholder(1)}`,
      [record.id],
    );
    await execute(
      `INSERT INTO user_roles (user_id, role_code, created_at) VALUES (${placeholder(1)}, ${placeholder(2)}, ${placeholder(3)})`,
      [record.id, record.role, record.updatedAt || new Date().toISOString()],
    );
  }

  if (
    collection === "users" &&
    record.role === "parent" &&
    JSON.stringify(record.childIds || []) !== JSON.stringify(previous.childIds || [])
  ) {
    const guardianId = `guardian:${record.id}`;
    const guardian = {
      id: guardianId,
      school_id: record.schoolId,
      user_id: record.id,
      name: record.name,
      email: record.email || null,
      phone: record.phone || null,
      created_at: record.createdAt,
      updated_at: record.updatedAt || record.createdAt,
      extra_data: usePostgres ? {} : "{}",
    };
    const existingGuardian = usePostgres
      ? (await queryPostgres("SELECT id FROM guardians WHERE id = $1", [guardianId])).rows[0]
      : await querySqlite("get", "SELECT id FROM guardians WHERE id = ?", [guardianId]);
    if (existingGuardian) {
      await execute(
        `UPDATE guardians SET name = ${placeholder(1)}, email = ${placeholder(2)}, phone = ${placeholder(3)}, updated_at = ${placeholder(4)} WHERE id = ${placeholder(5)}`,
        [guardian.name, guardian.email, guardian.phone, guardian.updated_at, guardianId],
      );
    } else {
      await execute(insertSql("guardians", guardian), Object.values(guardian));
    }
    await execute(
      `DELETE FROM guardian_students WHERE guardian_id = ${placeholder(1)}`,
      [guardianId],
    );
    for (const studentId of new Set(Array.isArray(record.childIds) ? record.childIds : [])) {
      await execute(
        `INSERT INTO guardian_students (guardian_id, student_id, relationship, created_at) VALUES (${placeholder(1)}, ${placeholder(2)}, ${placeholder(3)}, ${placeholder(4)})`,
        [guardianId, studentId, null, record.updatedAt || record.createdAt],
      );
    }
  }

  if (collection === "chats" && JSON.stringify(record.memberIds || []) !== JSON.stringify(previous.memberIds || [])) {
    await execute(
      `DELETE FROM chat_members WHERE chat_id = ${placeholder(1)}`,
      [record.id],
    );
    for (const userId of new Set(Array.isArray(record.memberIds) ? record.memberIds : [])) {
      await execute(
        `INSERT INTO chat_members (chat_id, user_id, created_at) VALUES (${placeholder(1)}, ${placeholder(2)}, ${placeholder(3)})`,
        [record.id, userId, record.updatedAt || record.createdAt],
      );
    }
  }

  if (collection === "classes") {
    await execute(
      `DELETE FROM class_subjects WHERE class_id = ${placeholder(1)}`,
      [record.id],
    );
    for (const subjectId of new Set(Array.isArray(record.subjectIds) ? record.subjectIds : [])) {
      await execute(
        `INSERT INTO class_subjects (class_id, subject_id, created_at) VALUES (${placeholder(1)}, ${placeholder(2)}, ${placeholder(3)})`,
        [record.id, subjectId, record.updatedAt || record.createdAt],
      );
    }
    await execute(
      `DELETE FROM teacher_assignments WHERE id LIKE ${placeholder(1)}`,
      [`legacy-assignment:${record.id}:%`],
    );
    for (const teacherId of new Set(Array.isArray(record.teacherIds) ? record.teacherIds : [])) {
      const assignment = {
        id: `legacy-assignment:${record.id}:${teacherId}`,
        school_id: record.schoolId,
        teacher_id: teacherId,
        class_id: record.id,
        subject_id: null,
        academic_year_id: null,
        created_at: record.updatedAt || record.createdAt,
        updated_at: record.updatedAt || record.createdAt,
      };
      await execute(insertSql("teacher_assignments", assignment), Object.values(assignment));
    }
  }
}

async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      if (usePostgres) {
        await queryPostgres(`
          CREATE TABLE IF NOT EXISTS schema_migrations (
            version TEXT PRIMARY KEY,
            applied_at TIMESTAMPTZ NOT NULL
          );
        `);
      } else {
        await querySqlite(
          "run",
          `CREATE TABLE IF NOT EXISTS schema_migrations (
            version TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL
          )`,
        );
      }
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

async function transaction(work) {
  if (typeof work !== "function") {
    throw new TypeError("transaction requires a callback.");
  }
  await ensureSchema();

  const current = transactionStorage.getStore();
  if (current) {
    const savepoint = `nested_${++current.savepointCount}`;
    if (usePostgres) {
      await current.client.query(`SAVEPOINT ${savepoint}`);
    } else {
      sqlite.exec(`SAVEPOINT ${savepoint}`);
    }
    try {
      const result = await work();
      if (usePostgres) {
        await current.client.query(`RELEASE SAVEPOINT ${savepoint}`);
      } else {
        sqlite.exec(`RELEASE SAVEPOINT ${savepoint}`);
      }
      return result;
    } catch (error) {
      try {
        if (usePostgres) {
          await current.client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
          await current.client.query(`RELEASE SAVEPOINT ${savepoint}`);
        } else {
          sqlite.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
          sqlite.exec(`RELEASE SAVEPOINT ${savepoint}`);
        }
      } catch (rollbackError) {
        logDatabaseError("nested transaction rollback", rollbackError);
      }
      throw error;
    }
  }

  if (usePostgres) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      return await transactionStorage.run(
        { client, savepointCount: 0 },
        async () => {
          try {
            const result = await work();
            await client.query("COMMIT");
            return result;
          } catch (error) {
            try {
              await client.query("ROLLBACK");
            } catch (rollbackError) {
              logDatabaseError("transaction rollback", rollbackError);
            }
            throw error;
          }
        },
      );
    } finally {
      client.release();
    }
  }

  const lock = await acquireSqliteLock();
  try {
    sqlite.exec("BEGIN IMMEDIATE");
    return await transactionStorage.run(
      { sqliteLock: lock, savepointCount: 0 },
      async () => {
        try {
          const result = await work();
          sqlite.exec("COMMIT");
          return result;
        } catch (error) {
          try {
            sqlite.exec("ROLLBACK");
          } catch (rollbackError) {
            logDatabaseError("transaction rollback", rollbackError);
          }
          throw error;
        }
      },
    );
  } finally {
    releaseSqliteLock(lock);
  }
}

async function execute(sql, values = []) {
  await ensureSchema();
  if (usePostgres) return queryPostgres(normalizePostgresPlaceholders(sql), values);
  return querySqlite("run", sql, values);
}

async function all(sql, values = []) {
  await ensureSchema();
  if (usePostgres) {
    const result = await queryPostgres(normalizePostgresPlaceholders(sql), values);
    return result.rows;
  }
  return querySqlite("all", sql, values);
}

async function migrate() {
  await ensureSchema();
  const migrationsDirectory = path.join(__dirname, "..", "migrations");
  const migrations = fs
    .readdirSync(migrationsDirectory)
    .filter((filename) => /^\d{3,}_[a-z0-9_-]+\.js$/i.test(filename))
    .sort((left, right) => left.localeCompare(right));
  const migrationVersions = migrations.map((filename) =>
    filename.slice(0, filename.indexOf("_")),
  );
  if (new Set(migrationVersions).size !== migrationVersions.length) {
    throw new Error("Migration filenames must use unique version numbers.");
  }
  const appliedRows = await all("SELECT version FROM schema_migrations ORDER BY version");
  const applied = new Set(appliedRows.map((row) => row.version));
  const unknownApplied = [...applied].filter(
    (version) => !migrationVersions.includes(version),
  );
  if (unknownApplied.length) {
    throw new Error(
      `Database contains migrations not present in this release: ${unknownApplied.join(", ")}.`,
    );
  }

  for (const filename of migrations) {
    const migration = require(path.join(migrationsDirectory, filename));
    const version = filename.slice(0, filename.indexOf("_"));
    if (applied.has(version)) continue;
    if (typeof migration.up !== "function") {
      throw new Error(`Migration ${version} does not export an up function.`);
    }
    try {
      await transaction(async () => {
        await migration.up({
          execute,
          all,
          transaction,
          dialect: usePostgres ? "postgres" : "sqlite",
        });
        const appliedAt = new Date().toISOString();
        if (usePostgres) {
          await execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES ($1, $2)",
            [version, appliedAt],
          );
        } else {
          await execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
            [version, appliedAt],
          );
        }
      });
      console.log(`[db] Applied migration ${version}.`);
    } catch (error) {
      logDatabaseError(`migration ${version}`, error);
      console.error(`[db] Migration ${version} details: ${error.message}`);
      throw new Error(`Database migration ${version} failed; no migration data was committed.`);
    }
  }
  return (await all("SELECT version FROM schema_migrations ORDER BY version")).map(
    (row) => row.version,
  );
}

async function readAll(collection) {
  await ensureSchema();
  const mapping = mappingFor(collection);
  if (!mapping) {
    throw new TypeError(`No relational mapping exists for ${collection}.`);
  }
  const select =
    collection === "library-loans"
      ? `SELECT library_loans.*, library_copies.book_id AS legacy_book_id, library_books.title AS legacy_book_title FROM library_loans JOIN library_copies ON library_copies.id = library_loans.copy_id JOIN library_books ON library_books.id = library_copies.book_id WHERE 1 = 1${activeRecordClause(collection, "library_loans.")}`
      : `SELECT * FROM ${mapping.table} WHERE 1 = 1${activeRecordClause(collection)}`;
  const rows = usePostgres
    ? (await queryPostgres(select)).rows
    : await querySqlite("all", select);
  return rows.map((row) => recordFromRow(collection, row));
}

async function readBySchool(collection, schoolId) {
  await ensureSchema();
  const mapping = mappingFor(collection);
  if (!mapping || !mapping.fields.schoolId) {
    throw new TypeError(`${collection} does not support school-scoped reads.`);
  }
  const prefix = collection === "library-loans" ? "library_loans." : "";
  const select =
    collection === "library-loans"
      ? `SELECT library_loans.*, library_copies.book_id AS legacy_book_id, library_books.title AS legacy_book_title FROM library_loans JOIN library_copies ON library_copies.id = library_loans.copy_id JOIN library_books ON library_books.id = library_copies.book_id WHERE library_loans.school_id = $1${activeRecordClause(collection, prefix)}`
      : `SELECT * FROM ${mapping.table} WHERE school_id = $1${activeRecordClause(collection)}`;
  const sqliteSelect = select.replace("$1", "?");
  const rows = usePostgres
    ? (await queryPostgres(select, [schoolId])).rows
    : await querySqlite("all", sqliteSelect, [schoolId]);
  return rows.map((row) => recordFromRow(collection, row));
}

async function findByIds(collection, ids, schoolId) {
  await ensureSchema();
  const mapping = mappingFor(collection);
  if (!mapping) {
    throw new TypeError(`No relational mapping exists for ${collection}.`);
  }
  const uniqueIds = [...new Set(ids.filter((id) => typeof id === "string" && id.length))];
  if (!uniqueIds.length) return [];
  if (uniqueIds.length > 900) {
    throw new RangeError("At most 900 IDs can be queried at once.");
  }
  const values = [...uniqueIds];
  const placeholders = uniqueIds.map((_, index) =>
    usePostgres ? `$${index + 1}` : "?",
  );
  const where = [`id IN (${placeholders.join(", ")})`];
  if (schoolId !== undefined && mapping.fields.schoolId) {
    values.push(schoolId);
    where.push(`school_id = ${usePostgres ? `$${values.length}` : "?"}`);
  }
  const activeClause = activeRecordClause(collection);
  const whereSql = `WHERE ${where.join(" AND ")}${activeClause}`;
  const rows = usePostgres
    ? (await queryPostgres(
        `SELECT * FROM ${mapping.table} ${whereSql}`,
        values,
      )).rows
    : await querySqlite("all", `SELECT * FROM ${mapping.table} ${whereSql}`, values);
  return rows.map((row) => recordFromRow(collection, row));
}

async function count(collection) {
  await ensureSchema();
  const mapping = mappingFor(collection);
  if (!mapping) {
    throw new TypeError(`No relational mapping exists for ${collection}.`);
  }
  const result = usePostgres
    ? await queryPostgres(`SELECT COUNT(*) AS total FROM ${mapping.table}`)
    : await querySqlite("get", `SELECT COUNT(*) AS total FROM ${mapping.table}`);
  return Number(usePostgres ? result.rows[0].total : result.total);
}

async function findUserByEmail(email, { includeDeleted = false } = {}) {
  await ensureSchema();
  const deletedClause = includeDeleted ? "" : " AND deleted_at IS NULL";
  const rows = usePostgres
    ? (await queryPostgres(
        `SELECT * FROM users WHERE lower(email) = lower($1)${deletedClause} LIMIT 1`,
        [email],
      )).rows
    : [
        await querySqlite(
          "get",
          `SELECT * FROM users WHERE lower(email) = lower(?)${deletedClause} LIMIT 1`,
          [email],
        ),
      ].filter(Boolean);
  return recordFromRow("users", rows[0]);
}

async function findInviteByCode(code) {
  await ensureSchema();
  const rows = usePostgres
    ? (await queryPostgres(
        "SELECT * FROM invite_codes WHERE upper(code) = upper($1) LIMIT 1",
        [code],
      )).rows
    : [
        await querySqlite(
          "get",
          "SELECT * FROM invite_codes WHERE upper(code) = upper(?) LIMIT 1",
          [code],
        ),
      ].filter(Boolean);
  return recordFromRow("invite-codes", rows[0]);
}

async function findChatByInviteCode(schoolId, code) {
  await ensureSchema();
  const rows = usePostgres
    ? (await queryPostgres(
        "SELECT * FROM chats WHERE school_id = $1 AND upper(invite_code) = upper($2) LIMIT 1",
        [schoolId, code],
      )).rows
    : [
        await querySqlite(
          "get",
          "SELECT * FROM chats WHERE school_id = ? AND upper(invite_code) = upper(?) LIMIT 1",
          [schoolId, code],
        ),
      ].filter(Boolean);
  return recordFromRow("chats", rows[0]);
}

async function readByChatId(chatId) {
  await ensureSchema();
  const rows = usePostgres
    ? (await queryPostgres(
        "SELECT * FROM chat_messages WHERE chat_id = $1 ORDER BY created_at ASC, id ASC",
        [chatId],
      )).rows
    : await querySqlite(
        "all",
        "SELECT * FROM chat_messages WHERE chat_id = ? ORDER BY created_at ASC, id ASC",
        [chatId],
      );
  return rows.map((row) => recordFromRow("chat-messages", row));
}

async function markPasswordResetsUsed(userId, usedAt) {
  await ensureSchema();
  if (usePostgres) {
    const result = await queryPostgres(
      "UPDATE password_resets SET used_at = $1, updated_at = $1 WHERE user_id = $2 AND used_at IS NULL",
      [usedAt, userId],
    );
    return result.rowCount;
  }
  const result = await querySqlite(
    "run",
    "UPDATE password_resets SET used_at = ?, updated_at = ? WHERE user_id = ? AND used_at IS NULL",
    [usedAt, usedAt, userId],
  );
  return result.changes;
}

async function createInvoiceWithItems(invoice, items) {
  const invoiceCents = toCents(invoice?.amount);
  if (
    !invoice?.id ||
    !invoice.schoolId ||
    !invoice.studentId ||
    invoiceCents === null
  ) {
    throw new TypeError("Invoice ID, school, student, and a non-negative amount with at most two decimal places are required.");
  }
  if (!Array.isArray(items)) {
    throw new TypeError("Invoice items must be an array.");
  }
  for (const item of items) {
    if (
      !item.id ||
      typeof item.description !== "string" ||
      !item.description.trim() ||
      !Number.isFinite(Number(item.quantity ?? 1)) ||
      Number(item.quantity ?? 1) <= 0 ||
      toCents(item.unitAmount) === null
    ) {
      throw new TypeError("Invoice items require an ID, description, positive quantity, and a non-negative unit amount with at most two decimal places.");
    }
  }

  return transaction(async () => {
    const normalizedInvoice = { ...invoice, amount: invoiceCents / 100 };
    await insert("fees", normalizedInvoice);
    const createdAt = invoice.createdAt || new Date().toISOString();
    for (const item of items) {
      const values = {
        id: item.id,
        invoice_id: invoice.id,
        fee_structure_id: item.feeStructureId || null,
        description: item.description.trim(),
        quantity: Number(item.quantity ?? 1),
        unit_amount: toCents(item.unitAmount) / 100,
        created_at: item.createdAt || createdAt,
        updated_at: item.updatedAt || item.createdAt || createdAt,
      };
      const sql = insertSql("invoice_items", values);
      if (usePostgres) await queryPostgres(sql, Object.values(values));
      else await querySqlite("run", sql, Object.values(values));
    }
    return { ...normalizedInvoice, items };
  });
}

async function recordPaymentWithAllocations(payment, allocations) {
  if (
    !payment?.id ||
    !payment.schoolId ||
    !payment.studentId ||
    typeof payment.reference !== "string" ||
    !payment.reference.trim()
  ) {
    throw new TypeError("Payment ID, school, student, and reference are required.");
  }
  if (!Array.isArray(allocations)) {
    throw new TypeError("Payment allocations must be an array.");
  }
  const paymentCents = toCents(payment.amount);
  const allocationCents = allocations.map((allocation) =>
    toCents(allocation.amount),
  );
  if (
    paymentCents === null ||
    paymentCents <= 0 ||
    allocations.some(
      (allocation, index) =>
        !allocation.id ||
        !allocation.invoiceId ||
        allocationCents[index] === null ||
        allocationCents[index] <= 0,
    ) ||
    allocationCents.reduce((total, cents) => total + cents, 0) > paymentCents
  ) {
    throw new TypeError("Payment amount and allocations are invalid.");
  }
  if (new Set(allocations.map((allocation) => allocation.invoiceId)).size !== allocations.length) {
    throw new TypeError("A payment may allocate to an invoice only once.");
  }

  return transaction(async () => {
    const placeholder = (index) => usePostgres ? `$${index}` : "?";
    for (const allocation of [...allocations].sort((left, right) =>
      left.invoiceId.localeCompare(right.invoiceId),
    )) {
      const values = [allocation.invoiceId, payment.schoolId, payment.studentId];
      const lock = usePostgres ? " FOR UPDATE" : "";
      const sql = `SELECT id, amount FROM invoices WHERE id = ${placeholder(1)} AND school_id = ${placeholder(2)} AND student_id = ${placeholder(3)}${lock}`;
      const invoice = usePostgres
        ? (await queryPostgres(sql, values)).rows[0]
        : await querySqlite("get", sql, values);
      if (!invoice) {
        throw new Error("Payment allocation invoice was not found for this student and school.");
      }
      const allocatedSql = `SELECT COALESCE(SUM(amount), 0) AS total FROM payment_allocations WHERE invoice_id = ${placeholder(1)}`;
      const allocated = usePostgres
        ? (await queryPostgres(allocatedSql, [allocation.invoiceId])).rows[0].total
        : (await querySqlite("get", allocatedSql, [allocation.invoiceId])).total;
      const remainingCents = toCents(invoice.amount) - toCents(allocated);
      if (toCents(allocation.amount) > remainingCents) {
        const error = new Error("Payment allocation exceeds the invoice balance.");
        error.statusCode = 409;
        error.code = "INVOICE_BALANCE_EXCEEDED";
        throw error;
      }
    }

    const values = {
      id: payment.id,
      school_id: payment.schoolId,
      student_id: payment.studentId,
      reference: payment.reference,
      amount: paymentCents / 100,
      method: payment.method || null,
      paid_at: payment.paidAt || new Date().toISOString(),
      created_at: payment.createdAt || new Date().toISOString(),
      updated_at: payment.updatedAt || payment.createdAt || new Date().toISOString(),
      extra_data: usePostgres
        ? payment.extraData || {}
        : JSON.stringify(payment.extraData || {}),
    };
    const insertPayment = insertSql("payments", values);
    if (usePostgres) await queryPostgres(insertPayment, Object.values(values));
    else await querySqlite("run", insertPayment, Object.values(values));

    const createdAt = payment.createdAt || new Date().toISOString();
    for (const allocation of allocations) {
      const allocationValues = {
        id: allocation.id,
        payment_id: payment.id,
        invoice_id: allocation.invoiceId,
        amount: toCents(allocation.amount) / 100,
        created_at: allocation.createdAt || createdAt,
      };
      const insertAllocation = insertSql("payment_allocations", allocationValues);
      if (usePostgres) {
        await queryPostgres(insertAllocation, Object.values(allocationValues));
      } else {
        await querySqlite("run", insertAllocation, Object.values(allocationValues));
      }
    }
    return {
      ...payment,
      amount: paymentCents / 100,
      allocations: allocations.map((allocation, index) => ({
        ...allocation,
        amount: allocationCents[index] / 100,
      })),
    };
  });
}

function columnExpression(collection, field) {
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(field)) {
  throw new TypeError("Invalid database field selector.");
  }
  if (field === "createdAt") return "created_at";
  if (field === "updatedAt") return "updated_at";
  const mapping = mappingFor(collection);
  const definition = mapping?.fields[field];
  if (definition) return Array.isArray(definition) ? definition[0] : definition;
  const jsonKey = field.replace(/'/g, "''");
  return usePostgres
  ? `extra_data ->> '${jsonKey}'`
  : `json_extract(extra_data, '$.${jsonKey}')`;
}

async function listPage(collection, {
  schoolId,
  page = 1,
  limit = 25,
  filters = {},
  rangeFilters = {},
  search = "",
  searchFields = [],
  sortField = "",
  descending = false,
} = {}) {
  await ensureSchema();
  const mapping = mappingFor(collection);
  if (!mapping) throw new TypeError(`No relational mapping exists for ${collection}.`);
  const values = [];
  const where = [];
  const addParameter = (value) => {
  values.push(value);
  return usePostgres ? `$${values.length}` : "?";
  };

  if (schoolId && collection !== "schools") {
  where.push(`school_id = ${addParameter(schoolId)}`);
  }
  const deletedColumn = ["users", "students", "teachers"].includes(collection)
  ? "deleted_at"
  : ["schools", "classes", "subjects", "assignments", "exams", "fees", "library", "attendance", "assignment-submissions", "library-loans"].includes(collection)
    ? "archived_at"
    : null;
  if (deletedColumn) where.push(`${deletedColumn} IS NULL`);

  for (const [field, value] of Object.entries(filters)) {
  if (value === undefined || value === null || value === "") continue;
  where.push(`${columnExpression(collection, field)} = ${addParameter(String(value))}`);
  }
  for (const [field, range] of Object.entries(rangeFilters)) {
  const expression = columnExpression(collection, field);
  if (range?.from !== undefined && range.from !== null) {
    where.push(`${expression} >= ${addParameter(range.from)}`);
  }
  if (range?.to !== undefined && range.to !== null) {
    where.push(`${expression} <= ${addParameter(range.to)}`);
  }
  }
  const normalizedSearch = String(search).trim().toLowerCase();
  if (normalizedSearch && searchFields.length) {
  where.push(
    `(${searchFields.map((field) => `LOWER(COALESCE(${columnExpression(collection, field)}, '')) LIKE ${addParameter(`%${normalizedSearch}%`)}`).join(" OR ")})`,
  );
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const countResult = usePostgres
  ? await queryPostgres(`SELECT COUNT(*) AS total FROM ${mapping.table} ${whereSql}`, values)
  : await querySqlite("get", `SELECT COUNT(*) AS total FROM ${mapping.table} ${whereSql}`, values);
  const total = Number(usePostgres ? countResult.rows[0].total : countResult.total);
  const order = sortField
  ? columnExpression(collection, sortField)
  : "created_at";
  const orderDirection = descending ? "DESC" : "ASC";
  const pageValues = [...values, limit, (page - 1) * limit];
  const limitPlaceholder = usePostgres
    ? `$${pageValues.length - 1}`
    : "?";
  const offsetPlaceholder = usePostgres
    ? `$${pageValues.length}`
    : "?";
  const rows = usePostgres
  ? (await queryPostgres(
      `SELECT * FROM ${mapping.table} ${whereSql} ORDER BY ${order} ${orderDirection}, id ASC LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
      pageValues,
    )).rows
  : await querySqlite(
      "all",
      `SELECT * FROM ${mapping.table} ${whereSql} ORDER BY ${order} ${orderDirection}, id ASC LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
      pageValues,
    );
  return {
  data: rows.map((row) => recordFromRow(collection, row)),
  meta: {
    page,
    limit,
    total,
    pages: Math.ceil(total / limit),
  },
  };
}

async function findById(collection, id, { forUpdate = false } = {}) {
  await ensureSchema();
  const mapping = mappingFor(collection);
  if (!mapping) {
    throw new TypeError(`No relational mapping exists for ${collection}.`);
  }
  const lockClause = usePostgres && forUpdate ? " FOR UPDATE" : "";
  const select =
    collection === "library-loans"
      ? `SELECT library_loans.*, library_copies.book_id AS legacy_book_id, library_books.title AS legacy_book_title FROM library_loans JOIN library_copies ON library_copies.id = library_loans.copy_id JOIN library_books ON library_books.id = library_copies.book_id WHERE library_loans.id = $1 AND library_loans.archived_at IS NULL${lockClause}`
      : `SELECT * FROM ${mapping.table} WHERE id = $1${activeRecordClause(collection)}${lockClause}`;
  const sqliteSelect = select.replace("$1", "?");
  const rows = usePostgres
    ? (await queryPostgres(select, [id])).rows
    : [await querySqlite("get", sqliteSelect, [id])].filter(Boolean);
  return recordFromRow(collection, rows[0]);
}

async function insert(collection, record) {
  await ensureSchema();
  const mapping = mappingFor(collection);
  if (!mapping) {
    throw new TypeError(`No relational mapping exists for ${collection}.`);
  }
  return transaction(async () => {
    const values = encodeRelationalRecord(collection, record);
    const bookId = values.book_id;
    delete values.book_id;
    if (collection === "library-loans" && bookId) {
      if (!record.returnedDate) {
        await changeAvailableCopies(bookId, record.schoolId, -1);
      }
      const copy = {
        id: values.copy_id,
        school_id: values.school_id,
        book_id: bookId,
        status: record.returnedDate ? "available" : "loaned",
        created_at: values.created_at,
        updated_at: values.updated_at,
      };
      await (usePostgres
        ? queryPostgres(insertSql("library_copies", copy), Object.values(copy))
        : querySqlite("run", insertSql("library_copies", copy), Object.values(copy)));
    }
    await (usePostgres
      ? queryPostgres(insertSql(mapping.table, values), Object.values(values))
      : querySqlite("run", insertSql(mapping.table, values), Object.values(values)));
    await insertRelations(collection, record);
    return record;
  });
}

async function changeAvailableCopies(bookId, schoolId, change) {
  const placeholder = (index) => usePostgres ? `$${index}` : "?";
  const condition =
    change < 0 ? "copies_available > 0" : "copies_available < copies_total";
  const sql = `UPDATE library_books
    SET copies_available = copies_available + ${change}, updated_at = ${placeholder(1)}
    WHERE id = ${placeholder(2)} AND school_id = ${placeholder(3)} AND ${condition}`;
  const values = [new Date().toISOString(), bookId, schoolId];
  const result = usePostgres
    ? await queryPostgres(`${sql} RETURNING id`, values)
    : await querySqlite("run", sql, values);
  const changed = usePostgres ? result.rowCount : result.changes;
  if (!changed) {
    const error = new Error(
      change < 0
        ? "No available copy remains for this book."
        : "Available-copy count cannot exceed the book's total copies.",
    );
    error.statusCode = 409;
    error.code = change < 0 ? "NO_AVAILABLE_BOOK_COPY" : "INVALID_BOOK_COPY_COUNT";
    throw error;
  }
}

async function update(collection, id, updates) {
  const mapping = mappingFor(collection);
  if (!mapping) {
    throw new TypeError(`No relational mapping exists for ${collection}.`);
  }
  return transaction(async () => {
    const existing = await findById(collection, id, { forUpdate: true });
    if (!existing) return null;
    const updated = { ...existing, ...updates, id };
    const values = encodeRelationalRecord(collection, updated);
    const bookId = values.book_id;
    delete values.book_id;
    if (collection === "library") {
      const activeLoans = usePostgres
        ? (await queryPostgres(
            "SELECT COUNT(*) AS total FROM library_loans l JOIN library_copies c ON c.id = l.copy_id WHERE c.book_id = $1 AND l.returned_at IS NULL AND l.archived_at IS NULL",
            [id],
          )).rows[0].total
        : (
            await querySqlite(
              "get",
              "SELECT COUNT(*) AS total FROM library_loans l JOIN library_copies c ON c.id = l.copy_id WHERE c.book_id = ? AND l.returned_at IS NULL AND l.archived_at IS NULL",
              [id],
            )
          ).total;
      if (Number(updated.copiesTotal) < Number(activeLoans)) {
        const error = new Error("Total copies cannot be less than the number currently on loan.");
        error.statusCode = 409;
        error.code = "BOOK_COPIES_BELOW_ACTIVE_LOANS";
        throw error;
      }
      if (updates.copiesTotal !== undefined) {
        updated.copiesAvailable =
          Number(updated.copiesTotal) - Number(activeLoans);
      }
    }
    if (collection === "library-loans" && bookId && existing.itemId !== updated.itemId) {
      if (!existing.returnedDate) {
        await changeAvailableCopies(existing.itemId, existing.schoolId, 1);
        await changeAvailableCopies(updated.itemId, updated.schoolId, -1);
      }
    } else if (collection === "library-loans" && bookId) {
      if (!existing.returnedDate && updated.returnedDate) {
        await changeAvailableCopies(existing.itemId, existing.schoolId, 1);
      } else if (existing.returnedDate && !updated.returnedDate) {
        await changeAvailableCopies(updated.itemId, updated.schoolId, -1);
      }
    }
    const assignments = Object.keys(values)
      .filter((column) => column !== "id")
      .map((column, index) => `${column} = ${usePostgres ? `$${index + 1}` : "?"}`);
    const updateValues = Object.entries(values)
      .filter(([column]) => column !== "id")
      .map(([, value]) => value);
    updateValues.push(id);
      await (usePostgres
        ? queryPostgres(
            `UPDATE ${mapping.table} SET ${assignments.join(", ")} WHERE id = $${updateValues.length}`,
            updateValues,
          )
        : querySqlite(
            "run",
            `UPDATE ${mapping.table} SET ${assignments.join(", ")} WHERE id = ?`,
            updateValues,
          ));
    await synchronizeRelations(collection, updated, existing);
    if (collection === "library-loans" && bookId) {
      const copyId = values.copy_id;
      const copyUpdate = await (usePostgres
        ? queryPostgres(
            "UPDATE library_copies SET book_id = $1, status = $2, updated_at = $3 WHERE id = $4",
            [bookId, updated.returnedDate ? "available" : "loaned", new Date().toISOString(), copyId],
          )
        : querySqlite(
            "run",
            "UPDATE library_copies SET book_id = ?, status = ?, updated_at = ? WHERE id = ?",
            [bookId, updated.returnedDate ? "available" : "loaned", new Date().toISOString(), copyId],
          ));
      if ((usePostgres ? copyUpdate.rowCount : copyUpdate.changes) !== 1) {
        throw new Error("Library loan copy record is missing.");
      }
    }
    return updated;
  });
}

async function remove(collection, id) {
  await ensureSchema();
  const mapping = mappingFor(collection);
  if (!mapping) {
    throw new TypeError(`No relational mapping exists for ${collection}.`);
  }
  if (collection === "library-loans") {
    return transaction(async () => {
      const existing = await findById(collection, id, { forUpdate: true });
      if (!existing) return false;
      if (!existing.returnedDate) {
        await changeAvailableCopies(existing.itemId, existing.schoolId, 1);
        const copyStatus = usePostgres
          ? await queryPostgres(
              "UPDATE library_copies SET status = 'available', updated_at = $1 WHERE id = $2",
              [new Date().toISOString(), `legacy-copy:${id}`],
            )
          : await querySqlite(
              "run",
              "UPDATE library_copies SET status = 'available', updated_at = ? WHERE id = ?",
              [new Date().toISOString(), `legacy-copy:${id}`],
            );
        if ((usePostgres ? copyStatus.rowCount : copyStatus.changes) !== 1) {
          throw new Error("Library loan copy record is missing.");
        }
      }
      return softRemove(mapping, id, "archived_at", collection);
    });
  }
  if (collection === "audit-logs" || collection === "exams") {
    if (collection === "exams") {
      return softRemove(mapping, id, "archived_at");
    }
    throw new Error("Audit records are immutable.");
  }
  const softColumn = ["users", "students", "teachers"].includes(collection)
    ? "deleted_at"
    : ["schools", "classes", "subjects", "assignments", "fees", "library", "attendance", "assignment-submissions", "library-loans"].includes(collection)
      ? "archived_at"
      : null;
  if (softColumn) return softRemove(mapping, id, softColumn, collection);
  if (collection === "payments") throw new Error("Payment records are immutable.");
  if (usePostgres) {
    const { rowCount } = await queryPostgres(
      `DELETE FROM ${mapping.table} WHERE id = $1`,
      [id],
    );
    return rowCount > 0;
  }
  const result = await querySqlite(
    "run",
    `DELETE FROM ${mapping.table} WHERE id = ?`,
    [id],
  );
  return result.changes > 0;
}

async function softRemove(mapping, id, column, collection) {
  const now = new Date().toISOString();
  const statusSet =
    collection === "users" ? ", status = 'disabled'" :
    ["students", "teachers"].includes(collection) ? ", status = 'inactive'" : "";
  if (usePostgres) {
    const result = await queryPostgres(
      `UPDATE ${mapping.table} SET ${column} = $1${statusSet} WHERE id = $2 AND ${column} IS NULL`,
      [now, id],
    );
    return result.rowCount > 0;
  }
  const result = await querySqlite(
    "run",
    `UPDATE ${mapping.table} SET ${column} = ?${statusSet} WHERE id = ? AND ${column} IS NULL`,
    [now, id],
  );
  return result.changes > 0;
}

async function completePasswordReset(tokenHash, passwordHash) {
  const now = new Date().toISOString();
  return transaction(async () => {
    const resetRows = usePostgres
      ? (await queryPostgres(
          "SELECT * FROM password_resets WHERE token_hash = $1 AND used_at IS NULL AND expires_at > $2 FOR UPDATE",
          [tokenHash, now],
        )).rows
      : await querySqlite(
          "all",
          "SELECT * FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?",
          [tokenHash, now],
        );
    const reset = recordFromRow("password-resets", resetRows[0]);
    if (!reset) return null;
    const user = await findById("users", reset.userId);
    if (!user) return null;
    const updatedUser = await update("users", user.id, {
      passwordHash,
      tokenVersion: (user.tokenVersion || 0) + 1,
    });
    const updatedReset = await update("password-resets", reset.id, {
      used: true,
      usedAt: now,
    });
    return { reset: updatedReset, user: updatedUser };
  });
}

async function close() {
  if (usePostgres) {
    await pool.end();
    return;
  }
  const previousLock = activeSqliteLock;
  if (previousLock) await previousLock.done;
  await sqliteLock;
  if (sqlite.open) sqlite.close();
}

module.exports = {
  readAll,
  readBySchool,
  findByIds,
  findUserByEmail,
  findInviteByCode,
  findChatByInviteCode,
  readByChatId,
  markPasswordResetsUsed,
  createInvoiceWithItems,
  recordPaymentWithAllocations,
  count,
  listPage,
  findById,
  insert,
  update,
  remove,
  ensureSchema,
  migrate,
  execute,
  all,
  dialect: usePostgres ? "postgres" : "sqlite",
  transaction,
  completePasswordReset,
  close,
  pool,
};
