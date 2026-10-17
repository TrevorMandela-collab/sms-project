const assert = require("assert");
const Module = require("module");
const path = require("path");

const routePath = path.resolve(__dirname, "..", "routes", "auth.js");
let user;
let updates;
let auditEvents;
let schoolSuspended = false;
let insertedUsers = 0;
const database = {
  findById: async (_collection, id) => (id === user.id ? user : null),
  findUserByEmail: async (email) =>
    email === "already@example.test"
      ? { id: "other-user", email }
      : null,
  insert: async (_collection, newUser) => {
    insertedUsers += 1;
    return newUser;
  },
  update: async (_collection, id, changes) => {
    updates += 1;
    user = { ...user, ...changes, id };
    return user;
  },
  transaction: async (operation) => operation(),
};

async function withAuthRouter(run) {
  const originalLoad = Module._load;
  Module._load = function loadWithRouteStubs(request, parent, isMain) {
    if (parent?.filename === routePath && request === "../utils/db") return database;
    if (parent?.filename === routePath && request === "../middleware/auth") {
      return {
        signToken: () => "unused",
        JWT_SECRET: "test-secret",
        requireAuth: (_req, _res, next) => next(),
        requireRole: () => (_req, _res, next) => next(),
      };
    }
    if (parent?.filename === routePath && request === "../utils/roles") {
      return {
        REGISTERABLE_ROLES: ["admin", "school_admin", "teacher", "parent", "student"],
        isSchoolAdmin: (candidate) => ["admin", "school_admin"].includes(candidate?.role),
      };
    }
    if (parent?.filename === routePath && request === "jsonwebtoken") {
      return {
        verify: () => ({ id: user.id, tokenVersion: user.tokenVersion }),
      };
    }
    if (parent?.filename === routePath && request === "../middleware/rateLimiter") {
      const pass = (_req, _res, next) => next();
      return {
        authRateLimit: pass,
        loginRateLimit: pass,
        passwordResetRateLimit: pass,
      };
    }
    if (parent?.filename === routePath && request === "../utils/email") {
      return { sendPasswordResetEmail: async () => {} };
    }
    if (parent?.filename === routePath && request === "../utils/schoolStatus") {
      return { isSchoolSuspended: async () => schoolSuspended };
    }
    if (parent?.filename === routePath && request === "../utils/auditLog") {
      return {
        recordAuditEvent: async (_req, event) => auditEvents.push(event),
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
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { id: user.id, name: user.name, role: user.role, schoolId: user.schoolId };
      next();
    });
    app.use("/api/auth", router);
    server = await new Promise((resolve) => {
      const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    });
    await run(`http://127.0.0.1:${server.address().port}/api/auth/me`);
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
  user = {
    id: "profile-user",
    name: "Test User",
    email: "profile@example.test",
    role: "super_admin",
    schoolId: null,
    passwordHash: "must-not-be-returned",
    tokenVersion: 0,
  };
  updates = 0;
  auditEvents = [];

  await withAuthRouter(async (url) => {
    const changed = await fetch(url, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Updated Name", email: "NEW@example.test" }),
    });
    assert.equal(changed.status, 200);
    const result = await changed.json();
    assert.equal(result.user.name, "Updated Name");
    assert.equal(result.user.email, "new@example.test");
    assert.equal("passwordHash" in result.user, false);
    assert.deepEqual(auditEvents[0].metadata.fields.sort(), ["email", "name"]);
    assert.equal(updates, 1);

    const escalation = await fetch(url, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "super_admin", schoolId: "attacker-school" }),
    });
    assert.equal(escalation.status, 400);
    assert.equal(updates, 1);

    const duplicate = await fetch(url, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "already@example.test" }),
    });
    assert.equal(duplicate.status, 409);
    assert.equal(updates, 1);

    const invalid = await fetch(url, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "   " }),
    });
    assert.equal(invalid.status, 400);
    assert.equal(updates, 1);
  });

  user = {
    id: "suspended-school-admin",
    name: "Suspended School Admin",
    email: "school-admin@example.test",
    role: "school_admin",
    schoolId: "suspended-school",
    status: "active",
    tokenVersion: 0,
  };
  schoolSuspended = true;
  insertedUsers = 0;
  await withAuthRouter(async (url) => {
    const response = await fetch(url.replace("/me", "/register"), {
      method: "POST",
      headers: {
        authorization: "Bearer suspended-school-admin-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "New Teacher",
        email: "new-teacher@example.test",
        password: "suspended-school-password-123!",
        role: "teacher",
      }),
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, "SCHOOL_SUSPENDED");
    assert.equal(insertedUsers, 0);
  });
  schoolSuspended = false;
  console.log("Authenticated profile update tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
