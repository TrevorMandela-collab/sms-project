const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db = require('../utils/db');
const { signToken, requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
const COLLECTION = 'users';

// Valid roles for this system
const ROLES = ['admin', 'teacher', 'parent'];

/**
 * POST /api/auth/register
 * Public for the very first admin account; after that, only an
 * admin can create new accounts (enforced below).
 */
router.post('/register', async (req, res) => {
  const { name, email, password, role, childIds } = req.body;

  if (!name || !email || !password || !role) {
    return res.status(400).json({ error: 'name, email, password, and role are required.' });
  }
  if (!ROLES.includes(role)) {
    return res.status(400).json({ error: `role must be one of: ${ROLES.join(', ')}` });
  }

  const users = db.readAll(COLLECTION);
  const isFirstUser = users.length === 0;

  // After the first (bootstrap) admin account exists, lock registration
  // down to admins only.
  if (!isFirstUser) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
      return res.status(403).json({ error: 'Only an admin can create new accounts. Log in as admin first.' });
    }
    try {
      const jwt = require('jsonwebtoken');
      const { JWT_SECRET } = require('../middleware/auth');
      const payload = jwt.verify(token, JWT_SECRET);
      if (payload.role !== 'admin') {
        return res.status(403).json({ error: 'Only an admin can create new accounts.' });
      }
    } catch {
      return res.status(403).json({ error: 'Only an admin can create new accounts.' });
    }
  }

  if (users.some(u => u.email.toLowerCase() === email.toLowerCase())) {
    return res.status(409).json({ error: 'An account with that email already exists.' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const newUser = {
    id: uuidv4(),
    name,
    email,
    passwordHash,
    role,
    childIds: role === 'parent' ? (childIds || []) : [],
    createdAt: new Date().toISOString(),
  };

  db.insert(COLLECTION, newUser);

  const token = signToken(newUser);
  const { passwordHash: _, ...safeUser } = newUser;
  res.status(201).json({ user: safeUser, token, isFirstAdmin: isFirstUser });
});

/**
 * POST /api/auth/login
 */
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required.' });
  }

  const users = db.readAll(COLLECTION);
  const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const matches = await bcrypt.compare(password, user.passwordHash);
  if (!matches) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const token = signToken(user);
  const { passwordHash: _, ...safeUser } = user;
  res.json({ user: safeUser, token });
});

/**
 * GET /api/auth/me
 */
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

/**
 * GET /api/auth/users  (admin only — manage accounts/roles)
 */
router.get('/users', requireAuth, requireRole('admin'), (req, res) => {
  const users = db.readAll(COLLECTION).map(({ passwordHash, ...safe }) => safe);
  res.json(users);
});

/**
 * PATCH /api/auth/users/:id/role  (admin only)
 */
router.patch('/users/:id/role', requireAuth, requireRole('admin'), (req, res) => {
  const { role } = req.body;
  if (!ROLES.includes(role)) {
    return res.status(400).json({ error: `role must be one of: ${ROLES.join(', ')}` });
  }
  const updated = db.update(COLLECTION, req.params.id, { role });
  if (!updated) return res.status(404).json({ error: 'User not found.' });
  const { passwordHash, ...safe } = updated;
  res.json(safe);
});

module.exports = router;
