const crypto = require("crypto");
const express = require("express");
const { requireAuth, requireQaOwner } = require("../middleware/qa-owner");
const { requireRole } = require("../middleware/auth");
const db = require("../utils/db");

const router = express.Router();
const requireQaAdmin = requireRole("admin", "super_admin");

router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  if (req.headers["if-none-match"] || req.headers["if-modified-since"]) {
    req.headers["cache-control"] = "no-cache";
  }
  next();
});

const ENVIRONMENTS = ["development", "production"];
const STATUSES = ["pass", "fail", "blocked", "notrun"];
const TEST_ID_PATTERN = /^[A-Z]{2,10}-\d{1,4}$/;
const MAX_TEXT = 2000;

function badRequest(res, message) {
  return res.status(400).json({ error: message });
}

// The QA page checks that the signed-in user is an allowlisted school or platform administrator.
router.get("/access", requireAuth, requireQaOwner, requireQaAdmin, (req, res) => {
  res.json({ allowed: true });
});

// Load the owner's saved results for one environment.
router.get("/results", requireAuth, requireQaOwner, requireQaAdmin, async (req, res, next) => {
  try {
    const environment = String(req.query.environment || "");
    if (!ENVIRONMENTS.includes(environment)) {
      return badRequest(res, "environment must be development or production.");
    }
    const rows = await db.all(
      "SELECT test_id, status, actual_result, notes, updated_at FROM qa_test_results WHERE owner_user_id = ? AND environment = ? ORDER BY test_id",
      [req.user.id, environment],
    );
    res.json({
      environment,
      results: rows.map((row) => ({
        testId: row.test_id,
        status: row.status,
        actual: row.actual_result,
        notes: row.notes,
        updatedAt: row.updated_at,
      })),
    });
  } catch (error) {
    next(error);
  }
});

// Save (create or update) one result. The owner is always the logged-in user.
router.put("/results/:testId", requireAuth, requireQaOwner, requireQaAdmin, async (req, res, next) => {
  try {
    const testId = String(req.params.testId || "");
    const body = req.body || {};
    if (!TEST_ID_PATTERN.test(testId)) {
      return badRequest(res, "testId is not valid.");
    }
    if (!ENVIRONMENTS.includes(body.environment)) {
      return badRequest(res, "environment must be development or production.");
    }
    if (!STATUSES.includes(body.status)) {
      return badRequest(res, "status must be pass, fail, blocked or notrun.");
    }
    const actual = body.actual === undefined ? "" : body.actual;
    const notes = body.notes === undefined ? "" : body.notes;
    if (typeof actual !== "string" || typeof notes !== "string") {
      return badRequest(res, "actual and notes must be text.");
    }
    if (actual.length > MAX_TEXT || notes.length > MAX_TEXT) {
      return badRequest(res, "actual and notes must be 2000 characters or fewer.");
    }

    const now = new Date().toISOString();
    await db.execute(
      "INSERT INTO qa_test_results (id, owner_user_id, environment, test_id, status, actual_result, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (owner_user_id, environment, test_id) DO UPDATE SET status = excluded.status, actual_result = excluded.actual_result, notes = excluded.notes, updated_at = excluded.updated_at",
      [crypto.randomUUID(), req.user.id, body.environment, testId, body.status, actual, notes, now, now],
    );
    res.json({
      testId,
      environment: body.environment,
      status: body.status,
      actual,
      notes,
      updatedAt: now,
    });
  } catch (error) {
    next(error);
  }
});

const SEVERITIES = ["low", "medium", "high", "critical"];
const BUG_STATUSES = ["open", "closed"];
const BUG_ID_PATTERN = /^[0-9a-f-]{36}$/;
const MAX_TITLE = 200;
const MAX_BUGS_PER_OWNER = 500;

function bugFromRow(row) {
  return {
    id: row.id,
    environment: row.environment,
    title: row.title,
    severity: row.severity,
    steps: row.steps,
    expected: row.expected_result,
    actual: row.actual_result,
    evidence: row.evidence,
    linkedTestId: row.linked_test_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const BUG_COLUMNS =
  "id, environment, title, severity, steps, expected_result, actual_result, evidence, linked_test_id, status, created_at, updated_at";

// List the owner's bugs for one environment.
router.get("/bugs", requireAuth, requireQaOwner, requireQaAdmin, async (req, res, next) => {
  try {
    const environment = String(req.query.environment || "");
    if (!ENVIRONMENTS.includes(environment)) {
      return badRequest(res, "environment must be development or production.");
    }
    const rows = await db.all(
      "SELECT " + BUG_COLUMNS + " FROM qa_bugs WHERE owner_user_id = ? AND environment = ? ORDER BY created_at DESC LIMIT 500",
      [req.user.id, environment],
    );
    res.json({ environment, bugs: rows.map(bugFromRow) });
  } catch (error) {
    next(error);
  }
});

// Create a bug. The owner is always the logged-in user; the id is made by the server.
router.post("/bugs", requireAuth, requireQaOwner, requireQaAdmin, async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!ENVIRONMENTS.includes(body.environment)) {
      return badRequest(res, "environment must be development or production.");
    }
    if (typeof body.title !== "string" || !body.title.trim()) {
      return badRequest(res, "title is required.");
    }
    const title = body.title.trim();
    if (title.length > MAX_TITLE) {
      return badRequest(res, "title must be 200 characters or fewer.");
    }
    if (!SEVERITIES.includes(body.severity)) {
      return badRequest(res, "severity must be low, medium, high or critical.");
    }
    const texts = {};
    for (const field of ["steps", "expected", "actual", "evidence"]) {
      const value = body[field] === undefined ? "" : body[field];
      if (typeof value !== "string") {
        return badRequest(res, field + " must be text.");
      }
      if (value.length > MAX_TEXT) {
        return badRequest(res, field + " must be 2000 characters or fewer.");
      }
      texts[field] = value;
    }
    let linkedTestId = null;
    if (body.linkedTestId !== undefined && body.linkedTestId !== null && body.linkedTestId !== "") {
      if (typeof body.linkedTestId !== "string" || !TEST_ID_PATTERN.test(body.linkedTestId)) {
        return badRequest(res, "linkedTestId is not valid.");
      }
      linkedTestId = body.linkedTestId;
    }

    const created = await db.transaction(async () => {
      if (db.dialect === "postgres") {
        await db.all("SELECT id FROM users WHERE id = ? FOR UPDATE", [req.user.id]);
      }
      const existing = await db.all(
        "SELECT COUNT(*) AS count FROM qa_bugs WHERE owner_user_id = ? AND environment = ?",
        [req.user.id, body.environment],
      );
      if (Number(existing[0].count) >= MAX_BUGS_PER_OWNER) {
        return null;
      }

      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await db.execute(
        "INSERT INTO qa_bugs (id, owner_user_id, environment, title, severity, steps, expected_result, actual_result, evidence, linked_test_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)",
        [id, req.user.id, body.environment, title, body.severity, texts.steps, texts.expected, texts.actual, texts.evidence, linkedTestId, now, now],
      );
      const rows = await db.all(
        "SELECT " + BUG_COLUMNS + " FROM qa_bugs WHERE id = ? AND owner_user_id = ?",
        [id, req.user.id],
      );
      return rows[0];
    });
    if (!created) {
      return badRequest(res, "Bug limit reached (500).");
    }

    res.status(201).json(bugFromRow(created));
  } catch (error) {
    next(error);
  }
});

// Open or close one of the owner's bugs.
router.patch("/bugs/:id", requireAuth, requireQaOwner, requireQaAdmin, async (req, res, next) => {
  try {
    const id = String(req.params.id || "");
    if (!BUG_ID_PATTERN.test(id)) {
      return badRequest(res, "bug id is not valid.");
    }
    const status = (req.body || {}).status;
    if (!BUG_STATUSES.includes(status)) {
      return badRequest(res, "status must be open or closed.");
    }
    const found = await db.all(
      "SELECT id FROM qa_bugs WHERE id = ? AND owner_user_id = ?",
      [id, req.user.id],
    );
    if (found.length === 0) {
      return res.status(404).json({ error: "Bug not found." });
    }
    await db.execute(
      "UPDATE qa_bugs SET status = ?, updated_at = ? WHERE id = ? AND owner_user_id = ?",
      [status, new Date().toISOString(), id, req.user.id],
    );
    const rows = await db.all(
      "SELECT " + BUG_COLUMNS + " FROM qa_bugs WHERE id = ? AND owner_user_id = ?",
      [id, req.user.id],
    );
    res.json(bugFromRow(rows[0]));
  } catch (error) {
    next(error);
  }
});

module.exports = router;