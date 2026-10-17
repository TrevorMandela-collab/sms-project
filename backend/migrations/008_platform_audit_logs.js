async function up({ execute }) {
  await execute(`
    CREATE TABLE IF NOT EXISTS platform_audit_logs (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      school_id TEXT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      timestamp TEXT NOT NULL,
      metadata JSON NOT NULL DEFAULT '{}',
      ip_address TEXT,
      user_agent TEXT
    )
  `);
  await execute(
    "CREATE INDEX IF NOT EXISTS idx_platform_audit_time ON platform_audit_logs(timestamp)",
  );
  await execute(
    "CREATE INDEX IF NOT EXISTS idx_platform_audit_school_time ON platform_audit_logs(school_id, timestamp)",
  );
}

module.exports = { up };
