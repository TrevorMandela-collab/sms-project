const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const { spawn } = require("child_process");

const port = 4312;
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sms-qa-test-"));
const databasePath = path.join(directory, "qa.sqlite");
const baseUrl = `http://127.0.0.1:${port}/api`;
const ownerEmail = "qa-owner@example.test";
const secondOwnerEmail = "qa-owner2@example.test";
const teacherEmail = "qa-teacher@example.test";
const platformAdminEmail = "qa-platform-admin@example.test";
const secondOwnerPassword = "qa-owner2-password-123!";
const platformAdminPassword = "qa-platform-password-123!";
const ownerAllowlist = `${ownerEmail.toUpperCase()},${secondOwnerEmail.toUpperCase()},${teacherEmail.toUpperCase()},${platformAdminEmail.toUpperCase()}`;
let output = "";

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

async function call(endpoint, { token, method = "GET", body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return request(endpoint, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function assertUncachedRead(endpoint, token, collection, predicate, description) {
  const first = await call(endpoint, { token });
  assert.equal(first.status, 200, `${description} initial read should succeed`);
  assert.equal(first.headers.get("cache-control"), "no-store", `${description} should not be cached`);
  const etag = first.headers.get("etag");
  assert.ok(etag, `${description} should include a validator for this regression check`);

  const conditional = await request(endpoint, {
    headers: {
      Authorization: `Bearer ${token}`,
      "If-None-Match": etag,
    },
  });
  assert.equal(conditional.status, 200, `${description} must return its body for conditional requests`);
  assert.equal(conditional.headers.get("cache-control"), "no-store");
  const payload = await conditional.json();
  assert.ok(Array.isArray(payload[collection]));
  assert.ok(payload[collection].some(predicate), `${description} must return the saved record`);
}

function stopServer(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill();
  });
}

function startServer(qaOwnerEmails) {
  const env = {
    ...process.env,
    PORT: String(port),
    SQLITE_PATH: databasePath,
    DATABASE_URL: "",
    DOTENV_CONFIG_PATH: path.join(directory, ".test-env-do-not-create"),
    JWT_SECRET: "qa-test-secret",
    NODE_ENV: "test",
    TRUST_PROXY_HOPS: "1",
  };
  if (qaOwnerEmails === undefined) delete env.QA_OWNER_EMAILS;
  else env.QA_OWNER_EMAILS = qaOwnerEmails;

  const child = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    cwd: directory,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  return child;
}

async function run() {
  let server = startServer(ownerAllowlist);

  try {
    const health = await request("/health");
    assert.equal(health.status, 200, "health endpoint should respond");

    // Owner = first (bootstrap) admin.
    const registration = await call("/auth/register", {
      method: "POST",
      body: {
        name: "QA Owner",
        email: ownerEmail,
        password: "qa-owner-password-123!",
        role: "admin",
        schoolName: "QA Test School",
      },
    });
    if (registration.status !== 201) throw new Error(`owner registration failed: ${await registration.text()}`);
    const owner = await registration.json();
    const ownerToken = owner.token;

    const teacherRegistration = await call("/auth/register", {
      token: ownerToken,
      method: "POST",
      body: {
        name: "QA Teacher",
        email: teacherEmail,
        password: "qa-teacher-password-123!",
        role: "teacher",
      },
    });
    if (teacherRegistration.status !== 201) {
      throw new Error(`teacher registration failed: ${await teacherRegistration.text()}`);
    }
    const teacher = await teacherRegistration.json();
    const teacherToken = teacher.token;

    // Non-owner = a parent registered by that admin.
    const studentResponse = await call("/students", {
      token: ownerToken,
      method: "POST",
      body: { name: "QA Student", class: "Grade 8A" },
    });
    if (studentResponse.status !== 201) throw new Error(`student creation failed: ${await studentResponse.text()}`);
    const student = await studentResponse.json();
    const parentRegistration = await call("/auth/register", {
      token: ownerToken,
      method: "POST",
      body: {
        name: "QA Parent",
        email: "qa-parent@example.test",
        password: "qa-parent-password-123!",
        role: "parent",
        childIds: [student.id],
      },
    });
    if (parentRegistration.status !== 201) throw new Error(`parent registration failed: ${await parentRegistration.text()}`);
    const parent = await parentRegistration.json();
    const parentToken = parent.token;

    const now = new Date().toISOString();
    const setup = new Database(databasePath);
    setup.pragma("foreign_keys = ON");
    setup.prepare(
      "INSERT INTO schools (id, name, settings_json, onboarding_completed, created_at, updated_at, extra_data) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run("second-owner-school", "Second Owner School", "{}", 0, now, now, "{}");
    setup.prepare(
      "INSERT INTO users (id, school_id, name, email, password_hash, role_code, status, token_version, created_at, updated_at, extra_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run("second-owner-user", "second-owner-school", "Second Owner", secondOwnerEmail, bcrypt.hashSync(secondOwnerPassword, 4), "admin", "active", 0, now, now, "{}");
    setup.prepare(
      "INSERT INTO users (id, school_id, name, email, password_hash, role_code, status, token_version, created_at, updated_at, extra_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run("qa-platform-admin", null, "QA Platform Admin", platformAdminEmail, bcrypt.hashSync(platformAdminPassword, 4), "super_admin", "active", 0, now, now, "{}");
    setup.close();
    const secondLogin = await call("/auth/login", {
      method: "POST",
      body: { email: secondOwnerEmail, password: secondOwnerPassword },
    });
    if (secondLogin.status !== 200) throw new Error(`second owner login failed: ${await secondLogin.text()}`);
    const secondOwnerToken = (await secondLogin.json()).token;
    const platformAdminLogin = await call("/auth/login", {
      method: "POST",
      body: { email: platformAdminEmail, password: platformAdminPassword },
    });
    if (platformAdminLogin.status !== 200) {
      throw new Error(`platform admin login failed: ${await platformAdminLogin.text()}`);
    }
    const platformAdminToken = (await platformAdminLogin.json()).token;

    // 1. No login -> 401 on every QA route, including bug reads and writes.
    assert.equal((await call("/qa/access")).status, 401, "access without login must be 401");
    assert.equal((await call("/qa/results?environment=development")).status, 401, "results without login must be 401");
    assert.equal(
      (await call("/qa/results/AUTH-001", { method: "PUT", body: { environment: "development", status: "pass" } })).status,
      401,
      "saving without login must be 401",
    );
    assert.equal((await call("/qa/bugs?environment=development")).status, 401, "bug list without login must be 401");
    assert.equal((await call("/qa/bugs", { method: "POST", body: { environment: "development" } })).status, 401, "bug create without login must be 401");

    // 2. Authenticated non-owner -> 403 for reads and writes.
    assert.equal((await call("/qa/access", { token: parentToken })).status, 403, "non-owner access must be 403");
    assert.equal((await call("/qa/results?environment=development", { token: parentToken })).status, 403, "non-owner results must be 403");
    assert.equal(
      (await call("/qa/results/AUTH-001", { token: parentToken, method: "PUT", body: { environment: "development", status: "pass" } })).status,
      403,
      "non-owner save must be 403",
    );
    assert.equal((await call("/qa/bugs?environment=development", { token: parentToken })).status, 403, "non-owner bug list must be 403");
    assert.equal((await call("/qa/bugs", { token: parentToken, method: "POST", body: { environment: "development" } })).status, 403, "non-owner bug create must be 403");

    // 3. An allowlisted email passes case-insensitively even when configured in uppercase.
    assert.equal((await call("/qa/access", { token: ownerToken })).status, 200, "owner access must be 200");
    assert.equal((await call("/qa/access", { token: secondOwnerToken })).status, 200, "second allowlisted owner access must be 200");
    assert.equal(
      (await call("/qa/access", { token: platformAdminToken })).status,
      200,
      "allowlisted Super Admin access must be 200",
    );
    const platformAdminResult = await call("/qa/results/AUTH-009", {
      token: platformAdminToken,
      method: "PUT",
      body: { environment: "development", status: "pass", actual: "Platform QA access", notes: "" },
    });
    assert.equal(platformAdminResult.status, 200, "allowlisted Super Admin should save QA results");
    const platformAdminBug = await call("/qa/bugs", {
      token: platformAdminToken,
      method: "POST",
      body: { environment: "development", title: "Platform QA access", severity: "low" },
    });
    assert.equal(platformAdminBug.status, 201, "allowlisted Super Admin should report QA bugs");

    // 4. Empty at first.
    const empty = await (await call("/qa/results?environment=development", { token: ownerToken })).json();
    assert.deepEqual(empty.results, [], "no results should exist yet");

    // 5. Save and read back.
    const saved = await call("/qa/results/AUTH-001", {
      token: ownerToken,
      method: "PUT",
      body: { environment: "development", status: "pass", actual: "Worked as expected", notes: "first run" },
    });
    assert.equal(saved.status, 200, "owner should save a result");
    const readBack = await (await call("/qa/results?environment=development", { token: ownerToken })).json();
    assert.equal(readBack.results.length, 1);
    assert.equal(readBack.results[0].testId, "AUTH-001");
    assert.equal(readBack.results[0].status, "pass");
    assert.equal(readBack.results[0].actual, "Worked as expected");
    assert.equal(readBack.results[0].notes, "first run");
    await assertUncachedRead(
      "/qa/results?environment=development",
      ownerToken,
      "results",
      (row) => row.testId === "AUTH-001" && row.actual === "Worked as expected",
      "QA results",
    );
    assert.equal(
      (await call("/qa/results?environment=development", { token: parentToken })).status,
      403,
      "non-owner must not read an existing result",
    );
    assert.equal(
      (await call("/qa/results/AUTH-001", {
        method: "PUT",
        body: { environment: "development", status: "fail", actual: "unauthenticated", notes: "" },
      })).status,
      401,
      "unauthenticated request must not modify an existing result",
    );
    assert.equal(
      (await call("/qa/results/AUTH-001", {
        token: parentToken,
        method: "PUT",
        body: { environment: "development", status: "fail", actual: "unauthorized", notes: "" },
      })).status,
      403,
      "non-owner must not modify an existing result",
    );
    const ownerAfterDeniedWrite = await (await call("/qa/results?environment=development", { token: ownerToken })).json();
    assert.equal(ownerAfterDeniedWrite.results[0].status, "pass", "denied result update must leave owner data unchanged");

    // 6. Saving again updates the same row.
    const updated = await call("/qa/results/AUTH-001", {
      token: ownerToken,
      method: "PUT",
      body: { environment: "development", status: "fail", actual: "Broke", notes: "second run" },
    });
    assert.equal(updated.status, 200, "owner should update a result");
    const afterUpdate = await (await call("/qa/results?environment=development", { token: ownerToken })).json();
    assert.equal(afterUpdate.results.length, 1, "update must not create a second row");
    assert.equal(afterUpdate.results[0].status, "fail");
    assert.equal(afterUpdate.results[0].notes, "second run");

    // 7. A different allowlisted owner cannot read or overwrite the first owner's result.
    const secondOwnerResults = await (await call("/qa/results?environment=development", { token: secondOwnerToken })).json();
    assert.deepEqual(secondOwnerResults.results, [], "second owner must not see the first owner's results");
    const secondOwnerSave = await call("/qa/results/AUTH-001", {
      token: secondOwnerToken,
      method: "PUT",
      body: { environment: "development", status: "pass", actual: "second owner result", notes: "" },
    });
    assert.equal(secondOwnerSave.status, 200, "second owner may create their own result for the same test");
    const firstOwnerAfterSecondSave = await (await call("/qa/results?environment=development", { token: ownerToken })).json();
    assert.equal(firstOwnerAfterSecondSave.results.length, 1, "first owner must see only their own result");
    assert.equal(firstOwnerAfterSecondSave.results[0].actual, "Broke", "second owner's save must not alter first owner's result");
    const secondOwnerAfterSave = await (await call("/qa/results?environment=development", { token: secondOwnerToken })).json();
    assert.equal(secondOwnerAfterSave.results.length, 1, "second owner must see only their own result");
    assert.equal(secondOwnerAfterSave.results[0].actual, "second owner result");

    // 8. Environments are separate.
    const production = await (await call("/qa/results?environment=production", { token: ownerToken })).json();
    assert.deepEqual(production.results, [], "production results must be separate from development");

    // 9. Bad input -> 400.
    const good = { environment: "development", status: "pass", actual: "", notes: "" };
    const bad = async (endpoint, body, message) => {
      const res = await call(endpoint, { token: ownerToken, method: "PUT", body });
      assert.equal(res.status, 400, message);
    };
    await bad("/qa/results/AUTH-001", { ...good, environment: "staging" }, "unknown environment must be 400");
    await bad("/qa/results/AUTH-001", { status: "pass" }, "missing environment must be 400");
    await bad("/qa/results/AUTH-001", { ...good, status: "maybe" }, "unknown status must be 400");
    await bad("/qa/results/bad", good, "bad test id must be 400");
    await bad("/qa/results/AUTH-001", { ...good, actual: "x".repeat(2001) }, "actual over 2000 characters must be 400");
    await bad("/qa/results/AUTH-001", { ...good, notes: "x".repeat(2001) }, "notes over 2000 characters must be 400");
    await bad("/qa/results/AUTH-001", { ...good, actual: 123 }, "non-text actual must be 400");
    assert.equal(
      (await call("/qa/results?environment=staging", { token: ownerToken })).status,
      400,
      "unknown environment on read must be 400",
    );
    assert.equal(
      (await call("/qa/results", { token: ownerToken })).status,
      400,
      "missing environment on read must be 400",
    );

    // 10. A forged owner id in the body is ignored: the authenticated owner controls row ownership.
    const forged = await call("/qa/results/AUTH-002", {
      token: ownerToken,
      method: "PUT",
      body: { ...good, ownerUserId: parent.user.id, owner_user_id: parent.user.id, id: "forged-id" },
    });
    assert.equal(forged.status, 200, "extra fields should be ignored, not break the save");
    const ownerBugResponse = await call("/qa/bugs", {
      token: ownerToken,
      method: "POST",
      body: { environment: "development", title: "Owner-only QA bug", severity: "low" },
    });
    assert.equal(ownerBugResponse.status, 201, "owner should be able to create a QA bug");
    const ownerBug = await ownerBugResponse.json();
    await assertUncachedRead(
      "/qa/bugs?environment=development",
      ownerToken,
      "bugs",
      (bug) => bug.id === ownerBug.id,
      "QA bugs",
    );

    // Allowlisted non-admins still cannot view environments or call any QA operation.
    for (const [endpoint, options] of [
      ["/qa/access", { token: teacherToken }],
      ["/qa/results?environment=development", { token: teacherToken }],
      ["/qa/results?environment=production", { token: teacherToken }],
      ["/qa/results/AUTH-007", {
        token: teacherToken,
        method: "PUT",
        body: { environment: "development", status: "pass", actual: "unauthorized", notes: "" },
      }],
      ["/qa/bugs?environment=development", { token: teacherToken }],
      ["/qa/bugs?environment=production", { token: teacherToken }],
      ["/qa/bugs", {
        token: teacherToken,
        method: "POST",
        body: { environment: "development", title: "Unauthorized bug", severity: "low" },
      }],
      [`/qa/bugs/${ownerBug.id}`, {
        token: teacherToken,
        method: "PATCH",
        body: { status: "closed" },
      }],
    ]) {
      assert.equal(
        (await call(endpoint, options)).status,
        403,
        `allowlisted non-admin must be denied ${endpoint}`,
      );
    }

    const db = new Database(databasePath, { readonly: true });
    try {
      const rows = db.prepare("SELECT id, owner_user_id FROM qa_test_results").all();
      assert.equal(rows.length, 4, "each QA owner should have isolated saved results");
      assert.equal(rows.find((row) => row.id === "forged-id"), undefined, "ids must be generated by the server");
      assert.equal(
        rows.filter((row) => row.owner_user_id === owner.user.id).length,
        2,
        "forged owner fields must not change the authenticated owner's row ownership",
      );
      assert.equal(
        rows.filter((row) => row.owner_user_id === "second-owner-user").length,
        1,
        "the second owner's result must remain isolated",
      );
      assert.equal(
        rows.filter((row) => row.owner_user_id === "qa-platform-admin").length,
        1,
        "the platform admin's result must remain isolated",
      );
      assert.equal(
        db.prepare("SELECT COUNT(*) AS count FROM qa_test_results WHERE test_id = 'AUTH-007'").get().count,
        0,
        "denied non-admin result write must not persist",
      );
      assert.equal(
        db.prepare("SELECT COUNT(*) AS count FROM qa_bugs WHERE title = 'Unauthorized bug'").get().count,
        0,
        "denied non-admin bug create must not persist",
      );
      assert.equal(
        db.prepare("SELECT status FROM qa_bugs WHERE id = ?").get(ownerBug.id).status,
        "open",
        "denied non-admin bug update must leave the record unchanged",
      );
    } finally {
      db.close();
    }

    // A fresh page load after a backend restart must read both saved record types.
    await stopServer(server);
    server = startServer(ownerAllowlist);
    assert.equal((await request("/health")).status, 200, "server should restart against the same isolated database");
    const reloadedResults = await (await call("/qa/results?environment=development", { token: ownerToken })).json();
    assert.equal(
      reloadedResults.results.find((row) => row.testId === "AUTH-001").actual,
      "Broke",
      "result must remain available after server restart and reload",
    );
    const reloadedBugs = await (await call("/qa/bugs?environment=development", { token: ownerToken })).json();
    assert.equal(
      reloadedBugs.bugs.some((bug) => bug.id === ownerBug.id),
      true,
      "bug report must remain available after server restart and reload",
    );

    // Empty and absent allowlists both deny the authenticated owner, without writes.
    await stopServer(server);
    server = startServer("");
    assert.equal((await request("/health")).status, 200, "server with an empty allowlist should start");
    for (const [endpoint, options] of [
      ["/qa/access", { token: ownerToken }],
      ["/qa/results?environment=development", { token: ownerToken }],
      ["/qa/results/AUTH-001", { token: ownerToken, method: "PUT", body: { environment: "development", status: "pass" } }],
      ["/qa/bugs?environment=development", { token: ownerToken }],
      ["/qa/bugs", { token: ownerToken, method: "POST", body: { environment: "development", title: "denied", severity: "low" } }],
      [`/qa/bugs/${ownerBug.id}`, { token: ownerToken, method: "PATCH", body: { status: "closed" } }],
    ]) {
      assert.equal((await call(endpoint, options)).status, 403, `empty allowlist must deny ${endpoint}`);
    }
    await stopServer(server);
    server = startServer(undefined);
    assert.equal((await request("/health")).status, 200, "server without an allowlist should start");
    for (const [endpoint, options] of [
      ["/qa/access", { token: ownerToken }],
      ["/qa/results?environment=development", { token: ownerToken }],
      ["/qa/results/AUTH-001", { token: ownerToken, method: "PUT", body: { environment: "development", status: "pass" } }],
      ["/qa/bugs?environment=development", { token: ownerToken }],
      ["/qa/bugs", { token: ownerToken, method: "POST", body: { environment: "development", title: "denied", severity: "low" } }],
      [`/qa/bugs/${ownerBug.id}`, { token: ownerToken, method: "PATCH", body: { status: "closed" } }],
    ]) {
      assert.equal((await call(endpoint, options)).status, 403, `missing allowlist must deny ${endpoint}`);
    }
    const finalDb = new Database(databasePath, { readonly: true });
    try {
      const rows = finalDb.prepare("SELECT test_id, owner_user_id, status, actual_result FROM qa_test_results").all();
      assert.equal(rows.length, 4, "denied requests must not create extra QA results");
      assert.equal(
        rows.find((row) => row.owner_user_id === owner.user.id && row.test_id === "AUTH-001").actual_result,
        "Broke",
        "denied requests must not modify saved results",
      );
      const bug = finalDb.prepare("SELECT status FROM qa_bugs WHERE id = ?").get(ownerBug.id);
      assert.equal(bug.status, "open", "denied requests must not modify saved bugs");
    } finally {
      finalDb.close();
    }

    console.log("QA routes tests passed");
  } finally {
    try {
      if (server) await stopServer(server);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
      if (output && process.env.DEBUG_SMOKE) console.log(output);
    }
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});