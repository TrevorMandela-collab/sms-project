const express = require("express");
const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");
const db = require("../utils/db");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();
const COLLECTION = "invite-codes";

// Each invite code:
// { id, code, role, schoolId, studentId?, teacherId?, childIds?, createdBy, createdAt, expiresAt, used, usedAt, usedByUserId }
// - role 'student': studentId is required — the invite is tied to one specific student record.
// - role 'teacher': teacherId is optional — admin can pre-link a teacher record, or leave blank
//   and link it later from Manage Logins.
// - role 'parent': childIds is optional — admin can pre-select which children this parent
//   should see, or leave blank and set it later from Manage Logins.

function generateCode() {
  // 8 chars, split for readability, avoiding ambiguous characters (0/O, 1/I).
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let raw = "";
  for (let i = 0; i < 8; i++) {
    raw += alphabet[crypto.randomInt(0, alphabet.length)];
  }
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

// Wraps an async handler so a thrown/rejected error becomes a 500
// instead of an unhandled rejection that hangs the request.
function safe(handler) {
  return (req, res) => {
    handler(req, res).catch((err) => {
      console.error("[invite-codes] request failed:", err);
      res.status(500).json({ error: "Something went wrong on the server." });
    });
  };
}

/**
 * POST /api/invite-codes  (admin only)
 * body: { role, studentId?, teacherId?, childIds?, expiresInDays? }
 * Generates a fresh single-use invite code for the given role.
 */
router.post(
  "/",
  requireAuth,
  requireRole("admin"),
  safe(async (req, res) => {
    const { role, studentId, teacherId, childIds, expiresInDays } = req.body;
    if (!["student", "teacher", "parent"].includes(role)) {
      return res
        .status(400)
        .json({ error: "role must be 'student', 'teacher', or 'parent'." });
    }

    if (role === "student") {
      if (!studentId) {
        return res
          .status(400)
          .json({ error: "studentId is required for a student invite." });
      }
      const student = await db.findById("students", studentId);
      if (!student) {
        return res.status(404).json({ error: "Student record not found." });
      }
    }
    if (role === "teacher" && teacherId) {
      const teacher = await db.findById("teachers", teacherId);
      if (!teacher) {
        return res.status(404).json({ error: "Teacher record not found." });
      }
    }
    if (role === "parent" && Array.isArray(childIds) && childIds.length) {
      const students = await db.readAll("students");
      const validIds = new Set(students.map((s) => s.id));
      if (!childIds.every((id) => validIds.has(id))) {
        return res
          .status(404)
          .json({ error: "One or more selected children were not found." });
      }
    }

    const days =
      Number.isFinite(expiresInDays) && expiresInDays > 0 ? expiresInDays : 7;
    const expiresAt = new Date(
      Date.now() + days * 24 * 60 * 60 * 1000,
    ).toISOString();

    const invite = {
      id: uuidv4(),
      code: generateCode(),
      role,
      schoolId: req.user.schoolId || null,
      studentId: role === "student" ? studentId : null,
      teacherId: role === "teacher" ? teacherId || null : null,
      childIds: role === "parent" ? childIds || [] : [],
      createdBy: req.user.id,
      createdAt: new Date().toISOString(),
      expiresAt,
      used: false,
    };
    await db.insert(COLLECTION, invite);
    res.status(201).json(invite);
  }),
);

/**
 * GET /api/invite-codes?studentId=xxx&role=teacher  (admin only)
 * Lists invite codes, optionally filtered by studentId and/or role — lets
 * the admin UI show any outstanding (unused, unexpired) code before
 * generating a new one.
 */
router.get(
  "/",
  requireAuth,
  requireRole("admin"),
  safe(async (req, res) => {
    let codes = await db.readAll(COLLECTION);
    if (req.query.studentId) {
      codes = codes.filter((c) => c.studentId === req.query.studentId);
    }
    if (req.query.role) {
      codes = codes.filter((c) => (c.role || "student") === req.query.role);
    }
    res.json(codes);
  }),
);

/**
 * DELETE /api/invite-codes/:id  (admin only)
 * Revokes an outstanding (not-yet-used) code.
 */
router.delete(
  "/:id",
  requireAuth,
  requireRole("admin"),
  safe(async (req, res) => {
    const removed = await db.remove(COLLECTION, req.params.id);
    if (!removed)
      return res.status(404).json({ error: "Invite code not found." });
    res.status(204).end();
  }),
);

module.exports = router;
