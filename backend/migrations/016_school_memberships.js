async function addActiveSchoolColumn({ execute, all, dialect }) {
  const columns = dialect === "postgres"
    ? await all(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'user_sessions'",
      )
    : await all("PRAGMA table_info(user_sessions)");
  const hasColumn = columns.some((column) =>
    (column.column_name || column.name) === "active_school_id",
  );
  if (hasColumn) return;

  await execute(
    "ALTER TABLE user_sessions ADD COLUMN active_school_id TEXT REFERENCES schools(id) ON DELETE SET NULL",
  );
}

async function up({ execute, all, dialect }) {
  const createTableSql = dialect === "postgres"
    ? `
      CREATE TABLE IF NOT EXISTS school_memberships (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
        role_code TEXT NOT NULL REFERENCES roles(code) ON DELETE RESTRICT,
        status TEXT NOT NULL DEFAULT 'active'
          CHECK (status IN ('active', 'pending', 'revoked', 'suspended')),
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        assigned_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        UNIQUE (user_id, school_id),
        CHECK ((status = 'active' AND is_active = TRUE) OR
               (status <> 'active' AND is_active = FALSE))
      )
    `
    : `
      CREATE TABLE IF NOT EXISTS school_memberships (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
        role_code TEXT NOT NULL REFERENCES roles(code) ON DELETE RESTRICT,
        status TEXT NOT NULL DEFAULT 'active'
          CHECK (status IN ('active', 'pending', 'revoked', 'suspended')),
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
        assigned_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (user_id, school_id),
        CHECK ((status = 'active' AND is_active = 1) OR
               (status <> 'active' AND is_active = 0))
      )
    `;

  await execute(createTableSql);
  await execute(
    "CREATE INDEX IF NOT EXISTS idx_school_memberships_user_status ON school_memberships(user_id, status, school_id)",
  );
  await execute(
    "CREATE INDEX IF NOT EXISTS idx_school_memberships_school_role_status ON school_memberships(school_id, role_code, status)",
  );
  await addActiveSchoolColumn({ execute, all, dialect });
  await execute(`
    UPDATE user_sessions
    SET active_school_id = (
      SELECT users.school_id
      FROM users
      WHERE users.id = user_sessions.user_id
    )
    WHERE active_school_id IS NULL
      AND EXISTS (
        SELECT 1
        FROM users
        WHERE users.id = user_sessions.user_id
          AND users.school_id IS NOT NULL
      )
  `);

  const now = new Date().toISOString();
  const insertSql = dialect === "postgres"
    ? `INSERT INTO school_memberships
         (id, user_id, school_id, role_code, status, is_active, assigned_by, created_at, updated_at)
       SELECT 'legacy-membership:' || u.id || ':' || u.school_id,
              u.id, u.school_id, u.role_code, 'active', TRUE, u.id, $1, $1
       FROM users u
       WHERE u.school_id IS NOT NULL
       ON CONFLICT (user_id, school_id) DO NOTHING`
    : `INSERT INTO school_memberships
         (id, user_id, school_id, role_code, status, is_active, assigned_by, created_at, updated_at)
       SELECT 'legacy-membership:' || u.id || ':' || u.school_id,
              u.id, u.school_id, u.role_code, 'active', 1, u.id, ?, ?
       FROM users u
       WHERE u.school_id IS NOT NULL
       ON CONFLICT (user_id, school_id) DO NOTHING`;
  await execute(insertSql, dialect === "postgres" ? [now] : [now, now]);
}

module.exports = { up };
