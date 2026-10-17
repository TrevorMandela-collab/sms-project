require("dotenv").config();

const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const readline = require("readline");

if (!process.env.DATABASE_URL && !process.env.SQLITE_PATH) {
  throw new Error(
    "Set DATABASE_URL or an explicit SQLITE_PATH for the operator-selected database.",
  );
}

const db = require("../utils/db");

function askSecret(question) {
  const input = process.stdin;
  if (!input.isTTY || typeof input.setRawMode !== "function") {
    return Promise.reject(new Error("Super Admin provisioning requires an interactive terminal."));
  }

  readline.emitKeypressEvents(input);
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = (error) => {
      input.removeListener("keypress", onKeypress);
      input.setRawMode(false);
      process.stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const onKeypress = (character, key = {}) => {
      if (key.ctrl && key.name === "c") {
        finish(new Error("Provisioning cancelled."));
      } else if (key.name === "return" || key.name === "enter") {
        finish();
      } else if (key.name === "backspace") {
        value = value.slice(0, -1);
      } else if (character && !key.ctrl && !key.meta) {
        value += character;
      }
    };

    process.stdout.write(question);
    input.setRawMode(true);
    input.on("keypress", onKeypress);
  });
}

async function run() {
  if (!process.stdin.isTTY) {
    throw new Error("Super Admin provisioning requires an interactive terminal.");
  }

  const prompt = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const name = await new Promise((resolve) =>
    prompt.question("Super Admin name: ", (answer) => resolve(answer.trim())),
  );
  const email = await new Promise((resolve) =>
    prompt.question("Super Admin email: ", (answer) => resolve(answer.trim().toLowerCase())),
  );
  prompt.close();

  if (!name || !/^\S+@\S+\.\S+$/.test(email)) {
    throw new Error("A name and valid email address are required.");
  }

  const password = await askSecret("Password (hidden): ");
  const confirmation = await askSecret("Confirm password (hidden): ");
  if (
    password.length < 12 ||
    Buffer.byteLength(password, "utf8") > 72 ||
    password !== confirmation
  ) {
    throw new Error("Passwords must match and contain 12–72 UTF-8 bytes.");
  }

  await db.migrate();
  if (await db.findUserByEmail(email, { includeDeleted: true })) {
    throw new Error("An account with that email already exists.");
  }

  const user = {
    id: crypto.randomUUID(),
    name,
    email,
    passwordHash: await bcrypt.hash(password, 12),
    role: "super_admin",
    schoolId: null,
    status: "active",
    tokenVersion: 0,
    createdAt: new Date().toISOString(),
  };
  await db.transaction(async () => {
    if (await db.findUserByEmail(email, { includeDeleted: true })) {
      throw new Error("An account with that email already exists.");
    }
    await db.insert("users", user);
    await db.insertPlatformAuditEvent({
      id: crypto.randomUUID(),
      actorUserId: user.id,
      schoolId: null,
      action: "PLATFORM_ADMIN_PROVISIONED",
      entityType: "user",
      entityId: user.id,
      timestamp: new Date().toISOString(),
      metadata: {},
      ipAddress: null,
      userAgent: null,
    });
  });

  console.log(`Provisioned Super Admin ${user.email} (${user.id}).`);
}

run()
  .catch((error) => {
    console.error(`[provision:super-admin] ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.close().catch(() => {});
  });
