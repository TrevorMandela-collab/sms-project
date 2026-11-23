"use strict";

const path = require("node:path");
const { loadWithSqliteTestDatabase } = require("./sqlite-test-loader");

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "";
process.env.SQLITE_PATH = ":memory:";

loadWithSqliteTestDatabase(path.join(__dirname, "platform-audit.js"));
