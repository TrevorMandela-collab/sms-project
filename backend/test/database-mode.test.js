"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const backendDirectory = path.resolve(__dirname, "..");

function runDatabaseModule(environment, script) {
  return spawnSync(process.execPath, ["-e", script], {
    cwd: backendDirectory,
    env: { ...process.env, ...environment },
    encoding: "utf8",
  });
}

test("SQLite mode requires an explicit test database path", () => {
  const result = runDatabaseModule(
    {
      DATABASE_URL: "",
      NODE_ENV: "test",
      SQLITE_PATH: ":memory:",
    },
    "const db = require('./utils/db-sqlite-test'); if (db.dialect !== 'sqlite') process.exitCode = 1; db.close();",
  );
  assert.equal(result.status, 0, result.stderr);
});

test("production never falls back to the SQLite test adapter", () => {
  const result = runDatabaseModule(
    {
      DATABASE_URL: "",
      NODE_ENV: "production",
      SQLITE_PATH: ":memory:",
    },
    "require('./utils/db');",
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /DATABASE_URL must be set to a PostgreSQL database/);
});

test("SQLite test loader rejects unsupported environments and PostgreSQL targets", () => {
  for (const environment of [
    {
      DATABASE_URL: "",
      NODE_ENV: "production",
      SQLITE_PATH: ":memory:",
    },
    {
      DATABASE_URL: "",
      NODE_ENV: "staging",
      SQLITE_PATH: ":memory:",
    },
    {
      DATABASE_URL: "postgres://example.invalid/school",
      NODE_ENV: "test",
      SQLITE_PATH: ":memory:",
    },
  ]) {
    const result = runDatabaseModule(
      environment,
      "require('./test/sqlite-test-loader').loadWithSqliteTestDatabase('./server.js');",
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /SQLite test loader requires/);
  }
});

test("SQLite test adapter rejects repository data paths before opening a file", () => {
  const databasePath = path.join(
    backendDirectory,
    "data",
    "phase3c-sqlite-test-guard.sqlite",
  );
  const result = runDatabaseModule(
    {
      DATABASE_URL: "",
      NODE_ENV: "test",
      SQLITE_PATH: databasePath,
    },
    "require('./utils/db-sqlite-test');",
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cannot use the repository data directory/);
  assert.equal(fs.existsSync(databasePath), false);
});

test("SQLite test adapter rejects unsupported environments and PostgreSQL URLs", () => {
  for (const environment of [
    {
      DATABASE_URL: "",
      NODE_ENV: "staging",
      SQLITE_PATH: ":memory:",
    },
    {
      DATABASE_URL: "postgres://example.invalid/school",
      NODE_ENV: "test",
      SQLITE_PATH: ":memory:",
    },
  ]) {
    const result = runDatabaseModule(environment, "require('./utils/db-sqlite-test');");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /SQLite test database requires/);
  }
});
