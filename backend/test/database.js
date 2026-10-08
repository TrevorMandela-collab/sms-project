const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "sms-database-test-"));
process.env.SQLITE_PATH = path.join(tempDirectory, "test.sqlite");
process.env.DATABASE_URL = "";

const db = require("../utils/db");

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function run() {
  await db.ensureSchema();
  assert.deepEqual(await db.readAll("transaction-tests"), []);

  await db.transaction(async () => {
    await db.insert("transaction-tests", { id: "committed", value: 1 });
    await db.insert("transaction-tests", { id: "also-committed", value: 2 });
  });
  assert.equal(await db.findById("transaction-tests", "committed").then(Boolean), true);

  await assert.rejects(
    db.transaction(async () => {
      await db.insert("transaction-tests", { id: "rolled-back", value: 3 });
      throw new Error("expected rollback");
    }),
    /expected rollback/,
  );
  assert.equal(await db.findById("transaction-tests", "rolled-back"), null);

  await db.transaction(async () => {
    await db.insert("transaction-tests", { id: "outer", value: 4 });
    await assert.rejects(
      db.transaction(async () => {
        await db.insert("transaction-tests", { id: "nested-rollback", value: 5 });
        throw new Error("expected savepoint rollback");
      }),
      /expected savepoint rollback/,
    );
    await db.insert("transaction-tests", { id: "outer-after-savepoint", value: 6 });
  });
  assert.ok(await db.findById("transaction-tests", "outer"));
  assert.equal(await db.findById("transaction-tests", "nested-rollback"), null);
  assert.ok(await db.findById("transaction-tests", "outer-after-savepoint"));

  const entered = deferred();
  const finish = deferred();
  const transaction = db.transaction(async () => {
    await db.insert("transaction-tests", { id: "concurrent-rollback", value: 7 });
    entered.resolve();
    await finish.promise;
    throw new Error("expected concurrent rollback");
  });
  await entered.promise;
  const outsideWrite = db.insert("transaction-tests", {
    id: "outside-transaction",
    value: 8,
  });
  finish.resolve();
  await assert.rejects(transaction, /expected concurrent rollback/);
  await outsideWrite;
  assert.equal(await db.findById("transaction-tests", "concurrent-rollback"), null);
  assert.ok(await db.findById("transaction-tests", "outside-transaction"));

  console.log("Database transaction tests passed");
}

run()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.close();
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });
