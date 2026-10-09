const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sms-fresh-migration-test-"));
process.env.DATABASE_URL = "";
process.env.SQLITE_PATH = path.join(directory, "fresh.sqlite");

const db = require("../utils/db");

async function run() {
  const versions = await db.migrate();
  assert.deepEqual(versions, ["001", "002", "003", "004", "005"]);
  assert.deepEqual(await db.migrate(), versions);

  const legacyStore = await db.all(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'store'",
  );
  assert.equal(legacyStore.length, 0);
  assert.equal(
    (await db.all("PRAGMA foreign_key_check")).length,
    0,
    "fresh schema must have no foreign-key violations",
  );
  assert.equal((await db.all("PRAGMA foreign_keys"))[0].foreign_keys, 1);
  assert.ok(
    (await db.all(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_students_school_name'",
    )).length > 0,
    "fresh schema must include relational query indexes",
  );

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
  console.log("Fresh relational migration tests passed");
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
