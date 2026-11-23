"use strict";

const path = require("node:path");
const { loadWithSqliteTestDatabase } = require("./sqlite-test-loader");

if (process.env.NODE_ENV !== "development") {
  throw new Error("SQLite seed tests require NODE_ENV=development.");
}

if (process.env.DATABASE_URL) {
  require("../utils/seed");
} else {
  loadWithSqliteTestDatabase(path.join(__dirname, "..", "utils", "seed.js"));
}
