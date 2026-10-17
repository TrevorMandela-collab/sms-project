/* =========================================================
   Realtime layer for chats — a lightweight WebSocket server
   that tells connected clients "something changed in this
   chat", rather than pushing full message payloads itself.
   The client reacts by re-fetching that chat's thread over
   the normal REST endpoint. This keeps a single source of
   truth for message shape (the REST response) and avoids
   duplicating create/edit/delete/react logic here.
========================================================= */

const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const db = require('./db');
const { isSchoolAdmin } = require('./roles');
const { isSchoolSuspended } = require('./schoolStatus');
const { jwtSecret: JWT_SECRET } = require('../config');

const CHATS = 'chats';

// Every open, authenticated socket. Each one is tagged with the
// connected user and, once they open a chat, the chatId they're
// currently viewing (set via a { type: 'join' } message from the
// client, cleared via { type: 'leave' }).
const clients = new Set();

async function refreshSocketUser(ws) {
  const storedUser = await db.findById('users', ws.authPayload.id);
  if (
    !storedUser ||
    (storedUser.status && storedUser.status !== 'active') ||
    (ws.authPayload.tokenVersion || 0) !== (storedUser.tokenVersion || 0)
  ) {
    clients.delete(ws);
    ws.close(4001, 'Invalid or expired session');
    return null;
  }
  if (await isSchoolSuspended(storedUser)) {
    clients.delete(ws);
    ws.close(4003, 'School access suspended');
    return null;
  }
  const { passwordHash, ...safeUser } = storedUser;
  ws.user = safeUser;
  return safeUser;
}

function initRealtime(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', async (ws, req) => {
    let payload;
    try {
      const url = new URL(req.url, 'http://localhost');
      const token = url.searchParams.get('token');
      payload = jwt.verify(token, JWT_SECRET);
    } catch {
      ws.close(4001, 'Invalid or missing token');
      return;
    }

    ws.authPayload = payload;
    let user;
    try {
      user = await refreshSocketUser(ws);
      if (!user) return;
    } catch (error) {
      console.error('[realtime] connection authentication failed:', error);
      ws.close(1011, 'Unable to authenticate');
      return;
    }

    ws.chatId = null;
    ws.isAlive = true;
    clients.add(ws);

    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', async (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }

      if (msg.type === 'join' && msg.chatId) {
        try {
          user = await refreshSocketUser(ws);
          if (!user) return;
          const chat = await db.findById(CHATS, msg.chatId);
          const allowed = chat &&
            chat.schoolId === user.schoolId &&
            (isSchoolAdmin(user) || (chat.memberIds || []).includes(user.id));
          ws.chatId = allowed ? msg.chatId : null;
        } catch {
          ws.chatId = null;
        }
      } else if (msg.type === 'leave') {
        ws.chatId = null;
      }
    });

    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
  });

  // Ping every 30s so dead connections (e.g. a laptop that went to
  // sleep) get cleaned up, and so the connection stays alive through
  // any idle-connection timeouts on Render's proxy.
  const interval = setInterval(() => {
    clients.forEach(ws => {
      if (ws.isAlive === false) {
        clients.delete(ws);
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
      refreshSocketUser(ws).catch((error) => {
        console.error('[realtime] session revalidation failed:', error);
        clients.delete(ws);
        ws.close(1011, 'Unable to revalidate session');
      });
    });
  }, 30000);

  wss.on('close', () => clearInterval(interval));

  return () => {
    clearInterval(interval);
    for (const ws of wss.clients) ws.terminate();
    wss.close();
  };
}

/**
 * Tell every client currently viewing `chatId` that something in that
 * chat's thread changed, so they should re-fetch it.
 */
async function broadcastToChat(chatId, payload) {
  try {
    const chat = await db.findById(CHATS, chatId);
    const recipients = [...clients].filter(
      (ws) => ws.chatId === chatId && ws.readyState === ws.OPEN,
    );
    for (const ws of recipients) {
      try {
        const user = await refreshSocketUser(ws);
        if (!user) continue;
        const canAccess = chat
          ? chat.schoolId === user.schoolId &&
            (isSchoolAdmin(user) || (chat.memberIds || []).includes(user.id))
          : false;
        if (canAccess || (!chat && user.schoolId === ws.user.schoolId)) {
          ws.send(JSON.stringify(payload));
        }
        if (!canAccess) ws.chatId = null;
      } catch (error) {
        console.error('[realtime] chat broadcast authorization failed:', error);
        ws.chatId = null;
      }
    }
  } catch (error) {
    console.error('[realtime] chat broadcast lookup failed:', error);
  }
}

module.exports = { initRealtime, broadcastToChat };
