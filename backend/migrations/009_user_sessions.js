async function up({ execute }) {
  await execute(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      user_agent TEXT NOT NULL DEFAULT ''
    )
  `);
  await execute(
    "CREATE INDEX IF NOT EXISTS idx_user_sessions_active ON user_sessions(user_id, token_version, expires_at, revoked_at)",
  );
}

module.exports = { up };
