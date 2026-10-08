const fs = require("fs");
const path = require("path");
const { AsyncLocalStorage } = require("async_hooks");
const Database = require("better-sqlite3");
const { Pool } = require("pg");

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

function querySqlite(method, sql, values = []) {
  const execute = () => sqlite.prepare(sql)[method](...values);
  return withSqliteAccess(execute);
}

async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      if (usePostgres) {
        await queryPostgres(`
          CREATE TABLE IF NOT EXISTS store (
            collection TEXT NOT NULL,
            id TEXT NOT NULL,
            data JSONB NOT NULL,
            PRIMARY KEY (collection, id)
          );
        `);
      } else {
        await querySqlite(
          "run",
          `CREATE TABLE IF NOT EXISTS store (
            collection TEXT NOT NULL,
            id TEXT NOT NULL,
            data TEXT NOT NULL,
            PRIMARY KEY (collection, id)
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

async function ensureFile(collection, seedData = []) {
  await ensureSchema();
  if (!seedData.length) return;

  await transaction(async () => {
    if (usePostgres) {
      const { rows } = await queryPostgres(
        "SELECT 1 FROM store WHERE collection = $1 LIMIT 1",
        [collection],
      );
      if (rows.length) return;
      for (const record of seedData) {
        await queryPostgres(
          "INSERT INTO store (collection, id, data) VALUES ($1, $2, $3) ON CONFLICT (collection, id) DO NOTHING",
          [collection, record.id, record],
        );
      }
      return;
    }

    const row = await querySqlite(
      "get",
      "SELECT 1 FROM store WHERE collection = ? LIMIT 1",
      [collection],
    );
    if (row) return;
    for (const record of seedData) {
      await querySqlite(
        "run",
        "INSERT OR IGNORE INTO store (collection, id, data) VALUES (?, ?, ?)",
        [collection, record.id, JSON.stringify(record)],
      );
    }
  });
}

async function readAll(collection) {
  await ensureSchema();
  if (usePostgres) {
    const { rows } = await queryPostgres(
      "SELECT data FROM store WHERE collection = $1",
      [collection],
    );
    return rows.map((row) => row.data);
  }
  return (await querySqlite(
    "all",
    "SELECT data FROM store WHERE collection = ?",
    [collection],
  )).map((row) => JSON.parse(row.data));
}

async function findById(collection, id) {
  await ensureSchema();
  if (usePostgres) {
    const { rows } = await queryPostgres(
      "SELECT data FROM store WHERE collection = $1 AND id = $2",
      [collection, id],
    );
    return rows[0]?.data || null;
  }
  const row = await querySqlite(
    "get",
    "SELECT data FROM store WHERE collection = ? AND id = ?",
    [collection, id],
  );
  return row ? JSON.parse(row.data) : null;
}

async function insert(collection, record) {
  await ensureSchema();
  if (usePostgres) {
    await queryPostgres(
      "INSERT INTO store (collection, id, data) VALUES ($1, $2, $3)",
      [collection, record.id, record],
    );
  } else {
    await querySqlite(
      "run",
      "INSERT INTO store (collection, id, data) VALUES (?, ?, ?)",
      [collection, record.id, JSON.stringify(record)],
    );
  }
  return record;
}

async function update(collection, id, updates) {
  return transaction(async () => {
    let existing;
    if (usePostgres) {
      const { rows } = await queryPostgres(
        "SELECT data FROM store WHERE collection = $1 AND id = $2 FOR UPDATE",
        [collection, id],
      );
      existing = rows[0]?.data || null;
    } else {
      const row = await querySqlite(
        "get",
        "SELECT data FROM store WHERE collection = ? AND id = ?",
        [collection, id],
      );
      existing = row ? JSON.parse(row.data) : null;
    }
    if (!existing) return null;
    const updated = { ...existing, ...updates, id };
    if (usePostgres) {
      await queryPostgres(
        "UPDATE store SET data = $1 WHERE collection = $2 AND id = $3",
        [updated, collection, id],
      );
    } else {
      await querySqlite(
        "run",
        "UPDATE store SET data = ? WHERE collection = ? AND id = ?",
        [JSON.stringify(updated), collection, id],
      );
    }
    return updated;
  });
}

async function remove(collection, id) {
  await ensureSchema();
  if (usePostgres) {
    const { rowCount } = await queryPostgres(
      "DELETE FROM store WHERE collection = $1 AND id = $2",
      [collection, id],
    );
    return rowCount > 0;
  }
  const result = await querySqlite(
    "run",
    "DELETE FROM store WHERE collection = ? AND id = ?",
    [collection, id],
  );
  return result.changes > 0;
}

async function completePasswordReset(tokenHash, passwordHash) {
  const now = new Date().toISOString();
  return transaction(async () => {
    let reset;
    if (usePostgres) {
      const { rows } = await queryPostgres(
        `SELECT id, data
         FROM store
         WHERE collection = 'password-resets'
           AND data->>'tokenHash' = $1
           AND data->>'used' = 'false'
           AND (data->>'expiresAt')::timestamptz > $2::timestamptz
         FOR UPDATE`,
        [tokenHash, now],
      );
      reset = rows[0]?.data || null;
    } else {
      const row = await querySqlite(
        "get",
        `SELECT id, data
         FROM store
         WHERE collection = 'password-resets'
           AND json_extract(data, '$.tokenHash') = ?
           AND json_extract(data, '$.used') = 0
           AND json_extract(data, '$.expiresAt') > ?`,
        [tokenHash, now],
      );
      reset = row ? JSON.parse(row.data) : null;
    }
    if (!reset) return null;

    let user;
    if (usePostgres) {
      const { rows } = await queryPostgres(
        "SELECT data FROM store WHERE collection = 'users' AND id = $1 FOR UPDATE",
        [reset.userId],
      );
      user = rows[0]?.data || null;
    } else {
      const row = await querySqlite(
        "get",
        "SELECT data FROM store WHERE collection = 'users' AND id = ?",
        [reset.userId],
      );
      user = row ? JSON.parse(row.data) : null;
    }
    if (!user) return null;

    const updatedUser = {
      ...user,
      passwordHash,
      tokenVersion: (user.tokenVersion || 0) + 1,
    };
    const updatedReset = { ...reset, used: true, usedAt: now };
    if (usePostgres) {
      await queryPostgres(
        "UPDATE store SET data = $1 WHERE collection = 'users' AND id = $2",
        [updatedUser, user.id],
      );
      await queryPostgres(
        "UPDATE store SET data = $1 WHERE collection = 'password-resets' AND id = $2",
        [updatedReset, reset.id],
      );
    } else {
      await querySqlite(
        "run",
        "UPDATE store SET data = ? WHERE collection = 'users' AND id = ?",
        [JSON.stringify(updatedUser), user.id],
      );
      await querySqlite(
        "run",
        "UPDATE store SET data = ? WHERE collection = 'password-resets' AND id = ?",
        [JSON.stringify(updatedReset), reset.id],
      );
    }
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
  findById,
  insert,
  update,
  remove,
  ensureFile,
  ensureSchema,
  transaction,
  completePasswordReset,
  close,
  pool,
};
