const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sms-migration-failure-test-"));
process.env.DATABASE_URL = "";
process.env.SQLITE_PATH = path.join(directory, "migration-failure.sqlite");

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
  for (const id of ["duplicate-user-a", "duplicate-user-b"]) {
    await db.execute(
      "INSERT INTO store (collection, id, data) VALUES (?, ?, ?)",
      [
        "users",
        id,
        JSON.stringify({
          id,
          schoolId: "valid-school",
          name: id,
          email: "duplicate@example.test",
          passwordHash: "hash",
          role: "admin",
          status: "active",
          createdAt: new Date().toISOString(),
        }),
      ],
    );
  }
  await db.execute(
    "INSERT INTO store (collection, id, data) VALUES (?, ?, ?)",
    [
      "students",
      "orphan-student",
      JSON.stringify({
        id: "orphan-student",
        schoolId: "missing-school",
        name: "Orphan",
        createdAt: new Date().toISOString(),
      }),
    ],
  );

  const migrationErrors = [];
  const originalConsoleError = console.error;
  console.error = (...args) => {
    migrationErrors.push(args.join(" "));
  };
  try {
    await assert.rejects(db.migrate(), /Database migration 002 failed/);
  } finally {
    console.error = originalConsoleError;
  }
  assert.match(
    migrationErrors.join("\n"),
    /users\/malformed-user: invalid JSON data/,
  );
  assert.match(
    migrationErrors.join("\n"),
    /users\/invalid-user: plaintext password fields cannot be imported/,
  );
  assert.match(
    migrationErrors.join("\n"),
    /users\/duplicate-user-[ab]: .*idx_users_email_normalized|users\/duplicate-user-[ab]: .*unique/i,
  );
  assert.match(
    migrationErrors.join("\n"),
    /students\/orphan-student: .*FOREIGN KEY|students\/orphan-student: .*foreign key/i,
  );
  const versions = await db.all("SELECT version FROM schema_migrations ORDER BY version");
  assert.deepEqual(versions.map((row) => row.version), ["001"]);
  assert.equal((await db.all("SELECT COUNT(*) AS count FROM users"))[0].count, 0);
  assert.equal((await db.all("SELECT COUNT(*) AS count FROM schools"))[0].count, 0);
  assert.equal((await db.all("SELECT COUNT(*) AS count FROM students"))[0].count, 0);
  assert.equal((await db.all("SELECT COUNT(*) AS count FROM store"))[0].count, 6);

  await db.execute(
    "DELETE FROM store WHERE (collection = ? AND id IN (?, ?, ?, ?)) OR (collection = ? AND id = ?)",
    [
      "users",
      "malformed-user",
      "invalid-user",
      "duplicate-user-a",
      "duplicate-user-b",
      "students",
      "orphan-student",
    ],
  );
  const recoveredVersions = await db.migrate();
  assert.deepEqual(recoveredVersions, ["001", "002", "003", "004", "005"]);
  assert.equal((await db.findById("schools", "valid-school")).name, "Valid Before Invalid");
  assert.equal((await db.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'store'")).length, 0);
  console.log("Migration failure recovery tests passed");
}

run()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
