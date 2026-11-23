"use strict";

async function up({ execute }) {
  await execute(`
    CREATE TABLE IF NOT EXISTS pending_email_changes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    )
  `);
  await execute(
    "CREATE INDEX IF NOT EXISTS idx_pending_email_changes_user_expiry ON pending_email_changes(user_id, used_at, expires_at)",
  );
}

module.exports = { up };
