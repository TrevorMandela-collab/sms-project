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
let database;
let generatedDatabase;

function runSeed(targetPath = databasePath, configuredPassword = password, databaseUrl = "") {
  const env = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    NODE_ENV: "development",
    SQLITE_PATH: targetPath,
  };
  if (configuredPassword === null) delete env.DEMO_SEED_PASSWORD;
  else env.DEMO_SEED_PASSWORD = configuredPassword;
  return spawnSync(process.execPath, [seedPath], {
    cwd: directory,
    encoding: "utf8",
    env,
  });
}

try {
  const refusedPostgres = runSeed(databasePath, password, "postgres://not-a-real-host/demo");
  assert.notEqual(refusedPostgres.status, 0);
  assert.match(refusedPostgres.stderr, /refuses DATABASE_URL/);
  assert.equal(fs.existsSync(databasePath), false);

  const refusedMemoryPath = runSeed(":memory:");
  assert.notEqual(refusedMemoryPath.status, 0);
  assert.match(refusedMemoryPath.stderr, /isolated SQLite file/);
  assert.equal(fs.existsSync(databasePath), false);

  const firstRun = runSeed();
  assert.equal(firstRun.status, 0, firstRun.stderr || firstRun.stdout);
  const secondRun = runSeed();
  assert.equal(secondRun.status, 0, secondRun.stderr || secondRun.stdout);
  assert.match(secondRun.stdout, /already present/);

  database = new Database(databasePath, { readonly: true });
  const demoUsers = database
    .prepare("SELECT email, role_code AS role, school_id FROM users ORDER BY email")
    .all();
  assert.deepEqual(
    demoUsers.map(({ email, role, school_id }) => [email, role, school_id]),
    [
      ["admin@greenvalley.example", "admin", "demo-school"],
    ["parent@greenvalley.example", "parent", "demo-school"],
    ["platform-admin@mandela.example", "super_admin", null],
      ["school-admin@greenvalley.example", "school_admin", "demo-school"],
      ["student@greenvalley.example", "student", "demo-school"],
      ["teacher@greenvalley.example", "teacher", "demo-school"],
    ],
  );
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
  assert.equal(
    database
      .prepare("SELECT COUNT(*) AS count FROM platform_audit_logs WHERE action = ?")
      .get("PLATFORM_ADMIN_PROVISIONED").count,
    1,
  );
  database.close();
  database = null;

  const generatedPath = path.join(directory, "generated-password.sqlite");
  const generatedRun = runSeed(generatedPath, null);
  assert.equal(generatedRun.status, 0, generatedRun.stderr || generatedRun.stdout);
  const generatedPassword = generatedRun.stdout.match(
    /Generated one-time local demo password \(copy it now\): ([A-Za-z0-9_-]{32})/,
  )?.[1];
  assert.ok(generatedPassword, "fresh local seeds should print a generated password once");
  generatedDatabase = new Database(generatedPath, { readonly: true });
  const generatedHash = generatedDatabase
    .prepare("SELECT password_hash FROM users WHERE email = ?")
    .get("admin@greenvalley.example").password_hash;
  assert.notEqual(generatedHash, generatedPassword);
  assert.match(generatedHash, /^\$2[aby]\$/);
  generatedDatabase.close();
  generatedDatabase = null;
  console.log("Relational development seed tests passed");
} finally {
  if (database) database.close();
  if (generatedDatabase) generatedDatabase.close();
  for (const filename of ["seed.sqlite", "generated-password.sqlite"]) {
    for (const suffix of ["", "-journal", "-wal", "-shm"]) {
      const temporaryFile = path.join(directory, `${filename}${suffix}`);
      if (fs.existsSync(temporaryFile)) fs.rmSync(temporaryFile);
    }
  }
  fs.rmdirSync(directory);
}
