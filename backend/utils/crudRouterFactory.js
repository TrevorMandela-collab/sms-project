const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const { requireAuth, requireRole } = require('../middleware/auth');

/**
 * Builds a full CRUD router for a collection.
 *
 * @param {string} collection - name of the collection (e.g. 'students')
 * @param {object} options
 *   permissions: { create: [roles], read: [roles], update: [roles], delete: [roles] }
 *   scopeForParent: async (records, user) => filteredRecords
 *     If provided, parent-role GET requests are filtered through this
 *     function so parents only ever see their own children's records.
 *     May itself read other collections (e.g. to resolve class names),
 *     so it can be async.
 *   scopeForStudent: async (records, user) => filteredRecords
 *     Same idea, applied to student-role GET requests so a student only
 *     ever sees their own records.
 *   scopeForTeacher: async (records, user) => filteredRecords
 *     Same idea, applied to teacher-role GET requests — so a teacher only
 *     ever sees records for their own assigned class(es), not the whole
 *     school. See utils/teacherScope.js for the shared lookup helpers.
 *   writeGuardForTeacher: async (candidateRecord, user) => boolean
 *     For teacher-role CREATE/UPDATE/DELETE — checked against what the
 *     record will look like after the write (existing fields merged with
 *     the request body). Returning false blocks the write with a 403, so
 *     a teacher can't create or edit a record for a student/class outside
 *     their own assignment even though they otherwise have write access
 *     to this collection.
 *   seed: array of default records to seed the collection with if it's
 *     currently empty
 */
function createCrudRouter(collection, options = {}) {
  const router = express.Router();

  const permissions = {
    create: options.permissions?.create || ['admin'],
    read: options.permissions?.read || ['admin', 'teacher', 'parent'],
    update: options.permissions?.update || ['admin'],
    delete: options.permissions?.delete || ['admin'],
  };

  if (options.seed) {
    db.ensureFile(collection, options.seed).catch(err => {
      console.error(`[${collection}] failed to seed:`, err.message);
    });
  }

  // Applies whichever scoping function matches the requester's role, if any.
  async function applyScope(records, user) {
    if (user.role === 'parent' && options.scopeForParent) {
      return options.scopeForParent(records, user);
    }
    if (user.role === 'student' && options.scopeForStudent) {
      return options.scopeForStudent(records, user);
    }
    if (user.role === 'teacher' && options.scopeForTeacher) {
      return options.scopeForTeacher(records, user);
    }
    return records;
  }

  // For a teacher-role write, checks the record-as-it-will-be against
  // writeGuardForTeacher. Every other role/collection is unaffected.
  async function teacherMayWrite(candidateRecord, user) {
    if (user.role !== 'teacher' || !options.writeGuardForTeacher) return true;
    return options.writeGuardForTeacher(candidateRecord, user);
  }

  // Wraps an async handler so a thrown/rejected error becomes a 500
  // instead of an unhandled rejection that hangs the request.
  function safe(handler) {
    return (req, res) => {
      handler(req, res).catch(err => {
        console.error(`[${collection}] request failed:`, err);
        res.status(500).json({ error: 'Something went wrong on the server.' });
      });
    };
  }

  // ---- LIST ----
  router.get('/', requireAuth, requireRole(...permissions.read), safe(async (req, res) => {
    const all = await db.readAll(collection);
    const records = await applyScope(all, req.user);
    res.json(records);
  }));

  // ---- GET ONE ----
  router.get('/:id', requireAuth, requireRole(...permissions.read), safe(async (req, res) => {
    const record = await db.findById(collection, req.params.id);
    if (!record) return res.status(404).json({ error: `${collection} record not found.` });

    const allowed = await applyScope([record], req.user);
    if (!allowed.length) return res.status(403).json({ error: 'Not authorized to view this record.' });
    res.json(record);
  }));

  // ---- CREATE ----
  router.post('/', requireAuth, requireRole(...permissions.create), safe(async (req, res) => {
    const mayWrite = await teacherMayWrite(req.body, req.user);
    if (!mayWrite) {
      return res.status(403).json({ error: "You can only add records for your own assigned class." });
    }
    const record = {
      id: uuidv4(),
      ...req.body,
      createdAt: new Date().toISOString(),
      createdBy: req.user.id,
    };
    await db.insert(collection, record);
    res.status(201).json(record);
  }));

  // ---- UPDATE ----
  router.patch('/:id', requireAuth, requireRole(...permissions.update), safe(async (req, res) => {
    const existing = await db.findById(collection, req.params.id);
    if (!existing) return res.status(404).json({ error: `${collection} record not found.` });

    const candidate = { ...existing, ...req.body };
    const mayWrite = await teacherMayWrite(candidate, req.user);
    if (!mayWrite) {
      return res.status(403).json({ error: "You can only modify records for your own assigned class." });
    }

    const updated = await db.update(collection, req.params.id, {
      ...req.body,
      updatedAt: new Date().toISOString(),
      updatedBy: req.user.id,
    });
    res.json(updated);
  }));

  // ---- DELETE ----
  router.delete('/:id', requireAuth, requireRole(...permissions.delete), safe(async (req, res) => {
    const existing = await db.findById(collection, req.params.id);
    if (!existing) return res.status(404).json({ error: `${collection} record not found.` });

    const mayWrite = await teacherMayWrite(existing, req.user);
    if (!mayWrite) {
      return res.status(403).json({ error: "You can only delete records for your own assigned class." });
    }

    const removed = await db.remove(collection, req.params.id);
    if (!removed) return res.status(404).json({ error: `${collection} record not found.` });
    res.status(204).end();
  }));

  return router;
}

module.exports = createCrudRouter;
