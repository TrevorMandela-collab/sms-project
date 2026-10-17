async function up({ execute, dialect }) {
  const roles = [
    ["school_admin", "School Administrator"],
    ["super_admin", "Super Administrator"],
  ];
  for (const [code, name] of roles) {
    await execute(
      dialect === "postgres"
        ? "INSERT INTO roles (code, name, created_at, updated_at) VALUES ($1, $2, $3, $3) ON CONFLICT (code) DO NOTHING"
        : "INSERT OR IGNORE INTO roles (code, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
      dialect === "postgres"
        ? [code, name, new Date().toISOString()]
        : [code, name, new Date().toISOString(), new Date().toISOString()],
    );
  }
}

module.exports = { up };
