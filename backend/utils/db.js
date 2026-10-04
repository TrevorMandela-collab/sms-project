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
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
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

async function completePasswordReset(tokenHash, passwordHash) {
  await ensureSchema();
  const now = new Date().toISOString();
  const usedAt = now;

  if (!usePostgres) {
    const complete = sqlite.transaction(() => {
      const row = sqlite
        .prepare(`
          SELECT id, data
          FROM store
          WHERE collection = 'password-resets'
            AND json_extract(data, '$.tokenHash') = ?
            AND json_extract(data, '$.used') = 0
            AND json_extract(data, '$.expiresAt') > ?
        `)
        .get(tokenHash, now);
      if (!row) return null;
      const reset = JSON.parse(row.data);
      const userRow = sqlite
        .prepare("SELECT data FROM store WHERE collection = 'users' AND id = ?")
        .get(reset.userId);
      if (!userRow) return null;

      const user = JSON.parse(userRow.data);
      const updatedUser = {
        ...user,
        passwordHash,
        tokenVersion: (user.tokenVersion || 0) + 1,
      };
      const updatedReset = { ...reset, used: true, usedAt };
      sqlite
        .prepare("UPDATE store SET data = ? WHERE collection = 'users' AND id = ?")
        .run(JSON.stringify(updatedUser), user.id);
      sqlite
        .prepare("UPDATE store SET data = ? WHERE collection = 'password-resets' AND id = ?")
        .run(JSON.stringify(updatedReset), reset.id);
      return { reset: updatedReset, user: updatedUser };
    });
    return complete();
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: resetRows } = await client.query(
      `
        SELECT id, data
        FROM store
        WHERE collection = 'password-resets'
          AND data->>'tokenHash' = $1
          AND data->>'used' = 'false'
          AND (data->>'expiresAt')::timestamptz > $2::timestamptz
        FOR UPDATE
      `,
      [tokenHash, now],
    );
    if (!resetRows.length) {
      await client.query("ROLLBACK");
      return null;
    }
    const reset = resetRows[0].data;
    const { rows: userRows } = await client.query(
      "SELECT data FROM store WHERE collection = 'users' AND id = $1 FOR UPDATE",
      [reset.userId],
    );
    if (!userRows.length) {
      await client.query("ROLLBACK");
      return null;
    }
    const user = userRows[0].data;
    const updatedUser = {
      ...user,
      passwordHash,
      tokenVersion: (user.tokenVersion || 0) + 1,
    };
    const updatedReset = { ...reset, used: true, usedAt };
    await client.query(
      "UPDATE store SET data = $1 WHERE collection = 'users' AND id = $2",
      [updatedUser, user.id],
    );
    await client.query(
      "UPDATE store SET data = $1 WHERE collection = 'password-resets' AND id = $2",
      [updatedReset, reset.id],
    );
    await client.query("COMMIT");
    return { reset: updatedReset, user: updatedUser };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
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
  completePasswordReset,
  pool,
};
