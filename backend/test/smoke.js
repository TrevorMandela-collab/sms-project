const assert = require("assert");
const crypto = require("crypto");
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
    const invalidAuditDate = await request("/audit-logs?from=not-a-date", {
      headers,
    });
    assert.equal(invalidAuditDate.status, 400, "audit date filters should be validated");
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
      "INSERT INTO users (id, school_id, name, email, password_hash, role_code, status, token_version, created_at, updated_at, extra_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(foreignUser.id, foreignUser.schoolId, foreignUser.name, foreignUser.email, "unused-test-hash", "admin", "active", 0, foreignCreatedAt, foreignCreatedAt, "{}");
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

    const chatResponse = await request("/chats", {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Reaction Regression Chat" }),
    });
    assert.equal(chatResponse.status, 201, "admins should create a test chat");
    const testChat = await chatResponse.json();
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
