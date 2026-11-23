"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const EXPECTED_MIGRATION_VERSIONS = Object.freeze([
  "001",
  "002",
  "003",
  "004",
  "005",
  "006",
  "007",
  "008",
  "009",
  "010",
  "011",
  "012",
  "013",
  "014",
  "015",
  "016",
  "017",
  "018",
  "019",
]);

function assertMigrationFiles() {
  const migrationDirectory = path.join(__dirname, "..", "migrations");
  const discoveredVersions = fs
    .readdirSync(migrationDirectory)
    .filter((filename) => /^\d{3,}_[a-z0-9_-]+\.js$/i.test(filename))
    .sort((left, right) => left.localeCompare(right))
    .map((filename) => filename.slice(0, filename.indexOf("_")));

  assert.deepEqual(
    discoveredVersions,
    EXPECTED_MIGRATION_VERSIONS,
    "migration files must match the explicitly supported version chain and order",
  );
  return discoveredVersions;
}

if (require.main === module) {
  assertMigrationFiles();
  console.log("Migration version sequence verified");
}

module.exports = {
  EXPECTED_MIGRATION_VERSIONS,
  assertMigrationFiles,
};
