const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const Database = require("better-sqlite3");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sms-seed-test-"));
const databasePath = path.join(directory, "seed.sqlite");
const seedPath = path.join(__dirname, "..", "utils", "seed.js");
const password = "seed-test-password-123!";

function runSeed() {
  return spawnSync(process.execPath, [seedPath], {
    encoding: "utf8",
    env: {
      ...process.env,
      DATABASE_URL: "",
      DEMO_SEED_PASSWORD: password,
      NODE_ENV: "development",
      SQLITE_PATH: databasePath,
    },
  });
}

try {
  const firstRun = runSeed();
  assert.equal(firstRun.status, 0, firstRun.stderr || firstRun.stdout);
  const secondRun = runSeed();
  assert.equal(secondRun.status, 0, secondRun.stderr || secondRun.stdout);
  assert.match(secondRun.stdout, /already present/);

  const database = new Database(databasePath, { readonly: true });
  for (const table of [
    "schools",
    "users",
    "teachers",
    "students",
    "classes",
    "subjects",
    "attendance",
    "assessment_results",
    "invoices",
    "library_books",
    "library_loans",
  ]) {
    assert.ok(
      database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count > 0,
      `development seed should add records to ${table}`,
    );
  }
  const passwordHash = database
    .prepare("SELECT password_hash FROM users LIMIT 1")
    .get().password_hash;
  assert.notEqual(passwordHash, password);
  assert.match(passwordHash, /^\$2[aby]\$/);
  const copies = database
    .prepare("SELECT copies_total, copies_available FROM library_books WHERE id = ?")
    .get("demo-book-mathematics");
  assert.deepEqual(copies, { copies_total: 12, copies_available: 11 });
  database.close();
  console.log("Relational development seed tests passed");
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
