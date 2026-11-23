"use strict";

const assert = require("node:assert/strict");
const {
  EXPECTED_MIGRATION_VERSIONS,
  assertMigrationFiles,
} = require("./migration-versions");
const { withPostgresTestSchema } = require("./postgres-test-schema");

assertMigrationFiles();

async function run({ db }) {
  const concurrentVersions = await Promise.all([db.migrate(), db.migrate()]);
  const versions = concurrentVersions[0];
  assert.deepEqual(
    concurrentVersions[1],
    versions,
    "concurrent migration callers must both observe a successful, complete upgrade",
  );
  assert.deepEqual(versions, EXPECTED_MIGRATION_VERSIONS);
  assert.deepEqual(await db.migrate(), versions);

  assert.equal(
    (await db.all("SELECT to_regclass('store') AS name"))[0]?.name ?? null,
    null,
  );
  assert.equal(
    Number(
      (
        await db.all(
          "SELECT COUNT(*) AS count FROM pg_constraint WHERE contype = 'f' AND NOT convalidated",
        )
      )[0].count,
    ),
    0,
    "fresh schema must have no unvalidated foreign keys",
  );
  assert.ok(
    (await db.all("SELECT to_regclass('idx_students_school_name') AS name"))[0]
      ?.name,
    "fresh schema must include relational query indexes",
  );
  assert.ok(
    (await db.all("SELECT to_regclass('pending_email_changes') AS name"))[0]
      ?.name,
    "migration 019 must add the pending email-change table",
  );

  const trigger = await db.all(
    "SELECT 1 FROM pg_trigger WHERE tgname = 'validate_school_membership_role' AND NOT tgisinternal",
  );
  assert.equal(trigger.length, 1, "migration 017 must install the membership role trigger");

  const now = new Date().toISOString();
  await db.insert("schools", {
    id: "fresh-school",
    name: "Fresh Migration School",
    createdAt: now,
  });
  await db.insert("students", {
    id: "fresh-student",
    schoolId: "fresh-school",
    name: "Fresh Student",
    status: "active",
    createdAt: now,
  });
  await assert.rejects(
    db.insert("students", {
      id: "orphan-student",
      schoolId: "missing-school",
      name: "Orphan",
      createdAt: now,
    }),
    /FOREIGN KEY|foreign key/i,
  );
  await assert.rejects(
    db.execute(
      `INSERT INTO school_memberships
         (id, user_id, school_id, role_code, status, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        "invalid-membership-role",
        "missing-user",
        "fresh-school",
        "super_admin",
        "active",
        true,
        now,
        now,
      ],
    ),
    /invalid school membership role/i,
  );
  await assert.rejects(
    db.transaction(async () => {
      await db.insert("events", {
        id: "rolled-back-event",
        schoolId: "fresh-school",
        name: "Rolled back",
        date: now.slice(0, 10),
        createdAt: now,
      });
      throw new Error("expected transaction rollback");
    }),
    /expected transaction rollback/,
  );
  assert.equal(await db.findById("events", "rolled-back-event"), null);
  assert.equal((await db.findById("students", "fresh-student")).name, "Fresh Student");
  console.log("Fresh PostgreSQL migration tests passed");
}

withPostgresTestSchema(run).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
