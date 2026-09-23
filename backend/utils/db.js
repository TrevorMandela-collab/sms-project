/* =========================================================
   Collection-backed data store.

   Uses Postgres when DATABASE_URL is set and SQLite otherwise.
   Both backends expose the same async collection API so route files
   do not need to know which database is being used.
========================================================= */

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { Pool } = require("pg");

const usePostgres = Boolean(process.env.DATABASE_URL);
let pool = null;
let sqlite = null;
let schemaReady = null;

if (usePostgres) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
} else {
  const sqlitePath =
    process.env.SQLITE_PATH || path.join(__dirname, "..", "data", "sms.sqlite");
  fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });
  sqlite = new Database(sqlitePath);
  console.warn(`[db] DATABASE_URL is not set; using SQLite at ${sqlitePath}`);
}

async function ensureSchema() {
  if (schemaReady) return schemaReady;

  if (usePostgres) {
    schemaReady = pool.query(`
      CREATE TABLE IF NOT EXISTS store (
        collection TEXT NOT NULL,
        id TEXT NOT NULL,
        data JSONB NOT NULL,
        PRIMARY KEY (collection, id)
      );
    `);
  } else {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS store (
        collection TEXT NOT NULL,
        id TEXT NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (collection, id)
      );
    `);
    schemaReady = Promise.resolve();
  }

  return schemaReady;
}

async function ensureFile(collection, seedData = []) {
  await ensureSchema();
  if (!seedData.length) return;

  if (usePostgres) {
    const { rows } = await pool.query(
      "SELECT 1 FROM store WHERE collection = $1 LIMIT 1",
      [collection],
    );
    if (rows.length) return;
    for (const record of seedData) {
      await pool.query(
        "INSERT INTO store (collection, id, data) VALUES ($1, $2, $3) ON CONFLICT (collection, id) DO NOTHING",
        [collection, record.id, record],
      );
    }
    return;
  }

  const hasRows = sqlite
    .prepare("SELECT 1 FROM store WHERE collection = ? LIMIT 1")
    .get(collection);
  if (hasRows) return;
  const insert = sqlite.prepare(
    "INSERT OR IGNORE INTO store (collection, id, data) VALUES (?, ?, ?)",
  );
  const seed = sqlite.transaction((records) =>
    records.forEach((record) => {
      insert.run(collection, record.id, JSON.stringify(record));
    }),
  );
  seed(seedData);
}

async function readAll(collection) {
  await ensureSchema();
  if (usePostgres) {
    const { rows } = await pool.query(
      "SELECT data FROM store WHERE collection = $1",
      [collection],
    );
    return rows.map((row) => row.data);
  }
  return sqlite
    .prepare("SELECT data FROM store WHERE collection = ?")
    .all(collection)
    .map((row) => JSON.parse(row.data));
}

async function writeAll(collection, records) {
  await ensureSchema();
  if (!usePostgres) {
    const replace = sqlite.transaction((items) => {
      sqlite.prepare("DELETE FROM store WHERE collection = ?").run(collection);
      const insert = sqlite.prepare(
        "INSERT INTO store (collection, id, data) VALUES (?, ?, ?)",
      );
      items.forEach((record) =>
        insert.run(collection, record.id, JSON.stringify(record)),
      );
    });
    replace(records);
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM store WHERE collection = $1", [collection]);
    for (const record of records) {
      await client.query(
        "INSERT INTO store (collection, id, data) VALUES ($1, $2, $3)",
        [collection, record.id, record],
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function findById(collection, id) {
  await ensureSchema();
  if (!usePostgres) {
    const row = sqlite
      .prepare("SELECT data FROM store WHERE collection = ? AND id = ?")
      .get(collection, id);
    return row ? JSON.parse(row.data) : null;
  }
  const { rows } = await pool.query(
    "SELECT data FROM store WHERE collection = $1 AND id = $2",
    [collection, id],
  );
  return rows[0]?.data || null;
}

async function insert(collection, record) {
  await ensureSchema();
  if (!usePostgres) {
    sqlite
      .prepare("INSERT INTO store (collection, id, data) VALUES (?, ?, ?)")
      .run(collection, record.id, JSON.stringify(record));
    return record;
  }
  await pool.query(
    "INSERT INTO store (collection, id, data) VALUES ($1, $2, $3)",
    [collection, record.id, record],
  );
  return record;
}

async function update(collection, id, updates) {
  await ensureSchema();
  const existing = await findById(collection, id);
  if (!existing) return null;
  const updated = { ...existing, ...updates, id };
  if (!usePostgres) {
    sqlite
      .prepare("UPDATE store SET data = ? WHERE collection = ? AND id = ?")
      .run(JSON.stringify(updated), collection, id);
    return updated;
  }
  await pool.query(
    "UPDATE store SET data = $1 WHERE collection = $2 AND id = $3",
    [updated, collection, id],
  );
  return updated;
}

async function remove(collection, id) {
  await ensureSchema();
  if (!usePostgres) {
    const result = sqlite
      .prepare("DELETE FROM store WHERE collection = ? AND id = ?")
      .run(collection, id);
    return result.changes > 0;
  }
  const { rowCount } = await pool.query(
    "DELETE FROM store WHERE collection = $1 AND id = $2",
    [collection, id],
  );
  return rowCount > 0;
}

module.exports = {
  readAll,
  writeAll,
  findById,
  insert,
  update,
  remove,
  ensureFile,
  ensureSchema,
  pool,
};
