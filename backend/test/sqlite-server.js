"use strict";

if (
  process.env.NODE_ENV !== "test" ||
  !process.env.SQLITE_PATH ||
  process.env.DATABASE_URL
) {
  throw new Error(
    "SQLite test server requires NODE_ENV=test, SQLITE_PATH, and no DATABASE_URL.",
  );
}

const path = require("node:path");
const { loadWithSqliteTestDatabase } = require("./sqlite-test-loader");

loadWithSqliteTestDatabase(path.join(__dirname, "..", "server.js"));
