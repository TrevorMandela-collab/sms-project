process.env.SQLITE_PATH = ":memory:";
process.env.DATABASE_URL = "";

const assert = require("node:assert/strict");
const db = require("../utils/db");

async function addInvite(id, expiresAt) {
  await db.insert("invite-codes", {
    id,
    code: `${id}-CODE`,
    role: "parent",
    schoolId: "invite-test-school",
    createdBy: "invite-test-admin",
    createdAt: new Date().toISOString(),
    expiresAt,
    used: false,
  });
}

async function addUser(id) {
  await db.insert("users", {
    id,
    name: "Isolated Invite Test",
    email: `${id}@example.test`,
    passwordHash: "not-a-login-credential",
    role: "parent",
    schoolId: "invite-test-school",
    childIds: [],
    status: "active",
    tokenVersion: 0,
    createdAt: new Date().toISOString(),
  });
}

async function run() {
  await db.migrate();
  await db.insert("schools", {
    id: "invite-test-school",
    name: "Isolated Invite Test School",
    createdAt: new Date().toISOString(),
  });
  await addUser("invite-test-user-a");
  await addUser("invite-test-user-b");

  await addInvite(
    "concurrent-invite",
    new Date(Date.now() + 60_000).toISOString(),
  );
  const claims = await Promise.all([
    db.claimInvite("concurrent-invite", "invite-test-user-a"),
    db.claimInvite("concurrent-invite", "invite-test-user-b"),
  ]);
  assert.equal(claims.filter(Boolean).length, 1);

  await addInvite(
    "expired-invite",
    new Date(Date.now() - 60_000).toISOString(),
  );
  assert.equal(
    await db.claimInvite("expired-invite", "invite-test-user-a"),
    false,
  );

  const redeemed = await db.findById("invite-codes", "concurrent-invite");
  assert.ok(redeemed.usedAt);
  assert.ok(redeemed.usedByUserId);
  console.log("Invite atomic-claim tests passed");
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.close();
  });
