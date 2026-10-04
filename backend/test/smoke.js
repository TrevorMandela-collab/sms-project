const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { spawn } = require("child_process");

const port = 4311;
const databasePath = path.join(__dirname, "..", "data", "smoke-test.sqlite");
const baseUrl = `http://127.0.0.1:${port}/api`;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(endpoint, options = {}) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      return await fetch(`${baseUrl}${endpoint}`, options);
    } catch (error) {
      if (attempt === 29) throw error;
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

    const registration = await request("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Smoke Admin",
        email: "smoke@example.test",
        password: "secret123",
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
    assert.ok(student.schoolId, "created records must be school scoped");

    const schoolProfile = await request("/schools/me", { headers });
    assert.equal(schoolProfile.status, 200, "admin should read school profile");
    const schoolData = await schoolProfile.json();
    assert.equal(schoolData.school.name, "Smoke School");

    const db = new Database(databasePath);
    const userRecord = db
      .prepare("SELECT data FROM store WHERE collection = ? AND id = ?")
      .get("users", auth.user.id);
    const user = JSON.parse(userRecord.data);
    user.schoolId = null;
    db.prepare("UPDATE store SET data = ? WHERE collection = ? AND id = ?").run(
      JSON.stringify(user),
      "users",
      auth.user.id,
    );
    db.close();

    const repairedProfile = await request("/schools/me", { headers });
    assert.equal(
      repairedProfile.status,
      200,
      "admin without a linked school should still get a school profile",
    );
    const repairedSchool = await repairedProfile.json();
    assert.ok(repairedSchool.school.id, "a fallback school should be created");

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
    const resetDatabase = new Database(databasePath);
    const resetRecords = resetDatabase
      .prepare("SELECT * FROM store WHERE collection = ?")
      .all("password-resets");
    assert.equal(resetRecords.length, 1, "a reset token should be created");
    const resetToken = JSON.parse(resetRecords[0].data).token;
    resetDatabase.close();

    const passwordReset = await request("/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: resetToken, password: "newSecret456" }),
    });
    assert.equal(passwordReset.status, 200, "password reset should succeed");

    const oldLogin = await request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "smoke@example.test", password: "secret123" }),
    });
    assert.equal(oldLogin.status, 401, "old password should no longer work");

    const newLogin = await request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "smoke@example.test", password: "newSecret456" }),
    });
    assert.equal(newLogin.status, 200, "new password should work");

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
