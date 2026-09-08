/* =========================================================
   Postgres-backed data store.

   Same collection-based API as before (readAll/writeAll/
   findById/insert/update/remove/ensureFile), so route files
   don't need to change shape — but every function is now
   async, backed by a real database instead of local JSON
   files. This is what actually survives a Render restart:
   the previous JSON-file version lived on the app container's
   own disk, which resets on every redeploy or free-tier
   cold start; a hosted Postgres instance persists
   independently of that.

   All records for every "collection" (students, teachers,
   attendance, etc.) live in one generic table, keyed by
   (collection, id), with the record itself stored as JSONB.
   This keeps the schema simple and means adding a new
   collection never requires a migration.
========================================================= */

const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.warn(
    '[db] WARNING: DATABASE_URL is not set. Set it to a Postgres connection ' +
    'string (e.g. from Render Postgres, Neon, or Supabase) or nothing will persist.'
  );
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Most free hosted Postgres providers (Render, Neon, Supabase) require SSL
  // but use certificates that aren't in Node's default trust store.
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

let schemaReady = null;

function ensureSchema() {
  if (!schemaReady) {
    schemaReady = pool.query(`
      CREATE TABLE IF NOT EXISTS store (
        collection TEXT NOT NULL,
        id TEXT NOT NULL,
        data JSONB NOT NULL,
        PRIMARY KEY (collection, id)
      );
    `);
  }
  return schemaReady;
}

/**
 * Seeds a collection with default records, but only if it's currently
 * empty — mirrors the old "create the file if it doesn't exist yet"
 * behaviour without ever clobbering real data.
 */
async function ensureFile(collection, seedData = []) {
  await ensureSchema();
  if (!seedData.length) return;
  const { rows } = await pool.query('SELECT 1 FROM store WHERE collection = $1 LIMIT 1', [collection]);
  if (rows.length) return; // already has data (or was already seeded) — leave it alone

  for (const record of seedData) {
    await pool.query(
      'INSERT INTO store (collection, id, data) VALUES ($1, $2, $3) ON CONFLICT (collection, id) DO NOTHING',
      [collection, record.id, record]
    );
  }
}

async function readAll(collection) {
  await ensureSchema();
  const { rows } = await pool.query('SELECT data FROM store WHERE collection = $1', [collection]);
  return rows.map(r => r.data);
}

async function writeAll(collection, records) {
  await ensureSchema();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM store WHERE collection = $1', [collection]);
    for (const record of records) {
      await client.query('INSERT INTO store (collection, id, data) VALUES ($1, $2, $3)', [collection, record.id, record]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function findById(collection, id) {
  await ensureSchema();
  const { rows } = await pool.query('SELECT data FROM store WHERE collection = $1 AND id = $2', [collection, id]);
  return rows[0]?.data || null;
}

async function insert(collection, record) {
  await ensureSchema();
  await pool.query('INSERT INTO store (collection, id, data) VALUES ($1, $2, $3)', [collection, record.id, record]);
  return record;
}

async function update(collection, id, updates) {
  await ensureSchema();
  const existing = await findById(collection, id);
  if (!existing) return null;
  const updated = { ...existing, ...updates, id };
  await pool.query('UPDATE store SET data = $1 WHERE collection = $2 AND id = $3', [updated, collection, id]);
  return updated;
}

async function remove(collection, id) {
  await ensureSchema();
  const { rowCount } = await pool.query('DELETE FROM store WHERE collection = $1 AND id = $2', [collection, id]);
  return rowCount > 0;
}

module.exports = { readAll, writeAll, findById, insert, update, remove, ensureFile, ensureSchema, pool };
