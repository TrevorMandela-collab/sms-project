const { CUSTOM_PERMISSIONS } = require("../utils/customPermissions");

async function up({ execute, dialect }) {
  const insertPermission =
    dialect === "postgres"
      ? "INSERT INTO permissions (code, description, created_at, updated_at) VALUES ($1, $2, $3, $3) ON CONFLICT (code) DO NOTHING"
      : "INSERT OR IGNORE INTO permissions (code, description, created_at, updated_at) VALUES (?, ?, ?, ?)";

  await execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_id_school ON users(id, school_id)");
  await execute(`
    CREATE TABLE IF NOT EXISTS school_roles (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 60),
      description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 300),
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      UNIQUE (school_id, name),
      UNIQUE (id, school_id)
    )
  `);
  await execute(`
    CREATE TABLE IF NOT EXISTS school_role_permissions (
      role_id TEXT NOT NULL REFERENCES school_roles(id) ON DELETE CASCADE,
      permission_code TEXT NOT NULL REFERENCES permissions(code) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (role_id, permission_code)
    )
  `);
  await execute(`
    CREATE TABLE IF NOT EXISTS user_school_roles (
      user_id TEXT NOT NULL,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      role_id TEXT NOT NULL,
      assigned_by TEXT,
      created_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (user_id, role_id),
      FOREIGN KEY (user_id, school_id) REFERENCES users(id, school_id) ON DELETE CASCADE,
      FOREIGN KEY (role_id, school_id) REFERENCES school_roles(id, school_id) ON DELETE CASCADE
    )
  `);
  await execute("CREATE INDEX IF NOT EXISTS idx_school_roles_school ON school_roles(school_id, name)");
  await execute("CREATE INDEX IF NOT EXISTS idx_user_school_roles_user ON user_school_roles(user_id, school_id)");

  const now = new Date().toISOString();
  for (const permission of CUSTOM_PERMISSIONS) {
    await execute(insertPermission, dialect === "postgres"
      ? [permission.code, permission.description, now]
      : [permission.code, permission.description, now, now]);
  }
}

module.exports = { up };
