const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { spawn, spawnSync } = require("child_process");

const port = 4311;
const databasePath = path.join(__dirname, "..", "data", "smoke-test.sqlite");
const baseUrl = `http://127.0.0.1:${port}/api`;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function run() {
  fs.rmSync(databasePath, { force: true });
  const server = spawn(process.execPath, ["server.js"], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      PORT: String(port),
      SQLITE_PATH: databasePath,
      DATABASE_URL: "",
      JWT_SECRET: "smoke-test-secret",
      NODE_ENV: "test",
      TRUST_PROXY_HOPS: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  server.stdout.on("data", (chunk) => {
    output += chunk;
  });
  server.stderr.on("data", (chunk) => {
    output += chunk;
  });

  try {
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

    const registration = await request("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Smoke Admin",
        email: "smoke@example.test",
        password: "smoke-test-password-123!",
        role: "admin",
        schoolName: "Smoke School",
      }),
    });
    if (registration.status !== 201)
      throw new Error(`registration failed: ${await registration.text()}`);
    const auth = await registration.json();
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${auth.token}`,
    };

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
    assert.equal(tenantAuditResponse.status, 200);
    const tenantAuditPage = await tenantAuditResponse.json();
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
    assert.equal(schoolData.school.name, "Smoke School");

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

    const forgotResponse = await request("/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "smoke@example.test" }),
    });
    assert.equal(forgotResponse.status, 200, "password reset request should be accepted");
    const forgotBody = await forgotResponse.json();
    assert.ok(forgotBody.token, "test mode should expose the reset token");
    const resetDatabase = new Database(databasePath);
    const resetRecords = resetDatabase
      .prepare("SELECT * FROM password_resets WHERE user_id = ?")
      .all(auth.user.id);
    assert.equal(resetRecords.length, 1, "a reset token should be created");
    const savedReset = resetRecords[0];
    assert.ok(savedReset.token_hash, "only a reset-token hash should be persisted");
    assert.equal(savedReset.token, undefined, "plaintext reset tokens must not be persisted");
    const resetToken = forgotBody.token;
    resetDatabase.close();

    const passwordResetAttempts = await Promise.all([
      request("/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
      .prepare("SELECT used_at FROM password_resets WHERE user_id = ?")
      .get(auth.user.id);
    consumedResetDatabase.close();
    assert.ok(consumedReset.used_at, "successful reset must consume its token");

    const oldLogin = await request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "smoke@example.test",
        password: "smoke-test-password-123!",
      }),
    });
    assert.equal(oldLogin.status, 401, "old password should no longer work");

    const newLogin = await request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "smoke@example.test",
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
        email: "smoke@example.test",
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

    const throttledLoginHeaders = {
      "Content-Type": "application/json",
      "X-Forwarded-For": "203.0.113.10",
    };
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const failedLogin = await request("/auth/login", {
        method: "POST",
        headers: throttledLoginHeaders,
        body: JSON.stringify({
          email: "smoke@example.test",
          password: "incorrect-password-value",
        }),
      });
      assert.equal(failedLogin.status, 401, "invalid credentials should be rejected");
    }
    const rateLimitedLogin = await request("/auth/login", {
      method: "POST",
      headers: throttledLoginHeaders,
      body: JSON.stringify({
        email: "smoke@example.test",
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
    server.kill();
    await wait(100);
    fs.rmSync(databasePath, { force: true });
    if (output && process.env.DEBUG_SMOKE) console.log(output);
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
