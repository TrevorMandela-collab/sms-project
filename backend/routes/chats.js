const express = require('express');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const db = require('../utils/db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
const CHATS = 'chats';
const MESSAGES = 'chat-messages';

// Each chat (a "server"): { id, name, memberIds, createdBy, createdAt, inviteCode }
// Each message: { id, chatId, senderId, senderName, senderRole, text, createdAt }

function safe(handler) {
  return (req, res) => {
    handler(req, res).catch(err => {
      console.error('[chats] request failed:', err);
      res.status(500).json({ error: 'Something went wrong on the server.' });
    });
  };
}

function generateInviteCode() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let raw = '';
  for (let i = 0; i < 8; i++) raw += alphabet[crypto.randomInt(0, alphabet.length)];
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

async function requireMembership(req, res, next) {
  const chat = await db.findById(CHATS, req.params.chatId || req.params.id);
  if (!chat) return res.status(404).json({ error: 'Chat not found.' });
  if (req.user.role !== 'admin' && !chat.memberIds.includes(req.user.id)) {
    return res.status(403).json({ error: "You're not a member of this chat." });
  }
  req.chat = chat;
  next();
}

/**
 * GET /api/chats
 * Admins see every chat; everyone else sees only chats they're a member of.
 */
router.get('/', requireAuth, safe(async (req, res) => {
  const chats = await db.readAll(CHATS);
  const visible = req.user.role === 'admin'
    ? chats
    : chats.filter(c => c.memberIds.includes(req.user.id));
  res.json(visible);
}));

/**
 * POST /api/chats  (admin only)
 * body: { name, memberIds? }
 */
router.post('/', requireAuth, requireRole('admin'), safe(async (req, res) => {
  const { name, memberIds } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'A chat name is required.' });
  }
  const chat = {
    id: uuidv4(),
    name: name.trim(),
    memberIds: Array.isArray(memberIds) ? [...new Set([...memberIds, req.user.id])] : [req.user.id],
    createdBy: req.user.id,
    createdAt: new Date().toISOString(),
    inviteCode: generateInviteCode(),
  };
  await db.insert(CHATS, chat);
  res.status(201).json(chat);
}));

/**
 * PATCH /api/chats/:id  (admin only)
 * body: { name?, memberIds? } — replace name and/or the full member list.
 */
router.patch('/:id', requireAuth, requireRole('admin'), safe(async (req, res) => {
  const { name, memberIds } = req.body;
  const updates = {};
  if (name !== undefined) updates.name = name.trim();
  if (memberIds !== undefined) updates.memberIds = memberIds;
  const updated = await db.update(CHATS, req.params.id, updates);
  if (!updated) return res.status(404).json({ error: 'Chat not found.' });
  res.json(updated);
}));

/**
 * POST /api/chats/:id/regenerate-code  (admin only)
 * Rotates the invite code (e.g. if it leaked / needs revoking).
 */
router.post('/:id/regenerate-code', requireAuth, requireRole('admin'), safe(async (req, res) => {
  const updated = await db.update(CHATS, req.params.id, { inviteCode: generateInviteCode() });
  if (!updated) return res.status(404).json({ error: 'Chat not found.' });
  res.json(updated);
}));

/**
 * DELETE /api/chats/:id  (admin only)
 * Deletes the chat and all of its messages.
 */
router.delete('/:id', requireAuth, requireRole('admin'), safe(async (req, res) => {
  const removed = await db.remove(CHATS, req.params.id);
  if (!removed) return res.status(404).json({ error: 'Chat not found.' });
  const messages = await db.readAll(MESSAGES);
  const toDelete = messages.filter(m => m.chatId === req.params.id);
  for (const m of toDelete) await db.remove(MESSAGES, m.id);
  res.status(204).end();
}));

/**
 * POST /api/chats/join  (any authenticated user)
 * body: { code }
 */
router.post('/join', requireAuth, safe(async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'An invite code is required.' });
  const chats = await db.readAll(CHATS);
  const chat = chats.find(c => c.inviteCode.toUpperCase() === String(code).trim().toUpperCase());
  if (!chat) return res.status(404).json({ error: 'That invite code is not valid.' });
  if (chat.memberIds.includes(req.user.id)) {
    return res.json(chat); // already a member, no-op
  }
  const updated = await db.update(CHATS, chat.id, { memberIds: [...chat.memberIds, req.user.id] });
  res.json(updated);
}));

/**
 * GET /api/chats/:chatId/messages  (members + admin only)
 */
router.get('/:chatId/messages', requireAuth, requireMembership, safe(async (req, res) => {
  const messages = await db.readAll(MESSAGES);
  const thread = messages
    .filter(m => m.chatId === req.params.chatId)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  res.json(thread);
}));

/**
 * POST /api/chats/:chatId/messages  (members + admin only)
 * body: { text }
 */
router.post('/:chatId/messages', requireAuth, requireMembership, safe(async (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'Message text is required.' });
  }
  const message = {
    id: uuidv4(),
    chatId: req.params.chatId,
    senderId: req.user.id,
    senderName: req.user.name,
    senderRole: req.user.role,
    text: text.trim(),
    createdAt: new Date().toISOString(),
  };
  await db.insert(MESSAGES, message);
  res.status(201).json(message);
}));

module.exports = router;
