"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const Database = require("better-sqlite3");
const migration = require("../migrations/015_finance_idempotency");
const { validatePostgresTestConfiguration } = require("./postgres-test-safety");
const { withPostgresTestSchema } = require("./postgres-test-schema");

const postgresUrl = validatePostgresTestConfiguration();

function seedBaseTables(execute) {
  return (async () => {
    await execute(`
      CREATE TABLE schools (
        id TEXT PRIMARY KEY
      )
    `);
    await execute(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        school_id TEXT REFERENCES schools(id) ON DELETE RESTRICT,
        UNIQUE (id, school_id)
      )
    `);
    await execute("CREATE TABLE unrelated_records (id TEXT PRIMARY KEY, value TEXT NOT NULL)");
    await execute("INSERT INTO schools (id) VALUES ('school-a'), ('school-b')");
    await execute(
      "INSERT INTO users (id, school_id) VALUES ('user-a', 'school-a'), ('user-b', 'school-a'), ('user-c', 'school-b')",
    );
    await execute("INSERT INTO unrelated_records (id, value) VALUES ('keep', 'untouched')");
  })();
}

function operation({
  id,
  schoolId = "school-a",
  userId = "user-a",
  type = "invoice.create",
  key = "same-client-key",
  state = "pending",
  resourceId = null,
  responseStatus = null,
  responseJson = null,
}) {
  return {
    id,
    school_id: schoolId,
    user_id: userId,
    operation_type: type,
    idempotency_key: key,
    request_hash: "a".repeat(64),
    state,
    resource_id: resourceId,
    response_status: responseStatus,
    response_json: responseJson,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function makeSqliteHarness(database) {
  return {
    execute: async (sql, values = []) => database.prepare(sql).run(...values),
    all: async (sql, values = []) => database.prepare(sql).all(...values),
    insert: async (row) => {
      const columns = Object.keys(row);
      const sql = `INSERT INTO finance_idempotency_operations (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`;
      return database.prepare(sql).run(...columns.map((column) => row[column]));
    },
    hasTable: () =>
      database.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'finance_idempotency_operations'",
      ).get(),
    columns: async () => database
      .prepare("PRAGMA table_info(finance_idempotency_operations)")
      .all()
      .map((row) => row.name),
    close: async () => database.close(),
  };
}

function makePostgresHarness(client) {
  return {
    execute: async (sql, values = []) => client.query(sql, values),
    all: async (sql, values = []) => (await client.query(sql, values)).rows,
    insert: async (row) => {
      const columns = Object.keys(row);
      const placeholders = columns.map((_, index) => `$${index + 1}`);
      return client.query(
        `INSERT INTO finance_idempotency_operations (${columns.join(", ")}) VALUES (${placeholders.join(", ")})`,
        columns.map((column) => row[column]),
      );
    },
    hasTable: async () =>
      (await client.query(
        "SELECT to_regclass('finance_idempotency_operations') AS name",
      )).rows[0].name,
    columns: async () => (await client.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'finance_idempotency_operations' ORDER BY ordinal_position",
    )).rows.map((row) => row.column_name),
  };
}

async function assertMigrationBehavior(harness, dialect) {
  await seedBaseTables(harness.execute);
  await harness.execute("BEGIN");
  await assert.rejects(
    migration.up({
      execute: async (sql, values) => {
        await harness.execute(sql, values);
        throw new Error("injected migration failure");
      },
      all: harness.all,
      dialect,
    }),
    /injected migration failure/,
  );
  await harness.execute("ROLLBACK");
  assert.equal(Boolean(await harness.hasTable()), false, "failed migration must leave no ledger table");
  const afterFailure = await harness.all(
    "SELECT value FROM unrelated_records WHERE id = 'keep'",
  );
  assert.equal(afterFailure[0].value, "untouched", "failed migration must preserve unrelated records");

  await harness.execute("BEGIN");
  await migration.up({ execute: harness.execute, all: harness.all, dialect });
  await harness.execute("ROLLBACK");
  assert.equal(Boolean(await harness.hasTable()), false, "rolled-back migration must leave no ledger table");
  const unrelated = await harness.all(
    "SELECT value FROM unrelated_records WHERE id = 'keep'",
  );
  assert.equal(unrelated[0].value, "untouched", "rollback must preserve unrelated records");

  await migration.up({ execute: harness.execute, all: harness.all, dialect });
  assert.deepEqual(await harness.columns(), [
    "id",
    "school_id",
    "user_id",
    "operation_type",
    "idempotency_key",
    "request_hash",
    "state",
    "resource_id",
    "response_status",
    "response_json",
    "created_at",
    "updated_at",
  ]);
  const pending = operation({ id: "pending-a" });
  await harness.insert(pending);
  await assert.rejects(
    harness.insert(operation({ id: "duplicate-identity" })),
    /unique|duplicate/i,
  );

  await harness.insert(operation({
    id: "school-b-operation",
    schoolId: "school-b",
    userId: "user-c",
  }));
  await harness.insert(operation({
    id: "other-user-operation",
    userId: "user-b",
  }));
  await harness.insert(operation({
    id: "other-type-operation",
    type: "payment.create",
  }));
  await harness.insert(operation({
    id: "other-key-operation",
    key: "another-client-key",
  }));

  const completed = operation({
    id: "completed-operation",
    key: "complete-key",
    state: "completed",
    resourceId: "resource-1",
    responseStatus: 201,
    responseJson: JSON.stringify({ result: { id: "resource-1" } }),
  });
  await harness.insert(completed);

  await assert.rejects(
    harness.insert(operation({
      id: "incomplete-completed",
      key: "incomplete-key",
      state: "completed",
      resourceId: "resource-2",
      responseStatus: null,
      responseJson: JSON.stringify({}),
    })),
    /check|constraint/i,
  );
  await assert.rejects(
    harness.insert(operation({
      id: "partially-pending",
      key: "partial-key",
      resourceId: "resource-3",
    })),
    /check|constraint/i,
  );
  await assert.rejects(
    harness.insert(operation({
      id: "invalid-response",
      key: "invalid-response-key",
      state: "completed",
      resourceId: "resource-4",
      responseStatus: 201,
      responseJson: "{invalid-json",
    })),
    /json|check|constraint/i,
  );
  await assert.rejects(
    harness.insert(operation({
      id: "invalid-school-user",
      schoolId: "school-b",
      userId: "user-a",
      key: "invalid-scope",
    })),
    /foreign key|constraint/i,
  );
  await assert.rejects(
    harness.insert({
      ...operation({ id: "invalid-request-hash", key: "invalid-hash-key" }),
      request_hash: "not-a-sha256-hash",
    }),
    /check|constraint/i,
  );

  const rows = await harness.all(
    "SELECT id, state, resource_id, response_status, response_json FROM finance_idempotency_operations ORDER BY id",
  );
  assert.equal(rows.length, 6);
  assert.equal(rows.find((row) => row.id === "pending-a").state, "pending");
  const storedCompleted = rows.find((row) => row.id === "completed-operation");
  assert.equal(storedCompleted.state, "completed");
  assert.equal(storedCompleted.response_status, 201);
  assert.deepEqual(
    typeof storedCompleted.response_json === "string"
      ? JSON.parse(storedCompleted.response_json)
      : storedCompleted.response_json,
    { result: { id: "resource-1" } },
  );
  assert.equal(
    (await harness.all("SELECT value FROM unrelated_records WHERE id = 'keep'"))[0].value,
    "untouched",
  );
}

test("SQLite migration applies with scoped uniqueness, completion checks, and transaction rollback", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sms-finance-idempotency-sqlite-"));
  const database = new Database(path.join(directory, "migration.sqlite"));
  database.pragma("foreign_keys = ON");
  const harness = makeSqliteHarness(database);
  try {
    await assertMigrationBehavior(harness, "sqlite");
  } finally {
    await harness.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test(
  "PostgreSQL migration applies with scoped uniqueness, completion checks, and transaction rollback",
  { skip: postgresUrl ? false : "Set the explicit disposable PostgreSQL test configuration to run this case." },
  async () =>
    withPostgresTestSchema(async ({ client }) => {
      const harness = makePostgresHarness(client);
      await assertMigrationBehavior(harness, "postgres");
    }),
);
