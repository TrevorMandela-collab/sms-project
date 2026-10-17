const assert = require("assert");
const Module = require("module");
const path = require("path");
const Database = require("better-sqlite3");
const express = require("express");
const { REGISTERABLE_ROLES, requireRole, requirePlatformAdmin } = require("../utils/roles");

const migration = require("../migrations/007_platform_admin_roles");
const routePath = path.resolve(__dirname, "..", "routes", "schools.js");

function checkMiddleware(middleware, role) {
  let status = 200;
  let continued = false;
  const response = {
    status(code) {
      status = code;
      return this;
    },
    json() {
      return this;
    },
  };
  middleware({ user: role ? { id: "user-id", role } : null }, response, () => {
    continued = true;
  });
  return { status, continued };
}

async function testRoleMigration() {
  const database = new Database(":memory:");
  database.exec(`
    CREATE TABLE roles (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO roles VALUES
      ('admin', 'Administrator', 'legacy-created', 'legacy-updated'),
      ('teacher', 'Teacher', 'legacy-created', 'legacy-updated');
  `);
  await migration.up({
    dialect: "sqlite",
    execute: async (sql, values) => database.prepare(sql).run(...values),
  });
  assert.deepEqual(
    database
      .prepare("SELECT code, name FROM roles ORDER BY code")
      .all()
      .map(({ code, name }) => [code, name]),
    [
      ["admin", "Administrator"],
      ["school_admin", "School Administrator"],
      ["super_admin", "Super Administrator"],
      ["teacher", "Teacher"],
    ],
  );
  assert.deepEqual(
    database
      .prepare("SELECT created_at, updated_at FROM roles WHERE code = 'admin'")
      .get(),
    { created_at: "legacy-created", updated_at: "legacy-updated" },
    "migration must leave legacy role rows unchanged",
  );
  database.close();
}

async function testPlatformSchoolRoutes() {
  const schools = new Map([
    ["school-stable-id", {
      id: "school-stable-id",
      name: "Existing School",
      createdAt: "2026-01-01T00:00:00.000Z",
      settings: {},
    }],
  ]);
  const users = new Map();
  const auditEvents = [];
  const database = {
    readAll: async () => [...schools.values()],
    findById: async (_collection, id) => schools.get(id) || null,
    findUserByEmail: async (email) =>
      [...users.values()].find((user) => user.email === email) || null,
    insert: async (_collection, school) => {
      if (_collection === "schools") {
        schools.set(school.id, school);
        return school;
      }
      users.set(school.id, school);
      return school;
    },
    update: async (_collection, id, updates) => {
      const school = { ...schools.get(id), ...updates, id };
      schools.set(id, school);
      return school;
    },
    transaction: async (operation) => operation(),
  };
  const auth = {
    requireAuth: (_req, _res, next) => next(),
    requireRole,
    requirePlatformAdmin,
  };
  const originalLoad = Module._load;
  Module._load = function loadWithRouteStubs(request, parent, isMain) {
    if (parent?.filename === routePath && request === "../utils/db") return database;
    if (parent?.filename === routePath && request === "../middleware/auth") return auth;
    if (parent?.filename === routePath && request === "../utils/auditLog") {
      return {
        recordAuditEvent: async (_req, event) => {
          auditEvents.push(event);
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  let server;
  try {
    delete require.cache[routePath];
    const router = require(routePath);
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = {
        id: "operator-id",
        name: "Operator",
        role: req.get("x-test-role"),
        schoolId: req.get("x-test-school") || null,
      };
      next();
    });
    app.use("/api/schools", router);
    server = await new Promise((resolve) => {
      const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}/api/schools/platform`;
    const request = (url, role, options = {}) =>
      fetch(url, {
        ...options,
        headers: {
          "content-type": "application/json",
          "x-test-role": role,
          ...(options.headers || {}),
        },
      });

    for (const role of ["admin", "school_admin"]) {
      const denied = await request(baseUrl, role);
      assert.equal(denied.status, 403, `${role} must not access platform schools`);
    }

    const listed = await request(baseUrl, "super_admin");
    assert.equal(listed.status, 200);
    assert.deepEqual((await listed.json()).schools.map((school) => school.id), [
      "school-stable-id",
    ]);

    const createdResponse = await request(baseUrl, "super_admin", {
      method: "POST",
      body: JSON.stringify({
        id: "attacker-chosen-id",
        schoolId: "attacker-chosen-id",
        name: "New School",
      }),
    });
    assert.equal(createdResponse.status, 201);
    const created = (await createdResponse.json()).school;
    assert.notEqual(created.id, "attacker-chosen-id");
    assert.equal(created.createdBy, "operator-id");
    assert.deepEqual(created.settings, { status: "active" });

    const changed = await request(`${baseUrl}/school-stable-id`, "super_admin", {
      method: "PATCH",
      body: JSON.stringify({
        id: "different-id",
        name: "Renamed School",
        lifecycleStatus: "suspended",
      }),
    });
    assert.equal(changed.status, 200);
    const suspendedSchool = (await changed.json()).school;
    assert.equal(suspendedSchool.id, "school-stable-id");
    assert.equal(suspendedSchool.settings.status, "suspended");
    const invalidLifecycle = await request(
      `${baseUrl}/school-stable-id`,
      "super_admin",
      {
        method: "PATCH",
        body: JSON.stringify({ lifecycleStatus: "deleted" }),
      },
    );
    assert.equal(invalidLifecycle.status, 400);

    const createAdminUrl = `${baseUrl}/school-stable-id/admins`;
    for (const role of ["admin", "school_admin"]) {
      const denied = await request(createAdminUrl, role, {
        method: "POST",
        body: JSON.stringify({
          name: "Test School Admin",
          email: "school-admin@example.test",
          password: "local-test-password-123",
        }),
      });
      assert.equal(denied.status, 403, `${role} must not provision school admins`);
    }

    const invalidAdmin = await request(createAdminUrl, "super_admin", {
      method: "POST",
      body: JSON.stringify({
        name: "Test School Admin",
        email: "school-admin@example.test",
        password: "short",
      }),
    });
    assert.equal(invalidAdmin.status, 400);

    const createdAdminResponse = await request(createAdminUrl, "super_admin", {
      method: "POST",
      body: JSON.stringify({
        name: "Test School Admin",
        email: "SCHOOL-ADMIN@example.test",
        password: "local-test-password-123",
      }),
    });
    assert.equal(createdAdminResponse.status, 201);
    const createdAdmin = (await createdAdminResponse.json()).user;
    assert.equal(createdAdmin.role, "school_admin");
    assert.equal(createdAdmin.schoolId, "school-stable-id");
    assert.equal(createdAdmin.email, "school-admin@example.test");
    assert.equal("password" in createdAdmin, false);
    assert.equal("passwordHash" in createdAdmin, false);
    assert.ok(users.get(createdAdmin.id).passwordHash);
    assert.ok(
      auditEvents.some(
        (event) => event.action === "PLATFORM_SCHOOL_ADMIN_CREATED",
      ),
    );

    assert.equal(checkMiddleware(requireRole("admin"), "super_admin").status, 403);
    assert.equal(checkMiddleware(requireRole("admin"), "school_admin").continued, true);
    assert.equal(checkMiddleware(requirePlatformAdmin, "super_admin").continued, true);
    assert.equal(checkMiddleware(requirePlatformAdmin, "admin").status, 403);
    assert.equal(REGISTERABLE_ROLES.includes("super_admin"), false);
    assert.equal(REGISTERABLE_ROLES.includes("school_admin"), true);

    const schoolSettings = await request(
      `${new URL(baseUrl).origin}/api/schools/me`,
      "school_admin",
      {
        method: "PATCH",
        headers: { "x-test-school": "school-stable-id" },
        body: JSON.stringify({ name: "Updated Existing School" }),
      },
    );
    assert.equal(schoolSettings.status, 200);
    assert.ok(
      auditEvents.some((event) => event.action === "SCHOOL_SETTINGS_UPDATED"),
      "school settings changes must be audited",
    );
    assert.equal(
      schools.get("school-stable-id").settings.status,
      "suspended",
      "school administrators must not be able to change lifecycle status",
    );
  } finally {
    if (server) {
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
    Module._load = originalLoad;
    delete require.cache[routePath];
  }
}

async function run() {
  await testRoleMigration();
  await testPlatformSchoolRoutes();
  console.log("Platform role and school permission tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
