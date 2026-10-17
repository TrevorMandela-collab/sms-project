const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const { spawn } = require("child_process");

const port = 4313;
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sms-qa-bugs-test-"));
const databasePath = path.join(directory, "qa-bugs.sqlite");
const baseUrl = `http://127.0.0.1:${port}/api`;
const ownerEmail = "qa-owner@example.test";
const secondOwnerEmail = "qa-owner2@example.test";
const secondOwnerPassword = "qa-owner2-password-123!";
const unknownBugId = "00000000-0000-4000-8000-000000000000";

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

function stopServer(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 5000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill();
  });
}

async function run() {
  const server = spawn(process.execPath, ["server.js"], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      PORT: String(port),
      SQLITE_PATH: databasePath,
      DATABASE_URL: "",
      JWT_SECRET: "qa-bugs-test-secret",
      NODE_ENV: "test",
      TRUST_PROXY_HOPS: "1",
      QA_OWNER_EMAILS: `${ownerEmail},${secondOwnerEmail}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  server.stdout.on("data", (chunk) => { output += chunk; });
  server.stderr.on("data", (chunk) => { output += chunk; });

  try {
    const health = await request("/health");
    assert.equal(health.status, 200, "health endpoint should respond");

    // First owner = bootstrap admin.
    const registration = await call("/auth/register", {
      method: "POST",
      body: {
        name: "QA Owner",
        email: ownerEmail,
        password: "qa-owner-password-123!",
        role: "admin",
        schoolName: "QA Bugs School",
      },
    });
    if (registration.status !== 201) throw new Error(`owner registration failed: ${await registration.text()}`);
    const owner = await registration.json();
    const ownerToken = owner.token;

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

    // Second owner = an admin of a different school, created directly in the database.
    const now = new Date().toISOString();
    const setup = new Database(databasePath);
    setup.pragma("foreign_keys = ON");
    setup.prepare(
      "INSERT INTO schools (id, name, settings_json, onboarding_completed, created_at, updated_at, extra_data) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run("second-owner-school", "Second Owner School", "{}", 0, now, now, "{}");
    setup.prepare(
      "INSERT INTO users (id, school_id, name, email, password_hash, role_code, status, token_version, created_at, updated_at, extra_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run("second-owner-user", "second-owner-school", "Second Owner", secondOwnerEmail, bcrypt.hashSync(secondOwnerPassword, 4), "admin", "active", 0, now, now, "{}");
    setup.close();
    const secondLogin = await call("/auth/login", {
      method: "POST",
      body: { email: secondOwnerEmail, password: secondOwnerPassword },
    });
    if (secondLogin.status !== 200) throw new Error(`second owner login failed: ${await secondLogin.text()}`);
    const secondToken = (await secondLogin.json()).token;

    const goodBug = {
      environment: "development",
      title: "Sidebar label shows SMS admin for teachers",
      severity: "medium",
      steps: "Log in as a teacher and look at the sidebar header.",
      expected: "The label matches the role.",
      actual: "It says SMS admin.",
      evidence: "https://example.test/screenshot",
      linkedTestId: "AUTH-001",
    };

    // 1. No login -> 401.
    assert.equal((await call("/qa/bugs?environment=development")).status, 401, "list without login must be 401");
    assert.equal((await call("/qa/bugs", { method: "POST", body: goodBug })).status, 401, "create without login must be 401");
    assert.equal((await call(`/qa/bugs/${unknownBugId}`, { method: "PATCH", body: { status: "closed" } })).status, 401, "close without login must be 401");

    // 2. Not the owner -> 403.
    assert.equal((await call("/qa/bugs?environment=development", { token: parentToken })).status, 403, "non-owner list must be 403");
    assert.equal((await call("/qa/bugs", { token: parentToken, method: "POST", body: goodBug })).status, 403, "non-owner create must be 403");
    assert.equal((await call(`/qa/bugs/${unknownBugId}`, { token: parentToken, method: "PATCH", body: { status: "closed" } })).status, 403, "non-owner close must be 403");

    // 3. Owner: empty list, create, list, environments separate.
    const empty = await (await call("/qa/bugs?environment=development", { token: ownerToken })).json();
    assert.deepEqual(empty.bugs, [], "no bugs should exist yet");

    const created = await call("/qa/bugs", { token: ownerToken, method: "POST", body: goodBug });
    assert.equal(created.status, 201, "owner should create a bug");
    const bug = await created.json();
    assert.equal(bug.title, goodBug.title);
    assert.equal(bug.severity, "medium");
    assert.equal(bug.status, "open");
    assert.equal(bug.linkedTestId, "AUTH-001");
    assert.equal(bug.evidence, goodBug.evidence);
    assert.ok(/^[0-9a-f-]{36}$/.test(bug.id), "server must generate the id");

    // The authenticated non-owner cannot read, create, or modify existing QA data.
    assert.equal((await call("/qa/bugs?environment=development")).status, 401, "bug read without login must be 401");
    assert.equal(
      (await call(`/qa/bugs/${bug.id}`, { method: "PATCH", body: { status: "closed" } })).status,
      401,
      "modifying an existing bug without login must be 401",
    );
    assert.equal(
      (await call("/qa/bugs?environment=development", { token: parentToken })).status,
      403,
      "non-owner must not read an existing bug list",
    );
    assert.equal(
      (await call("/qa/bugs", { token: parentToken, method: "POST", body: goodBug })).status,
      403,
      "non-owner must not create bugs",
    );
    assert.equal(
      (await call(`/qa/bugs/${bug.id}`, { token: parentToken, method: "PATCH", body: { status: "closed" } })).status,
      403,
      "non-owner must not modify an existing bug",
    );
    const unchangedOwnerList = await (await call("/qa/bugs?environment=development", { token: ownerToken })).json();
    assert.equal(unchangedOwnerList.bugs.length, 1, "denied non-owner create must not add a bug");
    assert.equal(unchangedOwnerList.bugs[0].status, "open", "denied non-owner update must not modify the bug");

    const listed = await (await call("/qa/bugs?environment=development", { token: ownerToken })).json();
    assert.equal(listed.bugs.length, 1);
    assert.equal(listed.bugs[0].id, bug.id);
    const prod = await (await call("/qa/bugs?environment=production", { token: ownerToken })).json();
    assert.deepEqual(prod.bugs, [], "production bugs must be separate from development");

    // 4. Bad input -> 400.
    const bad = async (body, message) => {
      const res = await call("/qa/bugs", { token: ownerToken, method: "POST", body });
      assert.equal(res.status, 400, message);
    };
    await bad({ ...goodBug, environment: "staging" }, "unknown environment must be 400");
    await bad({ ...goodBug, environment: undefined }, "missing environment must be 400");
    await bad({ ...goodBug, title: "   " }, "empty title must be 400");
    await bad({ ...goodBug, title: undefined }, "missing title must be 400");
    await bad({ ...goodBug, title: "x".repeat(201) }, "title over 200 characters must be 400");
    await bad({ ...goodBug, severity: "urgent" }, "unknown severity must be 400");
    await bad({ ...goodBug, steps: "x".repeat(2001) }, "steps over 2000 characters must be 400");
    await bad({ ...goodBug, evidence: "x".repeat(2001) }, "evidence over 2000 characters must be 400");
    await bad({ ...goodBug, actual: 123 }, "non-text actual must be 400");
    await bad({ ...goodBug, linkedTestId: "not-a-test-id" }, "bad linked test id must be 400");
    assert.equal((await call("/qa/bugs?environment=staging", { token: ownerToken })).status, 400, "unknown environment on list must be 400");
    assert.equal((await call("/qa/bugs", { token: ownerToken })).status, 400, "missing environment on list must be 400");

    // 5. Forged owner id, id and status in the body are ignored.
    const forged = await call("/qa/bugs", {
      token: ownerToken,
      method: "POST",
      body: { ...goodBug, title: "Forged fields", linkedTestId: "", ownerUserId: parent.user.id, owner_user_id: parent.user.id, id: "forged-id", status: "closed" },
    });
    assert.equal(forged.status, 201, "extra fields should be ignored, not break the create");
    const forgedBug = await forged.json();
    assert.equal(forgedBug.status, "open", "new bugs must always start open");
    assert.equal(forgedBug.linkedTestId, null, "empty linkedTestId must be stored as none");
    const check = new Database(databasePath, { readonly: true });
    try {
      const rows = check.prepare("SELECT id, owner_user_id FROM qa_bugs").all();
      assert.equal(rows.length, 2);
      for (const row of rows) {
        assert.equal(row.owner_user_id, owner.user.id, "every bug must belong to the logged-in owner");
        assert.notEqual(row.id, "forged-id", "ids must be generated by the server");
      }
    } finally {
      check.close();
    }

    // 6. Close and reopen; bad status, bad id and unknown id.
    const closed = await call(`/qa/bugs/${bug.id}`, { token: ownerToken, method: "PATCH", body: { status: "closed" } });
    assert.equal(closed.status, 200, "owner should close a bug");
    assert.equal((await closed.json()).status, "closed");
    const reopened = await call(`/qa/bugs/${bug.id}`, { token: ownerToken, method: "PATCH", body: { status: "open" } });
    assert.equal(reopened.status, 200, "owner should reopen a bug");
    assert.equal((await reopened.json()).status, "open");
    assert.equal((await call(`/qa/bugs/${bug.id}`, { token: ownerToken, method: "PATCH", body: { status: "deleted" } })).status, 400, "bad status must be 400");
    assert.equal((await call("/qa/bugs/not-an-id", { token: ownerToken, method: "PATCH", body: { status: "closed" } })).status, 400, "bad bug id must be 400");
    assert.equal((await call(`/qa/bugs/${unknownBugId}`, { token: ownerToken, method: "PATCH", body: { status: "closed" } })).status, 404, "unknown bug must be 404");

    // 7. A second owner cannot see or change the first owner's bugs.
    assert.equal((await call("/qa/access", { token: secondToken })).status, 200, "second owner passes the gate");
    const secondList = await (await call("/qa/bugs?environment=development", { token: secondToken })).json();
    assert.deepEqual(secondList.bugs, [], "second owner must not see the first owner's bugs");
    const steal = await call(`/qa/bugs/${bug.id}`, { token: secondToken, method: "PATCH", body: { status: "closed" } });
    assert.equal(steal.status, 404, "second owner must not change the first owner's bug");
    const stillOpen = await (await call("/qa/bugs?environment=development", { token: ownerToken })).json();
    assert.equal(stillOpen.bugs.find((item) => item.id === bug.id).status, "open", "first owner's bug must be untouched");

    const secondBug = await call("/qa/bugs", { token: secondToken, method: "POST", body: { ...goodBug, title: "Second owner bug" } });
    assert.equal(secondBug.status, 201);
    const firstAfter = await (await call("/qa/bugs?environment=development", { token: ownerToken })).json();
    assert.equal(firstAfter.bugs.length, 2, "first owner must still see only their own two bugs");
    const secondAfter = await (await call("/qa/bugs?environment=development", { token: secondToken })).json();
    assert.equal(secondAfter.bugs.length, 1, "second owner must see only their own bug");

    // 8. The per-owner, per-environment limit remains enforced under concurrency.
    const limitSetup = new Database(databasePath);
    try {
      const fixtureInsert = limitSetup.prepare(
        "INSERT INTO qa_bugs (id, owner_user_id, environment, title, severity, created_at, updated_at) VALUES (?, ?, 'development', ?, 'low', ?, ?)",
      );
      const now = new Date().toISOString();
      const insertFixtures = limitSetup.transaction(() => {
        for (let index = 0; index < 497; index += 1) {
          fixtureInsert.run(
            `limit-fixture-${index}`,
            owner.user.id,
            `Small limit fixture ${index}`,
            now,
            now,
          );
        }
      });
      insertFixtures();
    } finally {
      limitSetup.close();
    }

    const beforeConcurrentRequests = await call("/qa/bugs?environment=development", { token: ownerToken });
    assert.equal(beforeConcurrentRequests.status, 200);
    assert.equal((await beforeConcurrentRequests.json()).bugs.length, 500 - 1, "owner should have 499 development bugs before concurrent creates");

    const concurrentResults = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        call("/qa/bugs", {
          token: ownerToken,
          method: "POST",
          body: { ...goodBug, title: `Concurrent limit request ${index}` },
        }),
      ),
    );
    assert.equal(
      concurrentResults.filter((response) => response.status === 201).length,
      1,
      "exactly one concurrent create should use the final available slot",
    );
    assert.equal(
      concurrentResults.filter((response) => response.status === 400).length,
      3,
      "concurrent creates after the limit should be rejected",
    );

    const countDb = new Database(databasePath, { readonly: true });
    try {
      const count = countDb.prepare(
        "SELECT COUNT(*) AS count FROM qa_bugs WHERE owner_user_id = ? AND environment = 'development'",
      ).get(owner.user.id);
      assert.equal(Number(count.count), 500, "concurrent requests must not exceed 500 bugs for this owner and environment");
    } finally {
      countDb.close();
    }

    const overLimit = await call("/qa/bugs", {
      token: ownerToken,
      method: "POST",
      body: { ...goodBug, title: "The 501st development bug" },
    });
    assert.equal(overLimit.status, 400, "the 501st effective bug must be rejected");

    const otherEnvironment = await call("/qa/bugs", {
      token: ownerToken,
      method: "POST",
      body: { ...goodBug, environment: "production", title: "Independent environment bug" },
    });
    assert.equal(otherEnvironment.status, 201, "the limit must be scoped to owner and environment");

    console.log("QA bugs tests passed");
  } finally {
    try {
      await stopServer(server);
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