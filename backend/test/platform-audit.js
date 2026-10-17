const assert = require("assert");
const Module = require("module");
const path = require("path");

process.env.DATABASE_URL = "";
process.env.SQLITE_PATH = ":memory:";

const db = require("../utils/db");
const roles = require("../utils/roles");
const { recordAuditEvent } = require("../utils/auditLog");
const routePath = path.resolve(__dirname, "..", "routes", "audit-logs.js");

async function testPlatformAuditStorage() {
  await db.migrate();
  const record = await recordAuditEvent(
    { ip: "127.0.0.1", get: () => "platform-audit-test" },
    {
      action: "PLATFORM_AUDIT_TEST",
      entityType: "test",
      entityId: "test-entity",
      metadata: { source: "isolated-test" },
      actor: { id: null, role: "super_admin", schoolId: null },
    },
  );
  assert.equal(record.schoolId, null);
  const listed = await db.listPlatformAuditLogs({ page: 1, limit: 10 });
  assert.equal(listed.meta.total, 1);
  assert.equal(listed.data[0].action, "PLATFORM_AUDIT_TEST");
  assert.deepEqual(listed.data[0].metadata, { source: "isolated-test" });
  await assert.rejects(
    recordAuditEvent(
      {},
      {
        action: "INVALID",
        entityType: "test",
        actor: { id: "school-user", role: "admin", schoolId: null },
      },
    ),
    /without an authenticated school/,
  );
}

async function testPlatformAuditRouteAuthorization() {
  const originalLoad = Module._load;
  Module._load = function loadWithAuthStub(request, parent, isMain) {
    if (parent?.filename === routePath && request === "../middleware/auth") {
      return {
        requireAuth: (_req, _res, next) => next(),
        requireRole: () => (_req, _res, next) => next(),
        requirePlatformAdmin: roles.requirePlatformAdmin,
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  let server;
  try {
    delete require.cache[routePath];
    const router = require(routePath);
    const express = require("express");
    const app = express();
    app.use((req, _res, next) => {
      req.user = { role: req.get("x-test-role"), schoolId: "school-a" };
      next();
    });
    app.use("/api/audit-logs", router);
    server = await new Promise((resolve) => {
      const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    });
    const url = `http://127.0.0.1:${server.address().port}/api/audit-logs/platform`;
    const denied = await fetch(url, { headers: { "x-test-role": "school_admin" } });
    assert.equal(denied.status, 403);
    const allowed = await fetch(url, { headers: { "x-test-role": "super_admin" } });
    assert.equal(allowed.status, 200);
    assert.equal((await allowed.json()).meta.total, 1);
    const invalidPagination = await fetch(`${url}?limit=101`, {
      headers: { "x-test-role": "super_admin" },
    });
    assert.equal(invalidPagination.status, 400);
  } finally {
    if (server) {
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
    delete require.cache[routePath];
    Module._load = originalLoad;
  }
}

async function run() {
  try {
    await testPlatformAuditStorage();
    await testPlatformAuditRouteAuthorization();
    console.log("Platform audit storage and authorization tests passed");
  } finally {
    await db.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
