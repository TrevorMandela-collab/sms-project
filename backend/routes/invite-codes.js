const express = require('express');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const db = require('../utils/db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
const COLLECTION = 'invite-codes';

// Each invite code: { id, code, studentId, createdBy, createdAt, expiresAt, used, usedAt, usedByUserId }

function generateCode() {
  // 8 chars, split for readability, avoiding ambiguous characters (0/O, 1/I).
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let raw = '';
  for (let i = 0; i < 8; i++) {
    raw += alphabet[crypto.randomInt(0, alphabet.length)];
  }
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

// Wraps an async handler so a thrown/rejected error becomes a 500
// instead of an unhandled rejection that hangs the request.
function safe(handler) {
  return (req, res) => {
    handler(req, res).catch(err => {
      console.error('[invite-codes] request failed:', err);
      res.status(500).json({ error: 'Something went wrong on the server.' });
    });
  };
}

/**
 * POST /api/invite-codes  (admin only)
 * body: { studentId, expiresInDays? }
 * Generates a fresh single-use code tied to a student record.
 */
router.post('/', requireAuth, requireRole('admin'), safe(async (req, res) => {
  const { studentId, expiresInDays } = req.body;
  if (!studentId) {
    return res.status(400).json({ error: 'studentId is required.' });
  }
  const student = await db.findById('students', studentId);
  if (!student) {
    return res.status(404).json({ error: 'Student record not found.' });
  }

  const days = Number.isFinite(expiresInDays) && expiresInDays > 0 ? expiresInDays : 7;
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

  const invite = {
    id: uuidv4(),
    code: generateCode(),
    studentId,
    createdBy: req.user.id,
    createdAt: new Date().toISOString(),
    expiresAt,
    used: false,
  };
  await db.insert(COLLECTION, invite);
  res.status(201).json(invite);
}));

/**
 * GET /api/invite-codes?studentId=xxx  (admin only)
 * Lists invite codes, optionally filtered to one student — lets the
 * admin UI show any outstanding (unused, unexpired) code before
 * generating a new one.
 */
router.get('/', requireAuth, requireRole('admin'), safe(async (req, res) => {
  let codes = await db.readAll(COLLECTION);
  if (req.query.studentId) {
    codes = codes.filter(c => c.studentId === req.query.studentId);
  }
  res.json(codes);
}));

/**
 * DELETE /api/invite-codes/:id  (admin only)
 * Revokes an outstanding (not-yet-used) code.
 */
router.delete('/:id', requireAuth, requireRole('admin'), safe(async (req, res) => {
  const removed = await db.remove(COLLECTION, req.params.id);
  if (!removed) return res.status(404).json({ error: 'Invite code not found.' });
  res.status(204).end();
}));

module.exports = router;
