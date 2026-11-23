"use strict";

const assert = require("node:assert/strict");
const {
  EXPECTED_MIGRATION_VERSIONS,
  assertMigrationFiles,
} = require("./migration-versions");
const { withPostgresTestSchema } = require("./postgres-test-schema");

assertMigrationFiles();

async function insertLegacyRecord(db, collection, id, record) {
  await db.execute(
    "INSERT INTO store (collection, id, data) VALUES ($1, $2, $3)",
    [collection, id, JSON.stringify(record)],
  );
}

async function run({ db }) {
  await db.ensureSchema();
  await db.execute(
    "CREATE TABLE store (collection TEXT NOT NULL, id TEXT NOT NULL, data JSONB NOT NULL, PRIMARY KEY (collection, id))",
  );

  const createdAt = new Date().toISOString();
  await insertLegacyRecord(db, "schools", "valid-school", {
    id: "valid-school",
    name: "Synthetic Retry School",
    createdAt,
  });
  await insertLegacyRecord(db, "users", "valid-user", {
    id: "valid-user",
    schoolId: "valid-school",
    name: "Synthetic Valid User",
    email: "valid@example.test",
    passwordHash: "synthetic-hash",
    role: "admin",
    status: "active",
    createdAt,
  });
  await insertLegacyRecord(db, "users", "invalid-user", {
    id: "invalid-user",
    schoolId: "valid-school",
    name: "Synthetic Invalid User",
    email: "invalid@example.test",
    passwordHash: "synthetic-hash",
    password: "plaintext-must-never-be-imported",
    role: "admin",
    status: "active",
    createdAt,
  });
  for (const id of ["duplicate-user-a", "duplicate-user-b"]) {
    await insertLegacyRecord(db, "users", id, {
      id,
      schoolId: "valid-school",
      name: id,
      email: "duplicate@example.test",
      passwordHash: "synthetic-hash",
      role: "admin",
      status: "active",
      createdAt,
    });
  }
  await insertLegacyRecord(db, "students", "orphan-student", {
    id: "orphan-student",
    schoolId: "missing-school",
    name: "Synthetic Orphan",
    createdAt,
  });

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
  const diagnostics = migrationErrors.join("\n");
  assert.doesNotMatch(diagnostics, /invalid-user|duplicate-user|orphan-student/);
  assert.doesNotMatch(diagnostics, /plaintext-must-never-be-imported|duplicate@example\.test/);
  assert.match(diagnostics, /database\.migration_failed/);
  assert.match(diagnostics, /"migrationVersion":"002"/);
  const versions = await db.all("SELECT version FROM schema_migrations ORDER BY version");
  assert.deepEqual(
    versions.map((row) => row.version),
    EXPECTED_MIGRATION_VERSIONS.slice(0, 1),
  );
  assert.equal(Number((await db.all("SELECT COUNT(*) AS count FROM users"))[0].count), 0);
  assert.equal(Number((await db.all("SELECT COUNT(*) AS count FROM schools"))[0].count), 0);
  assert.equal(Number((await db.all("SELECT COUNT(*) AS count FROM students"))[0].count), 0);
  assert.equal(Number((await db.all("SELECT COUNT(*) AS count FROM store"))[0].count), 6);

  await db.execute(
    `DELETE FROM store
     WHERE (collection = $1 AND id = ANY($2::text[]))
        OR (collection = $3 AND id = $4)`,
    [
      "users",
      ["invalid-user", "duplicate-user-a", "duplicate-user-b"],
      "students",
      "orphan-student",
    ],
  );
  const recoveredVersions = await db.migrate();
  assert.deepEqual(recoveredVersions, EXPECTED_MIGRATION_VERSIONS);
  assert.equal((await db.findById("schools", "valid-school")).name, "Synthetic Retry School");
  assert.equal((await db.findById("users", "valid-user")).email, "valid@example.test");
  assert.equal(
    (await db.all("SELECT to_regclass('store') AS name"))[0]?.name ?? null,
    null,
  );
  console.log("PostgreSQL migration failure and retry tests passed");
}

withPostgresTestSchema(run).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
