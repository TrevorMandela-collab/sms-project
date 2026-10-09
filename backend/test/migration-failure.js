const assert = require("assert");
const db = require("../utils/db");

async function run() {
  await db.ensureSchema();
  await db.execute(
    db.dialect === "postgres"
      ? "CREATE TABLE store (collection TEXT NOT NULL, id TEXT NOT NULL, data JSONB NOT NULL, PRIMARY KEY (collection, id))"
      : "CREATE TABLE store (collection TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (collection, id))",
  );
  await db.execute(
    "INSERT INTO store (collection, id, data) VALUES (?, ?, ?)",
    [
      "schools",
      "valid-school",
      JSON.stringify({
        id: "valid-school",
        name: "Valid Before Invalid",
        createdAt: new Date().toISOString(),
      }),
    ],
  );
  await db.execute(
    "INSERT INTO store (collection, id, data) VALUES (?, ?, ?)",
    [
      "users",
      "malformed-user",
      "{invalid-json",
    ],
  );
  await db.execute(
    "INSERT INTO store (collection, id, data) VALUES (?, ?, ?)",
    [
      "users",
      "invalid-user",
      JSON.stringify({
        id: "invalid-user",
        schoolId: "valid-school",
        name: "Invalid",
        email: "invalid@example.test",
        passwordHash: "hash",
        password: "plaintext-must-never-be-imported",
        role: "admin",
        status: "active",
        createdAt: new Date().toISOString(),
      }),
    ],
  );

  await assert.rejects(db.migrate(), /Database migration 002 failed/);
  const versions = await db.all("SELECT version FROM schema_migrations ORDER BY version");
  assert.deepEqual(versions.map((row) => row.version), ["001"]);
  assert.equal((await db.all("SELECT COUNT(*) AS count FROM users"))[0].count, 0);
  assert.equal((await db.all("SELECT COUNT(*) AS count FROM schools"))[0].count, 0);
  assert.equal((await db.all("SELECT COUNT(*) AS count FROM store"))[0].count, 3);
}

run()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => db.close());
