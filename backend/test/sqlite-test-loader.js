"use strict";

const Module = require("node:module");
const path = require("node:path");

function loadWithSqliteTestDatabase(entrypoint) {
  if (
    !["test", "development"].includes(process.env.NODE_ENV) ||
    !process.env.SQLITE_PATH ||
    process.env.DATABASE_URL
  ) {
    throw new Error(
      "SQLite test loader requires NODE_ENV=test or development, SQLITE_PATH, and no DATABASE_URL.",
    );
  }

  const appDatabasePath = require.resolve("../utils/db");
  const sqliteTestDatabasePath = require.resolve("../utils/db-sqlite-test");
  const originalLoad = Module._load;
  Module._load = function loadSqliteTestDatabase(request, parent, isMain) {
    if (Module._resolveFilename(request, parent, isMain) === appDatabasePath) {
      return originalLoad.call(this, sqliteTestDatabasePath, parent, isMain);
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  return require(path.resolve(entrypoint));
}

module.exports = { loadWithSqliteTestDatabase };
