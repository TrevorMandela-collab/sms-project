const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");
const { spawnSync } = require("node:child_process");

const backendDir = path.resolve(__dirname, "..");
const routePath = path.resolve(backendDir, "routes", "auth.js");
const GENERIC_MESSAGE = "If an account exists for that email, a reset link has been sent.";

function runConfig(overrides) {
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...overrides };
  for (const key of Object.keys(env)) {
    if (env[key] === undefined) delete env[key];
  }
  return spawnSync(process.execPath, ["-e", "require('./config')"], {
    cwd: backendDir,
    env,
    encoding: "utf8",
  });
}

function testConfig() {
  const production = {
    NODE_ENV: "production",
    JWT_SECRET: "t".repeat(48),
    DATABASE_URL: "postgres://localhost/test",
    FRONTEND_URL: "https://frontend.example.test",
  };

  let result = runConfig(production);
  assert.notEqual(result.status, 0, "production without EMAIL_PROVIDER must not start");
  assert.match(result.stderr, /EMAIL_PROVIDER/);

  result = runConfig({ ...production, EMAIL_PROVIDER: "smtp" });
  assert.notEqual(result.status, 0, "smtp without SMTP settings must not start");
  assert.match(result.stderr, /SMTP_HOST/);

  result = runConfig({ ...production, EMAIL_PROVIDER: "console" });
  assert.notEqual(result.status, 0, "unknown EMAIL_PROVIDER must not start");
  assert.match(result.stderr, /EMAIL_PROVIDER/);

  result = runConfig({ ...production, EMAIL_PROVIDER: "disabled" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /EMAIL_PROVIDER=disabled/);

  result = runConfig({ ...production, EMAIL_PROVIDER: "disabled", DATABASE_URL: undefined });
  assert.notEqual(result.status, 0, "disabled mode must still require DATABASE_URL");
  assert.match(result.stderr, /DATABASE_URL/);

  result = runConfig({ ...production, EMAIL_PROVIDER: "disabled", JWT_SECRET: "short" });
  assert.notEqual(result.status, 0, "disabled mode must still require a strong JWT_SECRET");
  assert.match(result.stderr, /JWT_SECRET/);

  result = runConfig({
    ...production,
    EMAIL_PROVIDER: "disabled",
    FRONTEND_URL: "http://frontend.example.test",
  });
  assert.notEqual(result.status, 0, "disabled mode must still require an HTTPS frontend");
  assert.match(result.stderr, /HTTPS/);

  result = runConfig({ JWT_SECRET: "t".repeat(48) });
  assert.equal(result.status, 0, "non-production startup must be unchanged");
}

async function callForgotPassword(emailProvider) {
  const calls = { db: [], mail: [] };
  const passThrough = (_req, _res, next) => next();
  const stubs = {
    "../utils/db": {
      findUserByEmail: async (email) => {
        calls.db.push("findUserByEmail");
        return { id: "reset-test-user", email, name: "Reset Test User" };
      },
      transaction: async (callback) => {
        calls.db.push("transaction");
        return callback();
      },
      markPasswordResetsUsed: async () => {
        calls.db.push("markPasswordResetsUsed");
      },
      insert: async () => {
        calls.db.push("insert");
      },
    },
    "../middleware/auth": {
      signToken: () => "unused-test-jwt",
      requireAuth: passThrough,
      requireRole: () => passThrough,
    },
    "../middleware/rateLimiter": {
      authRateLimit: passThrough,
      loginRateLimit: passThrough,
      passwordResetRateLimit: passThrough,
    },
    "../utils/schoolStatus": { isSchoolSuspended: async () => false },
    "../utils/email": {
      sendPasswordResetEmail: async (details) => {
        calls.mail.push(details);
        return true;
      },
    },
    "../utils/auditLog": { recordAuditEvent: async () => {} },
  };

  const originalLoad = Module._load;
  const previousProvider = process.env.EMAIL_PROVIDER;
  try {
    if (emailProvider === undefined) delete process.env.EMAIL_PROVIDER;
    else process.env.EMAIL_PROVIDER = emailProvider;
    Module._load = function loadWithStubs(requested, parent, isMain) {
      if (parent?.filename === routePath && stubs[requested]) return stubs[requested];
      return originalLoad.call(this, requested, parent, isMain);
    };
    delete require.cache[routePath];
    const router = require(routePath);
    const layer = router.stack.find((entry) => entry.route?.path === "/forgot-password");
    assert.ok(layer, "forgot-password route must be registered");
    const handler = layer.route.stack.at(-1).handle;

    let status = 200;
    const body = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("forgot-password handler did not respond")),
        3000,
      );
      const res = {
        status(code) {
          status = code;
          return this;
        },
        json(payload) {
          clearTimeout(timer);
          resolve(payload);
          return this;
        },
      };
      handler({ body: { email: "someone@example.test" }, get: () => undefined }, res);
    });
    return { status, body, calls };
  } finally {
    Module._load = originalLoad;
    delete require.cache[routePath];
    if (previousProvider === undefined) delete process.env.EMAIL_PROVIDER;
    else process.env.EMAIL_PROVIDER = previousProvider;
  }
}

async function main() {
  testConfig();

  const disabled = await callForgotPassword("disabled");
  assert.equal(disabled.status, 503);
  assert.equal(disabled.body.success, false);
  assert.equal(disabled.body.error.code, "EMAIL_NOT_CONFIGURED");
  assert.doesNotMatch(JSON.stringify(disabled.body), /token|[0-9a-f]{32,}/i);
  assert.deepEqual(disabled.calls.db, [], "disabled mode must not touch the database");
  assert.equal(disabled.calls.mail.length, 0, "disabled mode must not attempt to send mail");

  const smtp = await callForgotPassword("smtp");
  assert.equal(smtp.status, 200);
  assert.equal(smtp.body.message, GENERIC_MESSAGE);
  assert.equal(Object.hasOwn(smtp.body, "token"), false);
  assert.equal(smtp.calls.mail.length, 1, "smtp mode must still send the reset email");
  assert.equal(smtp.calls.mail[0].email, "someone@example.test");

  const unset = await callForgotPassword(undefined);
  assert.equal(unset.status, 200);
  assert.equal(unset.body.message, GENERIC_MESSAGE);
  assert.equal(Object.hasOwn(unset.body, "token"), false);

  console.log("email-disabled tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});