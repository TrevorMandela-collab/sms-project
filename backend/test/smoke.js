const assert = require("assert");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const fs = require("fs");
const Module = require("module");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");
const WebSocket = require("ws");
const { spawn, spawnSync } = require("child_process");

const port = 4311;
const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "sms-smoke-test-"));
const databasePath = path.join(tempDirectory, "smoke-test.sqlite");
const repositoryDataDirectory = path.resolve(__dirname, "..", "data");
const baseUrl = `http://127.0.0.1:${port}/api`;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function openRealtimeSocket(token) {
  const suffix = token ? `?token=${encodeURIComponent(token)}` : "";
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws${suffix}`);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error("WebSocket did not connect before the timeout"));
    }, 3000);
    const cleanup = () => {
      clearTimeout(timer);
      socket.removeListener("open", onOpen);
      socket.removeListener("error", onError);
    };
    const onOpen = () => {
      cleanup();
      resolve(socket);
    };
    const onError = (error) => {
      cleanup();
      socket.terminate();
      reject(error);
    };
    socket.once("open", onOpen);
    socket.once("error", onError);
  });
}

function waitForRealtimeClose(token) {
  const suffix = token ? `?token=${encodeURIComponent(token)}` : "";
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws${suffix}`);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error("WebSocket did not close before the timeout"));
    }, 3000);
    socket.on("error", () => {});
    socket.once("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

function nextRealtimeMessage(socket, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.removeListener("message", onMessage);
      reject(new Error("Expected WebSocket notification was not received"));
    }, timeoutMs);
    const onMessage = (raw) => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(raw.toString()));
      } catch (error) {
        reject(error);
      }
    };
    socket.once("message", onMessage);
  });
}

function expectNoRealtimeMessage(socket, timeoutMs = 200) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      socket.removeListener("message", onMessage);
      socket.removeListener("close", onClose);
    };
    const onMessage = () => {
      cleanup();
      reject(new Error("Unauthorized WebSocket received a chat notification"));
    };
    const onClose = (code) => {
      cleanup();
      reject(new Error(`WebSocket closed unexpectedly with code ${code}`));
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, timeoutMs);
    socket.once("message", onMessage);
    socket.once("close", onClose);
  });
}

function getProtectedRouteChecks() {
  const checks = [];
  const crudCollections = [
    "students",
    "teachers",
    "subjects",
    "classes",
    "assignments",
    "assignment-submissions",
    "announcements",
    "attendance",
    "fees",
    "exams",
    "timetable",
    "library",
    "library-loans",
    "events",
  ];
  for (const collection of crudCollections) {
    checks.push(
      ["GET", `/${collection}`],
      ["POST", `/${collection}`],
      ["GET", `/${collection}/authz-missing-record`],
      ["PATCH", `/${collection}/authz-missing-record`],
      ["DELETE", `/${collection}/authz-missing-record`],
    );
  }
  checks.push(
    ["POST", "/auth/password/change"],
    ["GET", "/auth/me"],
    ["PATCH", "/auth/me"],
    ["POST", "/auth/logout"],
    ["GET", "/auth/users"],
    ["PATCH", "/auth/users/authz-missing-user/role"],
    ["PATCH", "/auth/users/authz-missing-user"],
    ["PATCH", "/auth/users/authz-missing-user/status"],
    ["DELETE", "/auth/users/authz-missing-user"],
    ["GET", "/schools/me"],
    ["PATCH", "/schools/me"],
    ["GET", "/schools/platform"],
    ["POST", "/schools/platform"],
    ["GET", "/schools/platform/authz-missing-school"],
    ["PATCH", "/schools/platform/authz-missing-school"],
    ["POST", "/schools/platform/authz-missing-school/admins"],
    ["GET", "/audit-logs"],
    ["GET", "/audit-logs/platform"],
    ["POST", "/invite-codes"],
    ["GET", "/invite-codes"],
    ["DELETE", "/invite-codes/authz-missing-invite"],
    ["GET", "/chats"],
    ["POST", "/chats"],
    ["PATCH", "/chats/authz-missing-chat"],
    ["POST", "/chats/authz-missing-chat/regenerate-code"],
    ["DELETE", "/chats/authz-missing-chat"],
    ["POST", "/chats/join"],
    ["GET", "/chats/authz-missing-chat/messages"],
    ["POST", "/chats/authz-missing-chat/messages"],
    ["PATCH", "/chats/authz-missing-chat/messages/authz-missing-message"],
    ["DELETE", "/chats/authz-missing-chat/messages/authz-missing-message"],
    ["POST", "/chats/authz-missing-chat/messages/authz-missing-message/react"],
    ["GET", "/qa/access"],
    ["GET", "/qa/results?environment=development"],
    ["PUT", "/qa/results/AUTH-001"],
    ["GET", "/qa/bugs?environment=development"],
    ["POST", "/qa/bugs"],
    ["PATCH", "/qa/bugs/00000000-0000-4000-8000-000000000000"],
  );
  return checks;
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (child.closed) {
      resolve();
      return;
    }

    const timer = setTimeout(() => {
      child.removeListener("close", onClose);
      child.removeListener("error", onError);
      reject(new Error("Smoke-test server did not exit before the timeout"));
    }, timeoutMs);
    const cleanup = () => clearTimeout(timer);
    const onClose = () => {
      cleanup();
      resolve();
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    child.once("close", onClose);
    child.once("error", onError);
  });
}

async function stopServer(child) {
  const exited = waitForExit(child, 5000);
  child.kill();
  try {
    await exited;
  } catch (error) {
    child.kill("SIGKILL");
    await waitForExit(child, 1000).catch(() => {});
    throw error;
  }
}

async function request(endpoint, options = {}) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      return await fetch(`${baseUrl}${endpoint}`, options);
    } catch (error) {
      if (attempt === 99) throw error;
      await wait(100);
    }
  }
}

async function assertProductionForgotPasswordDoesNotDiscloseToken() {
  const routePath = path.resolve(__dirname, "..", "routes", "auth.js");
  const originalLoad = Module._load;
  const previousNodeEnv = process.env.NODE_ENV;
  const previousTestMode = process.env.PASSWORD_RESET_TOKEN_TEST_MODE;
  const passThrough = (_req, _res, next) => next();
  const databaseStub = {
    findUserByEmail: async (email) => ({
      id: "production-reset-test-user",
      email,
      name: "Reset Test User",
    }),
    transaction: async (callback) => callback(),
    markPasswordResetsUsed: async () => {},
    insert: async () => {},
  };
  const dependencyStubs = {
    "../utils/db": databaseStub,
    "../middleware/auth": {
      signToken: () => "unused-test-jwt",
      requireAuth: passThrough,
      requireRole: () => passThrough,
    },
    "../middleware/rateLimiter": {
      authRateLimit: (_req, _res, next) => next(),
      loginRateLimit: (_req, _res, next) => next(),
      passwordResetRateLimit: (_req, _res, next) => next(),
    },
    "../utils/schoolStatus": { isSchoolSuspended: async () => false },
    "../utils/email": { sendPasswordResetEmail: async () => false },
    "../utils/auditLog": { recordAuditEvent: async () => {} },
  };

  try {
    process.env.NODE_ENV = "production";
    process.env.PASSWORD_RESET_TOKEN_TEST_MODE = "true";
    Module._load = function loadWithRouteStubs(requested, parent, isMain) {
      if (parent?.filename === routePath && dependencyStubs[requested]) {
        return dependencyStubs[requested];
      }
      return originalLoad.call(this, requested, parent, isMain);
    };
    delete require.cache[routePath];
    const router = require(routePath);
    const forgotPasswordRoute = router.stack.find(
      (layer) => layer.route?.path === "/forgot-password",
    );
    assert.ok(forgotPasswordRoute, "forgot-password route must be registered");

    let responseStatus = 200;
    let resolveResponse;
    const responseBodyPromise = new Promise((resolve) => {
      resolveResponse = resolve;
    });
    const response = {
      status(status) {
        responseStatus = status;
        return this;
      },
      json(body) {
        resolveResponse(body);
        return this;
      },
    };
    const handler = forgotPasswordRoute.route.stack.at(-1).handle;
    handler(
      {
        body: { email: "production-reset@example.test" },
        get: (name) =>
          name.toLowerCase() === "x-local-password-reset-test" ? "true" : undefined,
      },
      response,
    );
    const body = await responseBodyPromise;
    assert.equal(responseStatus, 200);
    assert.deepEqual(body, {
      success: true,
      message: "If an account exists for that email, a reset link has been sent.",
    });
  } finally {
    Module._load = originalLoad;
    delete require.cache[routePath];
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousTestMode === undefined) {
      delete process.env.PASSWORD_RESET_TOKEN_TEST_MODE;
    } else {
      process.env.PASSWORD_RESET_TOKEN_TEST_MODE = previousTestMode;
    }
  }
}

async function run() {
  let server;
  let realtimeSocket;
  const realtimeSockets = [];
  let output = "";

  try {
    await assertProductionForgotPasswordDoesNotDiscloseToken();

    assert.equal(
      path.dirname(databasePath),
      tempDirectory,
      "smoke-test database must be inside its unique temporary directory",
    );
    assert.notEqual(
      path.dirname(databasePath),
      repositoryDataDirectory,
      "smoke-test database must not use the repository data directory",
    );
    assert.equal(
      fs.existsSync(databasePath),
      false,
      "new temporary database path must not already exist",
    );

    server = spawn(process.execPath, ["server.js"], {
      cwd: path.join(__dirname, ".."),
      env: {
        ...process.env,
        PORT: String(port),
        SQLITE_PATH: databasePath,
        DATABASE_URL: "",
        JWT_SECRET: "smoke-test-secret",
        NODE_ENV: "test",
        PASSWORD_RESET_TOKEN_TEST_MODE: "false",
        TRUST_PROXY_HOPS: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stdout.on("data", (chunk) => {
      output += chunk;
    });
    server.stderr.on("data", (chunk) => {
      output += chunk;
    });

    const health = await request("/health");
    assert.equal(health.status, 200, "health endpoint should respond");
    for (const [method, endpoint] of getProtectedRouteChecks()) {
      const response = await request(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: ["POST", "PATCH", "PUT"].includes(method)
          ? JSON.stringify({})
          : undefined,
      });
      assert.equal(
        response.status,
        401,
        `${method} ${endpoint} must reject unauthenticated requests`,
      );
    }
    const allowedOrigin = await request("/health", {
      headers: { Origin: "http://localhost:5500" },
    });
    assert.equal(
      allowedOrigin.headers.get("access-control-allow-origin"),
      "http://localhost:5500",
      "configured local frontend origin should be allowed by CORS",
    );
    const deniedOrigin = await request("/health", {
      headers: { Origin: "https://untrusted.example" },
    });
    assert.equal(
      deniedOrigin.headers.get("access-control-allow-origin"),
      null,
      "unconfigured frontend origins must not be allowed by CORS",
    );

    const invalidProductionConfig = spawnSync(
      process.execPath,
      ["-e", "require('./config')"],
      {
        cwd: path.join(__dirname, ".."),
        env: {
          ...process.env,
          NODE_ENV: "production",
          JWT_SECRET: "",
          DATABASE_URL: "",
          FRONTEND_URL: "",
        },
        encoding: "utf8",
      },
    );
    assert.notEqual(
      invalidProductionConfig.status,
      0,
      "production must refuse to start without a JWT secret",
    );
    assert.match(
      invalidProductionConfig.stderr,
      /JWT_SECRET must be set/,
      "production configuration failure should identify the missing secret",
    );

    const bootstrapAttempts = [
      {
        email: "smoke@example.test",
        body: {
          name: "Smoke Admin",
          email: "smoke@example.test",
          password: "smoke-test-password-123!",
          role: "admin",
          schoolName: "Smoke School",
        },
      },
      {
        email: "second-smoke@example.test",
        body: {
          name: "Second Smoke Admin",
          email: "second-smoke@example.test",
          password: "second-smoke-password-456!",
          role: "admin",
          schoolName: "Second Smoke School",
        },
      },
    ];
    const bootstrapResponses = await Promise.all(
      bootstrapAttempts.map(({ body }) =>
        request("/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      ),
    );
    const winningBootstrapIndex = bootstrapResponses.findIndex(
      (response) => response.status === 201,
    );
    const registrations = bootstrapResponses.filter(
      (response) => response.status === 201,
    );
    const rejectedBootstrapIndex = bootstrapResponses.findIndex(
      (response) => response.status === 403,
    );
    assert.equal(
      registrations.length,
      1,
      "exactly one concurrent unauthenticated request may bootstrap the first admin",
    );
    assert.notEqual(rejectedBootstrapIndex, -1, "the losing bootstrap request must be denied");
    assert.equal(bootstrapResponses[rejectedBootstrapIndex].status, 403);
    assert.notEqual(winningBootstrapIndex, -1, "one bootstrap request must win");
    const registration = registrations[0];
    const auth = await registration.json();
    const accountEmail = bootstrapAttempts[winningBootstrapIndex].email;
    const originalPassword = bootstrapAttempts[winningBootstrapIndex].body.password;
    const expectedSchoolName = bootstrapAttempts[winningBootstrapIndex].body.schoolName;
    const losingEmail = bootstrapAttempts[rejectedBootstrapIndex].email;
    const bootstrapDatabase = new Database(databasePath);
    try {
      assert.equal(
        bootstrapDatabase
          .prepare("SELECT COUNT(*) AS count FROM users")
          .get().count,
        1,
        "only one user may be created by concurrent bootstrap requests",
      );
      assert.equal(
        bootstrapDatabase
          .prepare("SELECT COUNT(*) AS count FROM users WHERE role_code = 'admin'")
          .get().count,
        1,
        "only one first-admin account may be created",
      );
      assert.equal(
        bootstrapDatabase
          .prepare("SELECT COUNT(*) AS count FROM schools")
          .get().count,
        1,
        "only one bootstrap school may be created",
      );
      assert.equal(
        bootstrapDatabase
          .prepare("SELECT COUNT(*) AS count FROM users WHERE email = ?")
          .get(losingEmail).count,
        0,
        "the losing bootstrap email must not be persisted",
      );
    } finally {
      bootstrapDatabase.close();
    }

    const unauthorizedSecondRegistration = await request("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Unauthorized Second Admin",
        email: "second-smoke@example.test",
        password: "second-smoke-password-123!",
        role: "admin",
        schoolName: "Unauthorized School",
      }),
    });
    assert.equal(
      unauthorizedSecondRegistration.status,
      403,
      "a later unauthenticated registration must not create another account",
    );
    const afterDeniedBootstrap = new Database(databasePath);
    try {
      assert.equal(
        afterDeniedBootstrap
          .prepare("SELECT COUNT(*) AS count FROM users")
          .get().count,
        1,
        "denied unauthenticated registration must not create a second account",
      );
    } finally {
      afterDeniedBootstrap.close();
    }
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${auth.token}`,
    };

    const expiredToken = jwt.sign(
      { id: auth.user.id, tokenVersion: auth.user.tokenVersion || 0 },
      "smoke-test-secret",
      { expiresIn: -1 },
    );
    const expiredSession = await request("/auth/me", {
      headers: {
        ...headers,
        Authorization: `Bearer ${expiredToken}`,
      },
    });
    assert.equal(
      expiredSession.status,
      401,
      "expired bearer tokens must be rejected",
    );

    const suspendedRegistration = await request("/auth/register", {
      method: "POST",
      headers: { ...headers, "X-Forwarded-For": "198.51.100.30" },
      body: JSON.stringify({
        name: "Suspension Regression User",
        email: "suspension-regression@example.test",
        password: "suspension-regression-password-123!",
        role: "teacher",
      }),
    });
    assert.equal(suspendedRegistration.status, 201);
    const suspendedAccount = await suspendedRegistration.json();
    const suspendedTokenHeaders = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${suspendedAccount.token}`,
    };
    const suspendedAccountBefore = await request("/auth/me", {
      headers: suspendedTokenHeaders,
    });
    assert.equal(
      suspendedAccountBefore.status,
      200,
      "the suspension regression token must work before suspension",
    );
    const suspendAccount = await request(
      `/auth/users/${encodeURIComponent(suspendedAccount.user.id)}/status`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({ status: "suspended" }),
      },
    );
    assert.equal(suspendAccount.status, 200, "the supported suspension route should suspend the test account");
    const suspendedAccountAfter = await request("/auth/me", {
      headers: suspendedTokenHeaders,
    });
    assert.equal(
      suspendedAccountAfter.status,
      401,
      "the original JWT must be rejected after suspension increments tokenVersion",
    );

    const deletedRegistration = await request("/auth/register", {
      method: "POST",
      headers: { ...headers, "X-Forwarded-For": "198.51.100.31" },
      body: JSON.stringify({
        name: "Soft Delete Regression User",
        email: "soft-delete-regression@example.test",
        password: "soft-delete-regression-password-123!",
        role: "teacher",
      }),
    });
    assert.equal(deletedRegistration.status, 201);
    const deletedAccount = await deletedRegistration.json();
    const deletedTokenHeaders = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${deletedAccount.token}`,
    };
    const deletedAccountBefore = await request("/auth/me", {
      headers: deletedTokenHeaders,
    });
    assert.equal(
      deletedAccountBefore.status,
      200,
      "the soft-delete regression token must work before deletion",
    );
    const deleteAccount = await request(
      `/auth/users/${encodeURIComponent(deletedAccount.user.id)}`,
      { method: "DELETE", headers },
    );
    assert.equal(deleteAccount.status, 204, "the supported user route should soft-delete the test account");
    const deletedAccountAfter = await request("/auth/me", {
      headers: deletedTokenHeaders,
    });
    assert.equal(
      deletedAccountAfter.status,
      401,
      "the original JWT must be rejected after soft deletion",
    );

    const studentResponse = await request("/students", {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Brian Kamau",
        class: "Grade 8A",
        schoolId: "another-school-id",
        createdBy: "forged-user-id",
      }),
    });
    if (studentResponse.status !== 201)
      throw new Error(
        `student creation failed: ${await studentResponse.text()}`,
      );
    const student = await studentResponse.json();
    assert.equal(
      student.createdBy,
      auth.user.id,
      "createdBy must come from the session",
    );
    assert.equal(
      student.schoolId,
      auth.user.schoolId,
      "created records must use the authenticated school's id",
    );
    const initialAuditLogs = await request("/audit-logs?page=1&limit=10", {
      headers,
    });
    assert.equal(initialAuditLogs.status, 200, "school admins should read audit logs");
    const initialAuditPage = await initialAuditLogs.json();
    assert.ok(
      initialAuditPage.data.some(
        (event) =>
          event.action === "USER_CREATED" &&
          event.entityId === auth.user.id &&
          event.schoolId === auth.user.schoolId,
      ),
      "bootstrap account creation should be auditable",
    );
    assert.ok(
      initialAuditPage.data.some(
        (event) =>
          event.action === "STUDENTS_CREATED" &&
          event.entityId === student.id &&
          event.schoolId === auth.user.schoolId,
      ),
      "student creation should be auditable",
    );
    const auditFilterOptions = await request("/audit-logs/filters", {
      headers,
    });
    assert.equal(auditFilterOptions.status, 200);
    assert.ok(
      (await auditFilterOptions.json()).actions.includes("STUDENTS_CREATED"),
      "audit action options should come from this school's recorded actions",
    );
    const auditFilterQuery = new URLSearchParams({
      action: "STUDENTS_CREATED",
      entityType: "students",
      entityId: student.id,
      actorUserId: auth.user.id,
      from: "2000-01-01",
      to: "2099-12-31",
    });
    const combinedAuditFilter = await request(
      `/audit-logs?page=1&limit=10&${auditFilterQuery}`,
      { headers },
    );
    assert.equal(combinedAuditFilter.status, 200);
    const combinedAuditPage = await combinedAuditFilter.json();
    assert.equal(combinedAuditPage.meta.total, 1);
    assert.equal(combinedAuditPage.data[0].entityId, student.id);
    const mismatchedAuditActor = await request(
      `/audit-logs?${new URLSearchParams({
        action: "STUDENTS_CREATED",
        actorUserId: "not-the-actor",
      })}`,
      { headers },
    );
    assert.equal((await mismatchedAuditActor.json()).meta.total, 0);
    const invalidAuditDate = await request("/audit-logs?from=not-a-date", {
      headers,
    });
    assert.equal(invalidAuditDate.status, 400, "audit date filters should be validated");
    const impossibleAuditDate = await request(
      "/audit-logs?from=2026-02-30",
      { headers },
    );
    assert.equal(impossibleAuditDate.status, 400);
    const invalidAuditRange = await request(
      "/audit-logs?from=2026-10-02&to=2026-10-01",
      { headers },
    );
    assert.equal(invalidAuditRange.status, 400);
    const unauthorizedAuditLogs = await request("/audit-logs", {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${await (async () => {
          const parent = await request("/auth/register", {
            method: "POST",
            headers,
            body: JSON.stringify({
              name: "Audit Test Parent",
              email: "audit-parent@example.test",
              password: "audit-parent-password-123!",
              role: "parent",
              childIds: [student.id],
            }),
          });
          return (await parent.json()).token;
        })()}`,
      },
    });
    assert.equal(
      unauthorizedAuditLogs.status,
      403,
      "parents must not read school audit logs",
    );

    const foreignStudent = {
      id: "foreign-school-student",
      name: "Foreign Student",
      class: "Grade 8A",
      schoolId: "another-school-id",
    };
    const foreignClass = {
      id: "foreign-school-class",
      name: "Grade 8A",
      schoolId: "another-school-id",
      teacherIds: [],
    };
    const foreignUser = {
      id: "foreign-school-user",
      name: "Foreign Admin",
      email: "foreign-admin@example.test",
      role: "admin",
      schoolId: "another-school-id",
      status: "active",
    };
    const foreignChat = {
      id: "foreign-school-chat",
      name: "Foreign chat",
      memberIds: [auth.user.id],
      schoolId: "another-school-id",
      inviteCode: "OTHR-SCHL",
    };
    const foreignInvite = {
      id: "foreign-school-invite",
      code: "ABCD-EFGH",
      schoolId: "another-school-id",
      role: "student",
      studentId: foreignStudent.id,
      used: false,
    };
    const foreignAuditEvent = {
      id: "foreign-school-audit-event",
      schoolId: "another-school-id",
      actorUserId: foreignUser.id,
      action: "FOREIGN_EVENT",
      entityType: "student",
      entityId: foreignStudent.id,
      timestamp: new Date().toISOString(),
      metadata: {},
    };
    const tenantDatabase = new Database(databasePath);
    tenantDatabase.pragma("foreign_keys = ON");
    const foreignCreatedAt = new Date().toISOString();
    tenantDatabase.prepare(
      "INSERT INTO schools (id, name, settings_json, onboarding_completed, created_at, updated_at, extra_data) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run("another-school-id", "Foreign School", "{}", 0, foreignCreatedAt, foreignCreatedAt, "{}");
    tenantDatabase.prepare(
      "INSERT INTO students (id, school_id, name, class_name, status, created_at, updated_at, extra_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(foreignStudent.id, foreignStudent.schoolId, foreignStudent.name, foreignStudent.class, "active", foreignCreatedAt, foreignCreatedAt, JSON.stringify({ class: foreignStudent.class }));
    tenantDatabase.prepare(
      "INSERT INTO classes (id, school_id, name, status, created_at, updated_at, extra_data) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(foreignClass.id, foreignClass.schoolId, foreignClass.name, "active", foreignCreatedAt, foreignCreatedAt, JSON.stringify({ teacherIds: [] }));
    tenantDatabase.prepare(
      "INSERT INTO library_books (id, school_id, title, copies_total, copies_available, created_at, updated_at, extra_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run("foreign-school-book", foreignUser.schoolId, "Foreign Test Book", 1, 0, foreignCreatedAt, foreignCreatedAt, "{}");
    tenantDatabase.prepare(
      "INSERT INTO library_copies (id, school_id, book_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("foreign-school-copy", foreignUser.schoolId, "foreign-school-book", "loaned", foreignCreatedAt, foreignCreatedAt);
    tenantDatabase.prepare(
      "INSERT INTO library_loans (id, school_id, copy_id, student_id, borrowed_at, due_at, created_at, updated_at, extra_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run("foreign-school-loan", foreignUser.schoolId, "foreign-school-copy", foreignStudent.id, foreignCreatedAt, new Date(Date.now() + 86400000).toISOString(), foreignCreatedAt, foreignCreatedAt, "{}");
    const foreignPasswordHash = tenantDatabase
      .prepare("SELECT password_hash FROM users WHERE id = ?")
      .get(auth.user.id).password_hash;
    tenantDatabase.prepare(
      "INSERT INTO users (id, school_id, name, email, password_hash, role_code, status, token_version, created_at, updated_at, extra_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(foreignUser.id, foreignUser.schoolId, foreignUser.name, foreignUser.email, foreignPasswordHash, "admin", "active", 0, foreignCreatedAt, foreignCreatedAt, "{}");
    tenantDatabase.prepare(
      "INSERT INTO chats (id, school_id, name, invite_code, created_at, updated_at, extra_data) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(foreignChat.id, foreignChat.schoolId, foreignChat.name, foreignChat.inviteCode, foreignCreatedAt, foreignCreatedAt, JSON.stringify({ memberIds: foreignChat.memberIds }));
    tenantDatabase.prepare(
      "INSERT INTO invite_codes (id, school_id, code, role_code, student_id, created_by, expires_at, created_at, updated_at, extra_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(foreignInvite.id, foreignInvite.schoolId, foreignInvite.code, foreignInvite.role, foreignInvite.studentId, foreignUser.id, new Date(Date.now() + 86400000).toISOString(), foreignCreatedAt, foreignCreatedAt, "{}");
    tenantDatabase.prepare(
      "INSERT INTO audit_logs (id, school_id, actor_user_id, action, entity_type, entity_id, timestamp, metadata, created_at, updated_at, extra_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(foreignAuditEvent.id, foreignAuditEvent.schoolId, foreignAuditEvent.actorUserId, foreignAuditEvent.action, foreignAuditEvent.entityType, foreignAuditEvent.entityId, foreignAuditEvent.timestamp, "{}", foreignCreatedAt, foreignCreatedAt, "{}");
    tenantDatabase.close();

    const foreignLoginResponse = await request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: foreignUser.email,
        password: originalPassword,
      }),
    });
    assert.equal(
      foreignLoginResponse.status,
      200,
      "the synthetic foreign-school account must sign in through the login route",
    );
    const foreignAuth = await foreignLoginResponse.json();
    const foreignHeaders = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${foreignAuth.token}`,
    };

    const roleRefreshDatabase = new Database(databasePath);
    roleRefreshDatabase
      .prepare("UPDATE users SET role_code = ? WHERE id = ?")
      .run("teacher", auth.user.id);
    roleRefreshDatabase.close();
    const staleAdminToken = await request("/schools/me", { headers });
    assert.equal(
      staleAdminToken.status,
      403,
      "authorization must use the current database role rather than JWT claims",
    );
    const restoreRoleDatabase = new Database(databasePath);
    restoreRoleDatabase
      .prepare("UPDATE users SET role_code = ? WHERE id = ?")
      .run("admin", auth.user.id);
    restoreRoleDatabase.close();

    const studentList = await request("/students", { headers });
    const visibleStudents = await studentList.json();
    assert.ok(
      visibleStudents.every((record) => record.id !== foreignStudent.id),
      "school admins must not list another school's students",
    );
    const foreignStudentResponse = await request(
      `/students/${foreignStudent.id}`,
      { headers },
    );
    assert.equal(
      foreignStudentResponse.status,
      404,
      "school admins must not retrieve another school's student by id",
    );
    const foreignStudentUpdate = await request(
      `/students/${foreignStudent.id}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({ name: "Tampered Student" }),
      },
    );
    assert.equal(
      foreignStudentUpdate.status,
      404,
      "school admins must not modify another school's student",
    );
    const foreignStudentDelete = await request(
      `/students/${foreignStudent.id}`,
      { method: "DELETE", headers },
    );
    assert.equal(
      foreignStudentDelete.status,
      404,
      "school admins must not delete another school's student",
    );
    const foreignAttendance = await request("/attendance", {
      method: "POST",
      headers,
      body: JSON.stringify({
        studentId: foreignStudent.id,
        date: "2026-09-24",
        status: "present",
      }),
    });
    assert.equal(
      foreignAttendance.status,
      404,
      "attendance must not reference another school's student",
    );
    const invalidAnnouncement = await request("/announcements", {
      method: "POST",
      headers,
      body: JSON.stringify({ title: " ", body: "Missing title" }),
    });
    assert.equal(
      invalidAnnouncement.status,
      400,
      "missing required announcement fields must be rejected at the API layer",
    );
    const foreignFee = await request("/fees", {
      method: "POST",
      headers,
      body: JSON.stringify({ studentId: foreignStudent.id, amount: 100 }),
    });
    assert.equal(
      foreignFee.status,
      404,
      "fees must not reference another school's student",
    );
    const foreignExam = await request("/exams", {
      method: "POST",
      headers,
      body: JSON.stringify({
        studentId: foreignStudent.id,
        subject: "Mathematics",
        score: 80,
        maxScore: 100,
      }),
    });
    assert.equal(
      foreignExam.status,
      404,
      "results must not reference another school's student",
    );
    const gradeResponse = await request("/exams", {
      method: "POST",
      headers,
      body: JSON.stringify({
        studentId: student.id,
        subject: "Mathematics",
        examName: "Term 1 Test",
        score: 80,
        maxScore: 100,
        term: "Term 1",
      }),
    });
    assert.equal(gradeResponse.status, 201, "school admins should create grade records");
    const grade = await gradeResponse.json();
    assert.equal(grade.score, 80);
    assert.equal(grade.maxScore, 100);

    const invalidGradeResponse = await request("/exams", {
      method: "POST",
      headers,
      body: JSON.stringify({
        studentId: student.id,
        subject: "Mathematics",
        examName: "Invalid Score",
        score: 101,
        maxScore: 100,
      }),
    });
    assert.equal(invalidGradeResponse.status, 400, "grades above the maximum score must be rejected");

    const gradeListResponse = await request("/exams", { headers });
    assert.equal(gradeListResponse.status, 200);
    assert.ok(
      (await gradeListResponse.json()).some((record) => record.id === grade.id),
      "school admins should read their school's grade records",
    );

    const gradeUpdateResponse = await request(`/exams/${grade.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ score: 92 }),
    });
    assert.equal(gradeUpdateResponse.status, 200);
    assert.equal((await gradeUpdateResponse.json()).score, 92);

    const gradeDeleteResponse = await request(`/exams/${grade.id}`, {
      method: "DELETE",
      headers,
    });
    assert.equal(gradeDeleteResponse.status, 204);
    const deletedGradeResponse = await request(`/exams/${grade.id}`, { headers });
    assert.equal(deletedGradeResponse.status, 404, "deleted grade records must not remain readable");

    const foreignClassAssignment = await request("/assignments", {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: "Cross-school assignment",
        classId: foreignClass.id,
      }),
    });
    assert.equal(
      foreignClassAssignment.status,
      404,
      "assignments must not reference another school's class",
    );
    const schoolUsersResponse = await request("/auth/users", { headers });
    const tenantAuditResponse = await request("/audit-logs", { headers });
    const pagedAuditResponse = await request(
      "/audit-logs?page=1&limit=1",
      { headers },
    );
    assert.equal(tenantAuditResponse.status, 200);
    assert.equal(pagedAuditResponse.status, 200);
    const tenantAuditPage = await tenantAuditResponse.json();
    const pagedAuditPage = await pagedAuditResponse.json();
    assert.equal(pagedAuditPage.data.length <= 1, true);
    assert.equal(pagedAuditPage.meta.limit, 1);
    assert.ok(
      tenantAuditPage.data.every(
        (event) => event.schoolId === auth.user.schoolId,
      ),
      "school audit logs must never include another school's events",
    );
    assert.ok(
      !tenantAuditPage.data.some(
        (event) => event.id === foreignAuditEvent.id,
      ),
      "a forged foreign audit event must remain hidden",
    );
    const schoolUsers = await schoolUsersResponse.json();
    assert.ok(
      schoolUsers.every((user) => user.id !== foreignUser.id),
      "school admins must not list another school's accounts",
    );
    const foreignUserRoleUpdate = await request(
      `/auth/users/${foreignUser.id}/role`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({ role: "teacher" }),
      },
    );
    assert.equal(
      foreignUserRoleUpdate.status,
      404,
      "school admins must not modify another school's account",
    );
    const foreignUserDelete = await request(
      `/auth/users/${foreignUser.id}`,
      { method: "DELETE", headers },
    );
    assert.equal(
      foreignUserDelete.status,
      404,
      "school admins must not delete another school's account",
    );
    const schoolChats = await request("/chats", { headers });
    assert.deepEqual(
      await schoolChats.json(),
      [],
      "school admins must only list their school's chats",
    );
    const foreignChatMessages = await request(
      `/chats/${foreignChat.id}/messages`,
      { headers },
    );
    assert.equal(
      foreignChatMessages.status,
      404,
      "school admins must not read another school's messages",
    );
    const foreignChatUpdate = await request(`/chats/${foreignChat.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ name: "Tampered chat" }),
    });
    assert.equal(
      foreignChatUpdate.status,
      404,
      "school admins must not modify another school's chats",
    );
    const schoolInvites = await request("/invite-codes", { headers });
    assert.ok(
      (await schoolInvites.json()).every((invite) => invite.id !== foreignInvite.id),
      "school admins must only list their school's invite codes",
    );
    const foreignInviteDelete = await request(
      `/invite-codes/${foreignInvite.id}`,
      { method: "DELETE", headers },
    );
    assert.equal(
      foreignInviteDelete.status,
      404,
      "school admins must not revoke another school's invites",
    );

    const parentRegistration = await request("/auth/register", {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Smoke Parent",
        email: "parent@example.test",
        password: "parent-smoke-password-123!",
        role: "parent",
        childIds: [student.id],
      }),
    });
    assert.equal(parentRegistration.status, 201, "admin should create a linked parent account");
    const parentAuth = await parentRegistration.json();
    const parentHeaders = {
      ...headers,
      Authorization: `Bearer ${parentAuth.token}`,
    };
    const parentOwnChild = await request(`/students/${student.id}`, {
      headers: parentHeaders,
    });
    assert.equal(parentOwnChild.status, 200, "parents should view their linked children");
    const parentForeignChild = await request(
      `/students/${foreignStudent.id}`,
      { headers: parentHeaders },
    );
    assert.equal(
      parentForeignChild.status,
      404,
      "parents must not view children at another school",
    );
    const forgedParent = await request("/auth/register", {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Forged Parent",
        email: "forged-parent@example.test",
        password: "forged-parent-password-123!",
        role: "parent",
        childIds: [foreignStudent.id],
      }),
    });
    assert.equal(
      forgedParent.status,
      404,
      "admins must not link parent accounts to another school's students",
    );

    const assignedTeacherResponse = await request("/teachers", {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Assigned Teacher" }),
    });
    assert.equal(assignedTeacherResponse.status, 201);
    const assignedTeacher = await assignedTeacherResponse.json();
    const assignedClassResponse = await request("/classes", {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Grade 8A",
        teacherIds: [assignedTeacher.id],
      }),
    });
    assert.equal(assignedClassResponse.status, 201);
    const assignedClass = await assignedClassResponse.json();
    const classLinkDatabase = new Database(databasePath);
    classLinkDatabase
      .prepare("UPDATE students SET class_id = ?, class_name = ? WHERE id = ?")
      .run(assignedClass.id, assignedClass.name, student.id);
    classLinkDatabase.close();
    const renamedClass = await request(`/classes/${assignedClass.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ name: "Grade 7A" }),
    });
    assert.equal(renamedClass.status, 200, "school admins should rename classes");
    const otherClassResponse = await request("/classes", {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Grade 8B", teacherIds: [] }),
    });
    assert.equal(otherClassResponse.status, 201);
    const otherClass = await otherClassResponse.json();
    const otherClassStudentResponse = await request("/students", {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Unassigned Student", class: "Grade 8B" }),
    });
    assert.equal(otherClassStudentResponse.status, 201);
    const otherClassStudent = await otherClassStudentResponse.json();
    const parentUnlinkedStudent = await request(
      `/students/${otherClassStudent.id}`,
      { headers: parentHeaders },
    );
    assert.equal(
      parentUnlinkedStudent.status,
      404,
      "parents must not view another student's record in the same school",
    );
    const parentStudentList = await request("/students", {
      headers: parentHeaders,
    });
    assert.deepEqual(
      (await parentStudentList.json()).map((record) => record.id),
      [student.id],
      "parent student lists must include only linked children",
    );
    const teacherRegistration = await request("/auth/register", {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Smoke Teacher",
        email: "teacher@example.test",
        password: "teacher-smoke-password-123!",
        role: "teacher",
        teacherId: assignedTeacher.id,
      }),
    });
    assert.equal(teacherRegistration.status, 201);
    const teacherAuth = await teacherRegistration.json();
    const teacherHeaders = {
      ...headers,
      Authorization: `Bearer ${teacherAuth.token}`,
    };
    const assignedTimetableResponse = await request("/timetable", {
      method: "POST",
      headers,
      body: JSON.stringify({
        classId: assignedClass.id,
        className: assignedClass.name,
        day: "Monday",
        subject: "Science",
        teacherId: assignedTeacher.id,
        startTime: "08:00",
        endTime: "08:40",
      }),
    });
    assert.equal(assignedTimetableResponse.status, 201);
    const assignedTimetable = await assignedTimetableResponse.json();
    const unassignedTimetableResponse = await request("/timetable", {
      method: "POST",
      headers,
      body: JSON.stringify({
        classId: otherClass.id,
        className: otherClass.name,
        day: "Monday",
        subject: "Science",
        startTime: "08:40",
        endTime: "09:20",
      }),
    });
    assert.equal(unassignedTimetableResponse.status, 201);
    const unassignedTimetable = await unassignedTimetableResponse.json();
    const teacherTimetableResponse = await request("/timetable", {
      headers: teacherHeaders,
    });
    assert.equal(
      teacherTimetableResponse.status,
      200,
      "teachers should be able to view their timetable",
    );
    const teacherTimetable = await teacherTimetableResponse.json();
    assert.ok(
      teacherTimetable.some((entry) => entry.id === assignedTimetable.id),
      "teachers should view timetable entries for their assigned classes",
    );
    assert.ok(
      !teacherTimetable.some((entry) => entry.id === unassignedTimetable.id),
      "teachers must not view timetable entries for other classes",
    );

    const assignedStudentResponse = await request(`/students/${student.id}`, {
      headers: teacherHeaders,
    });
    assert.equal(
      assignedStudentResponse.status,
      200,
      "teachers should view students in their assigned classes",
    );
    const unassignedStudentResponse = await request(
      `/students/${otherClassStudent.id}`,
      { headers: teacherHeaders },
    );
    assert.equal(
      unassignedStudentResponse.status,
      404,
      "teachers must not view students in another teacher's class",
    );
    const forbiddenTeacherUpdate = await request(
      `/students/${otherClassStudent.id}`,
      {
        method: "PATCH",
        headers: teacherHeaders,
        body: JSON.stringify({ name: "Unauthorized Change" }),
      },
    );
    assert.equal(
      forbiddenTeacherUpdate.status,
      404,
      "teachers must not update students outside their assigned classes",
    );
    const unauthorizedPayment = await request("/fees", {
      method: "POST",
      headers: teacherHeaders,
      body: JSON.stringify({ studentId: student.id, amount: 100 }),
    });
    assert.equal(
      unauthorizedPayment.status,
      403,
      "teachers must not record payments",
    );
    const assignedFeeResponse = await request("/fees", {
      method: "POST",
      headers,
      body: JSON.stringify({
        studentId: student.id,
        studentName: student.name,
        class: assignedClass.name,
        amount: 120,
        status: "paid",
        schoolId: foreignStudent.schoolId,
      }),
    });
    assert.equal(assignedFeeResponse.status, 201);
    const assignedFee = await assignedFeeResponse.json();
    assert.equal(
      assignedFee.schoolId,
      auth.user.schoolId,
      "fee creation must ignore a forged school id",
    );
    const unassignedFeeResponse = await request("/fees", {
      method: "POST",
      headers,
      body: JSON.stringify({
        studentId: otherClassStudent.id,
        studentName: otherClassStudent.name,
        class: otherClass.name,
        amount: 80,
        status: "outstanding",
      }),
    });
    assert.equal(unassignedFeeResponse.status, 201);
    const unassignedFee = await unassignedFeeResponse.json();
    const foreignFeeResponse = await request("/fees", {
      method: "POST",
      headers: foreignHeaders,
      body: JSON.stringify({
        studentId: foreignStudent.id,
        studentName: foreignStudent.name,
        class: foreignStudent.class,
        amount: 60,
        status: "outstanding",
        schoolId: auth.user.schoolId,
      }),
    });
    assert.equal(foreignFeeResponse.status, 201);
    const foreignSchoolFee = await foreignFeeResponse.json();
    assert.equal(
      foreignSchoolFee.schoolId,
      foreignUser.schoolId,
      "fee creation must derive ownership from the authenticated school",
    );
    const teacherFeeListResponse = await request(
      "/fees?page=1&limit=100",
      { headers: teacherHeaders },
    );
    assert.equal(teacherFeeListResponse.status, 200);
    const teacherFeePage = await teacherFeeListResponse.json();
    assert.deepEqual(
      teacherFeePage.data.map((fee) => fee.id),
      [assignedFee.id],
      "teachers must only list fees for assigned-class students",
    );
    assert.equal(
      teacherFeePage.meta.total,
      1,
      "fee pagination totals must exclude out-of-class and cross-school records",
    );
    const filteredOutOfClassFee = await request(
      "/fees?filter%5Bclass%5D=Grade%208B",
      { headers: teacherHeaders },
    );
    assert.deepEqual(
      await filteredOutOfClassFee.json(),
      [],
      "class filters must not reveal fees for unassigned students",
    );
    const filteredOutOfClassStatusFee = await request(
      "/fees?filter%5Bstatus%5D=outstanding",
      { headers: teacherHeaders },
    );
    assert.deepEqual(
      await filteredOutOfClassStatusFee.json(),
      [],
      "status filters must not reveal fees for unassigned or foreign students",
    );
    const filteredAssignedFee = await request(
      "/fees?filter%5Bstatus%5D=paid",
      { headers: teacherHeaders },
    );
    assert.deepEqual(
      (await filteredAssignedFee.json()).map((fee) => fee.id),
      [assignedFee.id],
      "teachers may filter fees for assigned-class students",
    );
    const searchedUnassignedFee = await request(
      "/fees?search=Unassigned%20Student",
      { headers: teacherHeaders },
    );
    assert.deepEqual(
      await searchedUnassignedFee.json(),
      [],
      "fee search must not disclose unassigned students",
    );
    const assignedFeeDetail = await request(`/fees/${assignedFee.id}`, {
      headers: teacherHeaders,
    });
    assert.equal(
      assignedFeeDetail.status,
      200,
      "teachers may read fees for assigned-class students",
    );
    const unassignedFeeDetail = await request(`/fees/${unassignedFee.id}`, {
      headers: teacherHeaders,
    });
    assert.equal(
      unassignedFeeDetail.status,
      404,
      "teachers must not read an unassigned student's fee by id",
    );
    const foreignFeeDetail = await request(`/fees/${foreignSchoolFee.id}`, {
      headers: teacherHeaders,
    });
    assert.equal(
      foreignFeeDetail.status,
      404,
      "teachers must not read another school's fee by id",
    );
    const teacherForeignFeeQuery = await request(
      `/fees?search=Foreign%20Student&filter%5Bstatus%5D=outstanding&page=1&limit=1`,
      { headers: teacherHeaders },
    );
    const teacherForeignFeePage = await teacherForeignFeeQuery.json();
    assert.deepEqual(teacherForeignFeePage.data, []);
    assert.equal(
      teacherForeignFeePage.meta.total,
      0,
      "search and pagination metadata must exclude foreign fees",
    );
    const foreignAdminFeeList = await request("/fees", {
      headers: foreignHeaders,
    });
    assert.deepEqual(
      (await foreignAdminFeeList.json()).map((fee) => fee.id),
      [foreignSchoolFee.id],
      "foreign-school admins must only list fees from their own school",
    );
    const foreignAdminLocalFeeDetail = await request(
      `/fees/${assignedFee.id}`,
      { headers: foreignHeaders },
    );
    assert.equal(
      foreignAdminLocalFeeDetail.status,
      404,
      "foreign-school admins must not read another school's fee by id",
    );
    const parentFeeList = await request("/fees", { headers: parentHeaders });
    assert.deepEqual(
      (await parentFeeList.json()).map((fee) => fee.id),
      [assignedFee.id],
      "parents must only list fees for linked children",
    );
    const parentUnlinkedFee = await request(`/fees/${unassignedFee.id}`, {
      headers: parentHeaders,
    });
    assert.equal(
      parentUnlinkedFee.status,
      404,
      "parents must not read an unlinked student's fee by id",
    );
    for (const [method, body] of [
      ["PATCH", { status: "paid" }],
      ["DELETE", undefined],
    ]) {
      const teacherFeeWrite = await request(`/fees/${assignedFee.id}`, {
        method,
        headers: teacherHeaders,
        body: body ? JSON.stringify(body) : undefined,
      });
      assert.equal(
        teacherFeeWrite.status,
        403,
        `teachers must not ${method.toLowerCase()} fee records`,
      );
    }
    const libraryItemResponse = await request("/library", {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: "School-wide Teacher Loan Test",
        copiesTotal: 3,
        copiesAvailable: 3,
      }),
    });
    assert.equal(libraryItemResponse.status, 201);
    const libraryItem = await libraryItemResponse.json();
    const assignedLibraryLoanResponse = await request("/library-loans", {
      method: "POST",
      headers,
      body: JSON.stringify({
        studentId: student.id,
        itemId: libraryItem.id,
        borrowedDate: "2026-10-01T00:00:00.000Z",
        dueDate: "2026-10-30T00:00:00.000Z",
      }),
    });
    assert.equal(assignedLibraryLoanResponse.status, 201);
    const assignedLibraryLoan = await assignedLibraryLoanResponse.json();
    const teacherLibraryLoanResponse = await request("/library-loans", {
      method: "POST",
      headers: teacherHeaders,
      body: JSON.stringify({
        studentId: otherClassStudent.id,
        itemId: libraryItem.id,
        borrowedDate: "2026-10-02T00:00:00.000Z",
        dueDate: "2026-10-31T00:00:00.000Z",
        schoolId: foreignUser.schoolId,
      }),
    });
    assert.equal(
      teacherLibraryLoanResponse.status,
      201,
      "teachers may create loans for any student in their school",
    );
    const teacherLibraryLoan = await teacherLibraryLoanResponse.json();
    assert.equal(
      teacherLibraryLoan.schoolId,
      auth.user.schoolId,
      "loan creation must ignore a forged school id",
    );
    const teacherLibraryLoansResponse = await request(
      "/library-loans?page=1&limit=100",
      { headers: teacherHeaders },
    );
    assert.equal(teacherLibraryLoansResponse.status, 200);
    const teacherLibraryLoans = await teacherLibraryLoansResponse.json();
    assert.deepEqual(
      teacherLibraryLoans.data.map((loan) => loan.id).sort(),
      [assignedLibraryLoan.id, teacherLibraryLoan.id].sort(),
      "teachers must retain school-wide library-loan visibility",
    );
    assert.equal(
      teacherLibraryLoans.data.some((loan) => loan.id === "foreign-school-loan"),
      false,
      "teacher loan lists must exclude other schools",
    );
    for (const loan of [assignedLibraryLoan, teacherLibraryLoan]) {
      const sameSchoolLoan = await request(`/library-loans/${loan.id}`, {
        headers: teacherHeaders,
      });
      assert.equal(
        sameSchoolLoan.status,
        200,
        "teachers may view any same-school library loan by id",
      );
    }
    const parentLibraryLoansResponse = await request("/library-loans", {
      headers: parentHeaders,
    });
    assert.deepEqual(
      (await parentLibraryLoansResponse.json()).map((loan) => loan.id),
      [assignedLibraryLoan.id],
      "parents must only list library loans for linked children",
    );
    const parentUnlinkedLibraryLoan = await request(
      `/library-loans/${teacherLibraryLoan.id}`,
      { headers: parentHeaders },
    );
    assert.equal(
      parentUnlinkedLibraryLoan.status,
      404,
      "parents must not read an unlinked student's library loan",
    );
    const foreignLibraryLoansResponse = await request("/library-loans", {
      headers: foreignHeaders,
    });
    assert.deepEqual(
      (await foreignLibraryLoansResponse.json()).map((loan) => loan.id),
      ["foreign-school-loan"],
      "the foreign admin must see only that school's library loans",
    );
    const foreignLoanFromSchoolA = await request(
      "/library-loans/foreign-school-loan",
      { headers: teacherHeaders },
    );
    assert.equal(
      foreignLoanFromSchoolA.status,
      404,
      "teachers must not read another school's library loan by id",
    );
    const localStudentForeignBookLoan = await request("/library-loans", {
      method: "POST",
      headers: teacherHeaders,
      body: JSON.stringify({
        studentId: otherClassStudent.id,
        itemId: "foreign-school-book",
        borrowedDate: "2026-10-03T00:00:00.000Z",
        dueDate: "2026-11-01T00:00:00.000Z",
      }),
    });
    assert.equal(
      localStudentForeignBookLoan.status,
      404,
      "teachers must not create a loan referencing another school's book",
    );
    const foreignStudentLocalBookLoan = await request("/library-loans", {
      method: "POST",
      headers: teacherHeaders,
      body: JSON.stringify({
        studentId: foreignStudent.id,
        itemId: libraryItem.id,
        borrowedDate: "2026-10-04T00:00:00.000Z",
        dueDate: "2026-11-02T00:00:00.000Z",
      }),
    });
    assert.equal(
      foreignStudentLocalBookLoan.status,
      404,
      "teachers must not create a loan for another school's student",
    );
    const teacherLoanUpdate = await request(
      `/library-loans/${teacherLibraryLoan.id}`,
      {
        method: "PATCH",
        headers: teacherHeaders,
        body: JSON.stringify({ returnedDate: "2026-10-05T00:00:00.000Z" }),
      },
    );
    assert.equal(
      teacherLoanUpdate.status,
      200,
      "teachers may update same-school loans across classes",
    );
    const teacherLoanDelete = await request(
      `/library-loans/${teacherLibraryLoan.id}`,
      { method: "DELETE", headers: teacherHeaders },
    );
    assert.equal(
      teacherLoanDelete.status,
      204,
      "teachers may delete same-school loans across classes",
    );
    const foreignAdminCannotReadLocalLoan = await request(
      `/library-loans/${assignedLibraryLoan.id}`,
      { headers: foreignHeaders },
    );
    assert.equal(
      foreignAdminCannotReadLocalLoan.status,
      404,
      "admins must not read another school's library loan by id",
    );
    const teacherDeleteAssignedLoan = await request(
      `/library-loans/${assignedLibraryLoan.id}`,
      { method: "DELETE", headers: teacherHeaders },
    );
    assert.equal(teacherDeleteAssignedLoan.status, 204);
    const assignedClassAssignmentResponse = await request("/assignments", {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: "Assigned class assignment",
        classId: assignedClass.id,
      }),
    });
    assert.equal(assignedClassAssignmentResponse.status, 201);
    const assignedClassAssignment = await assignedClassAssignmentResponse.json();
    const validSubmission = await request("/assignment-submissions", {
      method: "POST",
      headers: teacherHeaders,
      body: JSON.stringify({
        assignmentId: assignedClassAssignment.id,
        studentId: student.id,
        submitted: true,
      }),
    });
    assert.equal(
      validSubmission.status,
      201,
      "teachers may record submissions for students in the assignment's class",
    );
    const otherClassAssignmentResponse = await request("/assignments", {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: "Other class assignment",
        classId: otherClass.id,
      }),
    });
    assert.equal(otherClassAssignmentResponse.status, 201);
    const otherClassAssignment = await otherClassAssignmentResponse.json();
    const teacherAssignments = await request("/assignments", {
      headers: teacherHeaders,
    });
    assert.ok(
      !(await teacherAssignments.json()).some(
        (assignment) => assignment.id === otherClassAssignment.id,
      ),
      "teachers must not list assignments for another class",
    );
    const teacherOtherClassAssignment = await request(
      `/assignments/${otherClassAssignment.id}`,
      { headers: teacherHeaders },
    );
    assert.equal(
      teacherOtherClassAssignment.status,
      404,
      "teachers must not read another class's assignment by id",
    );
    const teacherCreateOtherClassAssignment = await request("/assignments", {
      method: "POST",
      headers: teacherHeaders,
      body: JSON.stringify({
        title: "Unauthorized other class assignment",
        classId: otherClass.id,
      }),
    });
    assert.equal(
      teacherCreateOtherClassAssignment.status,
      403,
      "teachers must not create assignments for another class",
    );
    const teacherUpdateOtherClassAssignment = await request(
      `/assignments/${otherClassAssignment.id}`,
      {
        method: "PATCH",
        headers: teacherHeaders,
        body: JSON.stringify({ title: "Tampered assignment" }),
      },
    );
    assert.equal(
      teacherUpdateOtherClassAssignment.status,
      404,
      "teachers must not update another class's assignment",
    );
    const teacherDeleteOtherClassAssignment = await request(
      `/assignments/${otherClassAssignment.id}`,
      { method: "DELETE", headers: teacherHeaders },
    );
    assert.equal(
      teacherDeleteOtherClassAssignment.status,
      404,
      "teachers must not delete another class's assignment",
    );
    const mismatchedSubmission = await request("/assignment-submissions", {
      method: "POST",
      headers: teacherHeaders,
      body: JSON.stringify({
        assignmentId: otherClassAssignment.id,
        studentId: student.id,
        submitted: true,
      }),
    });
    assert.equal(
      mismatchedSubmission.status,
      404,
      "teachers must not attach assigned students to another class's assignment",
    );

    const inviteResponse = await request("/invite-codes", {
      method: "POST",
      headers,
      body: JSON.stringify({ role: "student", studentId: student.id }),
    });
    assert.equal(inviteResponse.status, 201, "admins should create student invites");
    const invite = await inviteResponse.json();
    const studentRegistration = await request("/auth/register-with-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: invite.code,
        name: "Smoke Student",
        email: "student@example.test",
        password: "student-smoke-password-123!",
        role: "student",
      }),
    });
    assert.equal(studentRegistration.status, 201, "students should redeem valid school invites");
    const studentAuth = await studentRegistration.json();
    const studentHeaders = {
      ...headers,
      Authorization: `Bearer ${studentAuth.token}`,
    };
    const ownStudentRecord = await request(`/students/${student.id}`, {
      headers: studentHeaders,
    });
    assert.equal(ownStudentRecord.status, 200, "students should view their own record");
    const otherStudentRecord = await request(
      `/students/${otherClassStudent.id}`,
      { headers: studentHeaders },
    );
    assert.equal(
      otherStudentRecord.status,
      404,
      "students must not view another student's record",
    );
    const studentFeeList = await request("/fees", { headers: studentHeaders });
    assert.deepEqual(
      (await studentFeeList.json()).map((fee) => fee.id),
      [assignedFee.id],
      "students must only list their own fees",
    );
    const ownStudentFee = await request(`/fees/${assignedFee.id}`, {
      headers: studentHeaders,
    });
    assert.equal(ownStudentFee.status, 200);
    const otherStudentFee = await request(`/fees/${unassignedFee.id}`, {
      headers: studentHeaders,
    });
    assert.equal(
      otherStudentFee.status,
      404,
      "students must not read another student's fee",
    );

    const schoolProfile = await request("/schools/me", { headers });
    assert.equal(schoolProfile.status, 200, "admin should read school profile");
    const schoolData = await schoolProfile.json();
    assert.equal(schoolData.school.name, expectedSchoolName);

    const schoolUpdate = await request("/schools/me", {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        name: "Smoke School Updated",
        schoolType: "Combined",
        accentColor: "#237c78",
        onboardingCompleted: true,
      }),
    });
    assert.equal(schoolUpdate.status, 200, "admin should update school setup");
    const updatedSchool = await schoolUpdate.json();
    assert.equal(updatedSchool.school.name, "Smoke School Updated");
    assert.equal(updatedSchool.school.settings.schoolType, "Combined");
    assert.equal(updatedSchool.school.settings.accentColor, "#237c78");
    assert.equal(updatedSchool.school.onboardingCompleted, true);

    const paginated = await request(
      "/students?search=brian&page=1&limit=10&sort=-name",
      { headers },
    );
    const page = await paginated.json();
    assert.equal(page.meta.total, 1, "search should filter students");
    assert.equal(
      page.data[0].id,
      student.id,
      "pagination should return the matching student",
    );
    const filteredFeePageResponse = await request(
      "/fees?page=1&limit=100&filter%5Bstatus%5D=paid",
      { headers },
    );
    assert.equal(filteredFeePageResponse.status, 200);
    const filteredFeePage = await filteredFeePageResponse.json();
    assert.deepEqual(
      filteredFeePage.data.map((fee) => fee.id),
      [assignedFee.id],
      "school-admin pagination must apply encoded fee filters",
    );
    assert.equal(
      filteredFeePage.meta.total,
      1,
      "school-admin filtered counts must match filtered records",
    );

    const invalidFee = await request("/fees", {
      method: "POST",
      headers,
      body: JSON.stringify({
        studentId: student.id,
        amount: -1,
        status: "outstanding",
      }),
    });
    assert.equal(invalidFee.status, 400, "negative fees must be rejected");
    const feeError = await invalidFee.json();
    assert.equal(feeError.error.code, "INVALID_FEE_AMOUNT");
    const excessPrecisionFee = await request("/fees", {
      method: "POST",
      headers,
      body: JSON.stringify({
        studentId: student.id,
        amount: 1.005,
        status: "outstanding",
      }),
    });
    assert.equal(
      excessPrecisionFee.status,
      400,
      "fees with more than two decimal places must be rejected",
    );

    const preResetSession = await request("/students", { headers });
    assert.equal(preResetSession.status, 200, "the bearer token must work before password reset");

    const forgotResponse = await request("/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: accountEmail }),
    });
    assert.equal(forgotResponse.status, 200, "password reset request should be accepted");
    const forgotBody = await forgotResponse.json();
    assert.equal(
      Object.hasOwn(forgotBody, "token"),
      false,
      "the password-reset feature flag being off must not disclose a reset token",
    );
    const headerOnlyForgotResponse = await request("/auth/forgot-password", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Local-Password-Reset-Test": "true",
      },
      body: JSON.stringify({ email: accountEmail }),
    });
    assert.equal(headerOnlyForgotResponse.status, 200);
    const headerOnlyForgotBody = await headerOnlyForgotResponse.json();
    assert.equal(
      Object.hasOwn(headerOnlyForgotBody, "token"),
      false,
      "the test header alone must not disclose a reset token",
    );
    assert.deepEqual(
      headerOnlyForgotBody,
      forgotBody,
      "the test header must not change the public response structure",
    );
    const nonexistentForgotResponse = await request("/auth/forgot-password", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Local-Password-Reset-Test": "true",
        "X-Forwarded-For": "198.51.100.11",
      },
      body: JSON.stringify({ email: "nobody@example.test" }),
    });
    assert.equal(nonexistentForgotResponse.status, 200);
    assert.deepEqual(
      await nonexistentForgotResponse.json(),
      forgotBody,
      "existing and nonexistent accounts must receive the same generic response",
    );

    const resetDatabase = new Database(databasePath);
    const resetRecords = resetDatabase
      .prepare("SELECT * FROM password_resets WHERE user_id = ? AND used_at IS NULL")
      .all(auth.user.id);
    assert.equal(resetRecords.length, 1, "a reset token should be created");
    const savedReset = resetRecords[0];
    assert.match(savedReset.token_hash, /^[a-f0-9]{64}$/, "only a SHA-256 reset-token hash should be persisted");
    assert.equal(savedReset.token, undefined, "plaintext reset tokens must not be persisted");
    const resetToken = crypto.randomBytes(32).toString("hex");
    resetDatabase
      .prepare("UPDATE password_resets SET token_hash = ? WHERE id = ?")
      .run(crypto.createHash("sha256").update(resetToken).digest("hex"), savedReset.id);
    resetDatabase.close();

    const passwordResetAttempts = await Promise.all([
      request("/auth/reset-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-For": "198.51.100.12",
        },
        body: JSON.stringify({
          token: resetToken,
          password: "updated-smoke-password-456!",
        }),
      }),
      request("/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: resetToken,
          password: "updated-smoke-password-456!",
        }),
      }),
    ]);
    assert.deepEqual(
      passwordResetAttempts.map((response) => response.status).sort(),
      [200, 410],
      "a reset token must only succeed once when requests race",
    );
    const consumedResetDatabase = new Database(databasePath);
    const consumedReset = consumedResetDatabase
      .prepare("SELECT used_at FROM password_resets WHERE token_hash = ?")
      .get(crypto.createHash("sha256").update(resetToken).digest("hex"));
    consumedResetDatabase.close();
    assert.ok(consumedReset.used_at, "successful reset must consume its token");

    const expiringForgotResponse = await request("/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: accountEmail }),
    });
    assert.equal(expiringForgotResponse.status, 200);
    const expiringForgotBody = await expiringForgotResponse.json();
    assert.equal(
      Object.hasOwn(expiringForgotBody, "token"),
      false,
      "expiry-test reset requests must not disclose their token",
    );
    const expiringToken = crypto.randomBytes(32).toString("hex");
    const expiredTokenHash = crypto
      .createHash("sha256")
      .update(expiringToken)
      .digest("hex");
    const expiryDatabase = new Database(databasePath);
    expiryDatabase
      .prepare("UPDATE password_resets SET token_hash = ?, expires_at = ? WHERE user_id = ? AND used_at IS NULL")
      .run(expiredTokenHash, new Date(Date.now() - 60_000).toISOString(), auth.user.id);
    expiryDatabase.close();
    const expiredResetResponse = await request("/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: expiringToken,
        password: "expired-smoke-password-789!",
      }),
    });
    assert.equal(expiredResetResponse.status, 410, "expired reset tokens must remain unusable");

    const invalidatedResetSession = await request("/students", { headers });
    assert.equal(
      invalidatedResetSession.status,
      401,
      "password reset must invalidate bearer tokens issued before the reset",
    );

    const oldLogin = await request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: accountEmail,
        password: originalPassword,
      }),
    });
    assert.equal(oldLogin.status, 401, "old password should no longer work");

    const newLogin = await request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: accountEmail,
        password: "updated-smoke-password-456!",
      }),
    });
    assert.equal(newLogin.status, 200, "new password should work");
    const newLoginBody = await newLogin.json();
    headers.Authorization = `Bearer ${newLoginBody.token}`;

    const passwordChange = await request("/auth/password/change", {
      method: "POST",
      headers,
      body: JSON.stringify({
        currentPassword: "updated-smoke-password-456!",
        newPassword: "rotated-smoke-password-789!",
      }),
    });
    assert.equal(passwordChange.status, 200, "users should be able to change passwords");
    const invalidatedSession = await request("/students", { headers });
    assert.equal(
      invalidatedSession.status,
      401,
      "password changes must invalidate active tokens",
    );
    const rotatedLogin = await request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: accountEmail,
        password: "rotated-smoke-password-789!",
      }),
    });
    assert.equal(rotatedLogin.status, 200, "the changed password should authenticate");
    headers.Authorization = `Bearer ${(await rotatedLogin.json()).token}`;

    const firstAttendance = await request("/attendance", {
      method: "POST",
      headers,
      body: JSON.stringify({
        studentId: student.id,
        date: "2026-09-24",
        status: "present",
      }),
    });
    if (firstAttendance.status !== 201)
      throw new Error(
        `attendance creation failed: ${await firstAttendance.text()}`,
      );
    const duplicateAttendance = await request("/attendance", {
      method: "POST",
      headers,
      body: JSON.stringify({
        studentId: student.id,
        date: "2026-09-24",
        status: "absent",
      }),
    });
    assert.equal(
      duplicateAttendance.status,
      409,
      "duplicate attendance must be rejected",
    );
    const concurrentAttendance = await Promise.all(
      ["present", "late"].map((status) =>
        request("/attendance", {
          method: "POST",
          headers,
          body: JSON.stringify({
            studentId: student.id,
            date: "2026-09-25",
            status,
          }),
        }),
      ),
    );
    assert.deepEqual(
      concurrentAttendance.map((response) => response.status).sort(),
      [201, 409],
      "concurrent duplicate attendance must yield one record and one conflict",
    );

    const db = new Database(databasePath);
    db.prepare("UPDATE users SET school_id = NULL WHERE id = ?").run(auth.user.id);
    db.close();

    const repairedProfile = await request("/schools/me", { headers });
    assert.equal(
      repairedProfile.status,
      200,
      "admin without a linked school should still get a school profile",
    );
    const repairedSchool = await repairedProfile.json();
    assert.ok(repairedSchool.school.id, "a fallback school should be created");

    const lifecycleStudentResponse = await request("/students", {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Lifecycle Invite Student", class: "Grade 1" }),
    });
    assert.equal(lifecycleStudentResponse.status, 201);
    const lifecycleStudent = await lifecycleStudentResponse.json();
    const suspensionInviteResponse = await request("/invite-codes", {
      method: "POST",
      headers,
      body: JSON.stringify({
        role: "student",
        studentId: lifecycleStudent.id,
      }),
    });
    assert.equal(suspensionInviteResponse.status, 201);
    const suspensionInvite = await suspensionInviteResponse.json();
    const accessToken = headers.Authorization.slice("Bearer ".length);
    realtimeSocket = new WebSocket(
      `ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(accessToken)}`,
    );
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("WebSocket did not connect for lifecycle test")),
        3000,
      );
      realtimeSocket.once("open", () => {
        clearTimeout(timer);
        resolve();
      });
      realtimeSocket.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    await wait(100);

    const lifecycleDatabase = new Database(databasePath);
    const schoolRow = lifecycleDatabase
      .prepare("SELECT settings_json FROM schools WHERE id = ?")
      .get(repairedSchool.school.id);
    const schoolSettings = JSON.parse(schoolRow.settings_json || "{}");
    schoolSettings.status = "suspended";
    lifecycleDatabase
      .prepare("UPDATE schools SET settings_json = ? WHERE id = ?")
      .run(JSON.stringify(schoolSettings), repairedSchool.school.id);
    lifecycleDatabase.close();

    const suspendedSchoolRequest = await request("/students", { headers });
    assert.equal(
      suspendedSchoolRequest.status,
      403,
      "suspended schools must not access protected APIs",
    );
    const suspendedSchoolLogin = await request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: accountEmail,
        password: "rotated-smoke-password-789!",
      }),
    });
    assert.equal(
      suspendedSchoolLogin.status,
      403,
      "users in suspended schools must not sign in",
    );
    const suspendedInviteRegistration = await request(
      "/auth/register-with-code",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: suspensionInvite.code,
          name: "Suspended School Student",
          email: "suspended-school-student@example.test",
          password: "suspended-school-password-123!",
          role: "student",
        }),
      },
    );
    assert.equal(
      suspendedInviteRegistration.status,
      403,
      "suspended schools must not accept invite registrations",
    );
    const socketClosed = new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Suspended-school WebSocket stayed connected")),
        3000,
      );
      realtimeSocket.once("close", (code) => {
        clearTimeout(timer);
        resolve(code);
      });
      realtimeSocket.send(JSON.stringify({ type: "join", chatId: "lifecycle-test" }));
    });
    assert.equal(await socketClosed, 4003);

    const restoreLifecycleDatabase = new Database(databasePath);
    schoolSettings.status = "active";
    restoreLifecycleDatabase
      .prepare("UPDATE schools SET settings_json = ? WHERE id = ?")
      .run(JSON.stringify(schoolSettings), repairedSchool.school.id);
    restoreLifecycleDatabase.close();
    const restoredSchoolRequest = await request("/students", { headers });
    assert.equal(restoredSchoolRequest.status, 200);

    const revokedInviteResponse = await request(
      `/invite-codes/${suspensionInvite.id}`,
      { method: "DELETE", headers },
    );
    assert.equal(revokedInviteResponse.status, 204);
    const inviteAuditResponse = await request(
      "/audit-logs?page=1&limit=100",
      { headers },
    );
    assert.equal(inviteAuditResponse.status, 200);
    const inviteAuditPage = await inviteAuditResponse.json();
    assert.deepEqual(
      inviteAuditPage.data
        .filter((event) => event.entityId === suspensionInvite.id)
        .map((event) => event.action)
        .sort(),
      ["INVITE_CODE_CREATED", "INVITE_CODE_REVOKED"],
      "invite creation and revocation should be auditable",
    );

    const chatMemberDatabase = new Database(databasePath);
    const chatMemberCredentials = chatMemberDatabase
      .prepare("SELECT password_hash FROM users WHERE id = ?")
      .get(foreignUser.id);
    const chatMemberId = crypto.randomUUID();
    const chatMemberCreatedAt = new Date().toISOString();
    chatMemberDatabase.prepare(
      "INSERT INTO users (id, school_id, name, email, password_hash, role_code, status, token_version, created_at, updated_at, extra_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      chatMemberId,
      repairedSchool.school.id,
      "Realtime Chat Member",
      "realtime-chat-member@example.test",
      chatMemberCredentials.password_hash,
      "parent",
      "active",
      0,
      chatMemberCreatedAt,
      chatMemberCreatedAt,
      "{}",
    );
    chatMemberDatabase.close();
    const chatMemberLogin = await request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "realtime-chat-member@example.test",
        password: originalPassword,
      }),
    });
    assert.equal(
      chatMemberLogin.status,
      200,
      "the synthetic same-school chat member must authenticate through the login route",
    );
    const chatMemberAuth = await chatMemberLogin.json();
    assert.equal(chatMemberAuth.user.id, chatMemberId);
    assert.equal(chatMemberAuth.user.schoolId, repairedSchool.school.id);
    const chatMemberHeaders = {
      ...headers,
      Authorization: `Bearer ${chatMemberAuth.token}`,
    };
    const chatResponse = await request("/chats", {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Reaction Regression Chat" }),
    });
    assert.equal(chatResponse.status, 201, "admins should create a test chat");
    const testChat = await chatResponse.json();
    assert.equal(
      await waitForRealtimeClose(null),
      4001,
      "WebSocket connections without tokens must be rejected",
    );
    assert.equal(
      await waitForRealtimeClose("malformed-token"),
      4001,
      "WebSocket connections with malformed tokens must be rejected",
    );
    assert.equal(
      await waitForRealtimeClose(expiredToken),
      4001,
      "WebSocket connections with expired tokens must be rejected",
    );
    const adminChatSocket = await openRealtimeSocket(accessToken);
    const parentChatSocket = await openRealtimeSocket(chatMemberAuth.token);
    const oldSchoolParentSocket = await openRealtimeSocket(parentAuth.token);
    const foreignChatSocket = await openRealtimeSocket(foreignAuth.token);
    realtimeSockets.push(
      adminChatSocket,
      parentChatSocket,
      oldSchoolParentSocket,
      foreignChatSocket,
    );
    adminChatSocket.send("not-json");
    adminChatSocket.send(JSON.stringify({ type: "join", chatId: testChat.id }));
    parentChatSocket.send(JSON.stringify({ type: "join", chatId: testChat.id }));
    oldSchoolParentSocket.send(
      JSON.stringify({ type: "join", chatId: testChat.id }),
    );
    foreignChatSocket.send(JSON.stringify({ type: "join", chatId: testChat.id }));
    await wait(75);
    const adminChatNotice = nextRealtimeMessage(adminChatSocket);
    const nonMemberChatNotice = expectNoRealtimeMessage(parentChatSocket);
    const oldSchoolParentNotice = expectNoRealtimeMessage(oldSchoolParentSocket);
    const foreignChatNotice = expectNoRealtimeMessage(foreignChatSocket);
    const firstSocketMessageResponse = await request(
      `/chats/${testChat.id}/messages`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ text: "Authorized socket notification" }),
      },
    );
    assert.equal(firstSocketMessageResponse.status, 201);
    assert.deepEqual(await adminChatNotice, {
      type: "chat:update",
      chatId: testChat.id,
    });
    await Promise.all([
      nonMemberChatNotice,
      oldSchoolParentNotice,
      foreignChatNotice,
    ]);
    const nonMemberChatList = await request("/chats", {
      headers: chatMemberHeaders,
    });
    assert.ok(
      !(await nonMemberChatList.json()).some((chat) => chat.id === testChat.id),
      "same-school nonmembers must not see private chats in their chat list",
    );
    const nonMemberChatMessages = await request(
      `/chats/${testChat.id}/messages`,
      { headers: chatMemberHeaders },
    );
    assert.equal(
      nonMemberChatMessages.status,
      404,
      "same-school nonmembers must not read private chat messages",
    );
    const oldSchoolChatMessages = await request(
      `/chats/${testChat.id}/messages`,
      { headers: parentHeaders },
    );
    assert.equal(
      oldSchoolChatMessages.status,
      404,
      "users from another school must not read private chat messages",
    );
    const crossSchoolChatMember = await request(`/chats/${testChat.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ memberIds: [auth.user.id, parentAuth.user.id] }),
    });
    assert.equal(
      crossSchoolChatMember.status,
      404,
      "admins must not add users from another school to a chat",
    );
    const addParentChatMember = await request(`/chats/${testChat.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        memberIds: [auth.user.id, chatMemberAuth.user.id],
      }),
    });
    assert.equal(addParentChatMember.status, 200);
    parentChatSocket.send(JSON.stringify({ type: "join", chatId: testChat.id }));
    await wait(75);
    const parentChatNotice = nextRealtimeMessage(parentChatSocket);
    const forgedSocketMessageResponse = await request(
      `/chats/${testChat.id}/messages`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          text: "Server-owned chat identity",
          chatId: foreignChat.id,
          schoolId: foreignUser.schoolId,
          senderId: foreignUser.id,
        }),
      },
    );
    assert.equal(forgedSocketMessageResponse.status, 201);
    const forgedSocketMessage = await forgedSocketMessageResponse.json();
    assert.equal(forgedSocketMessage.chatId, testChat.id);
    assert.equal(forgedSocketMessage.schoolId, repairedSchool.school.id);
    assert.equal(forgedSocketMessage.senderId, auth.user.id);
    assert.deepEqual(await parentChatNotice, {
      type: "chat:update",
      chatId: testChat.id,
    });
    const updatedChatResponse = await request(`/chats/${testChat.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        name: "Updated Reaction Regression Chat",
        memberIds: [auth.user.id],
      }),
    });
    assert.equal(
      updatedChatResponse.status,
      200,
      `chat update failed: ${await updatedChatResponse.clone().text()}`,
    );
    assert.equal(
      (await updatedChatResponse.json()).name,
      "Updated Reaction Regression Chat",
    );
    const revokedMemberNoNotice = expectNoRealtimeMessage(parentChatSocket);
    const postRevocationMessage = await request(
      `/chats/${testChat.id}/messages`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ text: "Membership revoked notification test" }),
      },
    );
    assert.equal(postRevocationMessage.status, 201);
    await revokedMemberNoNotice;
    // --- Security audit regression: chat membership revocation, joins, rotation, cleanup ---
    const revocationChatResponse = await request("/chats", {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Membership Revocation Regression Chat",
        memberIds: [chatMemberAuth.user.id],
      }),
    });
    assert.equal(revocationChatResponse.status, 201, "admins should create the revocation test chat");
    const revocationChat = await revocationChatResponse.json();
    const revocationInspector = new Database(databasePath, { readonly: true });
    const revocationCountRows = (table) =>
      revocationInspector
        .prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE chat_id = ?`)
        .get(revocationChat.id).total;
    const revocationForeignHeaders = {
      ...headers,
      Authorization: `Bearer ${foreignAuth.token}`,
    };
    const revocationThumbsUp = "\u{1F44D}";
    const revocationJoin = (requestHeaders, code) =>
      request("/chats/join", {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify({ code }),
      });
    try {
      assert.equal(
        revocationCountRows("chat_members"),
        2,
        "chat creation should store the admin and the member in chat_members",
      );
      const revocationFirstMessage = await request(
        `/chats/${revocationChat.id}/messages`,
        { method: "POST", headers, body: JSON.stringify({ text: "Message before revocation" }) },
      );
      assert.equal(revocationFirstMessage.status, 201);
      const revocationMessage = await revocationFirstMessage.json();

      const memberRead = await request(`/chats/${revocationChat.id}/messages`, {
        headers: chatMemberHeaders,
      });
      assert.equal(memberRead.status, 200, "a valid same-school member must read messages");
      assert.ok(
        (await memberRead.json()).some((message) => message.id === revocationMessage.id),
        "a valid member must see the chat's messages",
      );
      const memberWrite = await request(`/chats/${revocationChat.id}/messages`, {
        method: "POST",
        headers: chatMemberHeaders,
        body: JSON.stringify({ text: "Message from a valid member" }),
      });
      assert.equal(memberWrite.status, 201, "a valid member must create messages");
      const memberReact = await request(
        `/chats/${revocationChat.id}/messages/${revocationMessage.id}/react`,
        { method: "POST", headers: chatMemberHeaders, body: JSON.stringify({ emoji: revocationThumbsUp }) },
      );
      assert.equal(memberReact.status, 200, "a valid member must react to messages");

      const foreignJoin = await revocationJoin(revocationForeignHeaders, revocationChat.inviteCode);
      assert.equal(foreignJoin.status, 404, "another school's user must not join with a valid code");
      const foreignRead = await request(`/chats/${revocationChat.id}/messages`, {
        headers: revocationForeignHeaders,
      });
      assert.equal(foreignRead.status, 404, "another school's user must not read the chat");
      const forgedMembersChat = await request("/chats", {
        method: "POST",
        headers,
        body: JSON.stringify({ name: "Forged Members Chat", memberIds: [foreignUser.id] }),
      });
      assert.equal(forgedMembersChat.status, 404, "forged foreign memberIds must be rejected on create");

      const memberRemoval = await request(`/chats/${revocationChat.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ memberIds: [auth.user.id] }),
      });
      assert.equal(memberRemoval.status, 200, "admins should remove a member");
      assert.equal(
        revocationCountRows("chat_members"),
        1,
        "removing a member must also remove their chat_members row",
      );
      const revokedAttempts = [
        ["GET", `/chats/${revocationChat.id}/messages`, null],
        ["POST", `/chats/${revocationChat.id}/messages`, { text: "Should be refused" }],
        ["PATCH", `/chats/${revocationChat.id}/messages/${revocationMessage.id}`, { text: "Edited" }],
        ["DELETE", `/chats/${revocationChat.id}/messages/${revocationMessage.id}`, null],
        ["POST", `/chats/${revocationChat.id}/messages/${revocationMessage.id}/react`, { emoji: revocationThumbsUp }],
      ];
      for (const [method, route, body] of revokedAttempts) {
        const attempt = await request(route, {
          method,
          headers: chatMemberHeaders,
          body: body ? JSON.stringify(body) : undefined,
        });
        assert.equal(attempt.status, 404, `removed member must not ${method} ${route}`);
      }
      const removedList = await request("/chats", { headers: chatMemberHeaders });
      assert.ok(
        !(await removedList.json()).some((chat) => chat.id === revocationChat.id),
        "a removed member must not see the chat in their list",
      );
      const afterRemovalMessages = await (
        await request(`/chats/${revocationChat.id}/messages`, { headers })
      ).json();
      assert.equal(afterRemovalMessages.length, 2, "refused requests must not change the chat");
      assert.equal(
        afterRemovalMessages.find((message) => message.id === revocationMessage.id).text,
        "Message before revocation",
      );

      const oldInviteCode = revocationChat.inviteCode;
      const rotation = await request(`/chats/${revocationChat.id}/regenerate-code`, {
        method: "POST",
        headers,
      });
      assert.equal(rotation.status, 200);
      const rotatedChat = await rotation.json();
      assert.notEqual(rotatedChat.inviteCode, oldInviteCode, "rotation must issue a new code");
      const oldCodeJoin = await revocationJoin(chatMemberHeaders, oldInviteCode);
      assert.equal(oldCodeJoin.status, 404, "the old invite code must stop working after rotation");
      const stillOutside = await request(`/chats/${revocationChat.id}/messages`, {
        headers: chatMemberHeaders,
      });
      assert.equal(stillOutside.status, 404, "a rejected old code must not grant access");
      const newCodeJoin = await revocationJoin(chatMemberHeaders, rotatedChat.inviteCode);
      assert.equal(newCodeJoin.status, 200, "the new invite code must work");
      const rejoinedRead = await request(`/chats/${revocationChat.id}/messages`, {
        headers: chatMemberHeaders,
      });
      assert.equal(rejoinedRead.status, 200, "a member who joined by code must read messages");
      assert.equal(revocationCountRows("chat_members"), 2, "joining must store a chat_members row");

      const revocationDelete = await request(`/chats/${revocationChat.id}`, {
        method: "DELETE",
        headers,
      });
      assert.equal(revocationDelete.status, 204);
      assert.equal(revocationCountRows("chat_messages"), 0, "deleting a chat must remove its messages");
      assert.equal(revocationCountRows("chat_members"), 0, "deleting a chat must remove its members");
      assert.equal(
        revocationInspector.prepare("SELECT COUNT(*) AS total FROM chats WHERE id = ?").get(revocationChat.id).total,
        0,
        "the chat row itself must be gone",
      );
      const deletedRead = await request(`/chats/${revocationChat.id}/messages`, {
        headers: chatMemberHeaders,
      });
      assert.equal(deletedRead.status, 404, "a deleted chat must not be readable");
      const revocationAudit = await (
        await request("/audit-logs?page=1&limit=100", { headers })
      ).json();
      assert.deepEqual(
        revocationAudit.data
          .filter((event) => event.entityId === revocationChat.id)
          .map((event) => event.action)
          .sort(),
        ["CHAT_CREATED", "CHAT_DELETED", "CHAT_INVITE_CODE_REGENERATED", "CHAT_UPDATED"].sort(),
        "the revocation chat's lifecycle should be audited",
      );
    } finally {
      revocationInspector.close();
      await request(`/chats/${revocationChat.id}`, { method: "DELETE", headers }).catch(() => {});
    }
    const parentLogout = await request("/auth/logout", {
      method: "POST",
      headers: chatMemberHeaders,
    });
    assert.equal(parentLogout.status, 200);
    const revokedParentSocketClose = new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("WebSocket remained open after session revocation")),
        3000,
      );
      parentChatSocket.once("close", (code) => {
        clearTimeout(timer);
        resolve(code);
      });
      parentChatSocket.send(JSON.stringify({ type: "join", chatId: testChat.id }));
    });
    assert.equal(
      await revokedParentSocketClose,
      4001,
      "WebSocket joins must revalidate revoked sessions",
    );
    const regeneratedCodeResponse = await request(
      `/chats/${testChat.id}/regenerate-code`,
      { method: "POST", headers },
    );
    assert.equal(
      regeneratedCodeResponse.status,
      200,
      `chat invite-code rotation failed: ${await regeneratedCodeResponse.clone().text()}`,
    );
    const messageResponse = await request(`/chats/${testChat.id}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({ text: "Reaction regression test" }),
    });
    assert.equal(messageResponse.status, 201, "members should create a test message");
    const testMessage = await messageResponse.json();
    const invalidReaction = await request(
      `/chats/${testChat.id}/messages/${testMessage.id}/react`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ emoji: '<img src=x onerror="alert(1)">' }),
      },
    );
    assert.equal(invalidReaction.status, 400, "HTML-like reactions must be rejected");
    const unchangedMessagesResponse = await request(
      `/chats/${testChat.id}/messages`,
      { headers },
    );
    const unchangedMessages = await unchangedMessagesResponse.json();
    assert.deepEqual(
      unchangedMessages.find((message) => message.id === testMessage.id).reactions,
      {},
      "rejected reactions must not be stored",
    );
    for (const emoji of ["👍", "❤️", "😂", "😮", "😢", "🙏"]) {
      const validReaction = await request(
        `/chats/${testChat.id}/messages/${testMessage.id}/react`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ emoji }),
        },
      );
      assert.equal(validReaction.status, 200, `${emoji} should remain a supported reaction`);
    }
    const deletedChatResponse = await request(`/chats/${testChat.id}`, {
      method: "DELETE",
      headers,
    });
    assert.equal(
      deletedChatResponse.status,
      204,
      `chat deletion failed: ${await deletedChatResponse.clone().text()}`,
    );
    const chatAuditResponse = await request(
      "/audit-logs?page=1&limit=100",
      { headers },
    );
    assert.equal(
      chatAuditResponse.status,
      200,
      `chat audit lookup failed: ${await chatAuditResponse.clone().text()}`,
    );
    const chatAuditPage = await chatAuditResponse.json();
    assert.deepEqual(
      chatAuditPage.data
        .filter((event) => event.entityId === testChat.id)
        .map((event) => event.action)
        .sort(),
      [
        "CHAT_CREATED",
        "CHAT_DELETED",
        "CHAT_INVITE_CODE_REGENERATED",
        "CHAT_UPDATED",
        "CHAT_UPDATED",
      ].sort(),
      "chat creation, changes, invite rotation, and deletion should be auditable",
    );

    const throttledLoginHeaders = {
      "Content-Type": "application/json",
      "X-Forwarded-For": "203.0.113.10",
    };
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const failedLogin = await request("/auth/login", {
        method: "POST",
        headers: throttledLoginHeaders,
        body: JSON.stringify({
          email: accountEmail,
          password: "incorrect-password-value",
        }),
      });
      assert.equal(failedLogin.status, 401, "invalid credentials should be rejected");
    }
    const rateLimitedLogin = await request("/auth/login", {
      method: "POST",
      headers: throttledLoginHeaders,
      body: JSON.stringify({
        email: accountEmail,
        password: "incorrect-password-value",
      }),
    });
    assert.equal(rateLimitedLogin.status, 429, "authentication attempts should be rate limited");

    const logout = await request("/auth/logout", {
      method: "POST",
      headers,
    });
    assert.equal(logout.status, 200, "users should be able to invalidate sessions");
    const loggedOutRequest = await request("/students", { headers });
    assert.equal(loggedOutRequest.status, 401, "logout should invalidate the session token");

    console.log("API smoke tests passed");
  } finally {
    if (realtimeSocket && realtimeSocket.readyState !== WebSocket.CLOSED) {
      realtimeSocket.terminate();
    }
    for (const socket of realtimeSockets) {
      if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
    }
    try {
      if (server) await stopServer(server);
    } finally {
      fs.rmSync(tempDirectory, {
        recursive: true,
        force: true,
        maxRetries: 20,
        retryDelay: 250,
      });
      if (output && process.env.DEBUG_SMOKE) console.log(output);
    }
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
