const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const { requireAuth, requireRole } = require('../middleware/auth');

/**
 * Builds a full CRUD router for a collection.
 *
 * @param {string} collection - name of the JSON collection (e.g. 'students')
 * @param {object} options
 *   permissions: { create: [roles], read: [roles], update: [roles], delete: [roles] }
 *   scopeForParent: (records, user) => filteredRecords
 *     If provided, parent-role GET requests are filtered through this
 *     function so parents only ever see their own children's records.
 *   seed: array of default records if the collection file doesn't exist yet
 */
function createCrudRouter(collection, options = {}) {
  const router = express.Router();

  const permissions = {
    create: options.permissions?.create || ['admin'],
    read: options.permissions?.read || ['admin', 'teacher', 'parent'],
    update: options.permissions?.update || ['admin'],
    delete: options.permissions?.delete || ['admin'],
  };

  if (options.seed) db.ensureFile(collection, options.seed);

  // ---- LIST ----
  router.get('/', requireAuth, requireRole(...permissions.read), (req, res) => {
    let records = db.readAll(collection);
    if (req.user.role === 'parent' && options.scopeForParent) {
      records = options.scopeForParent(records, req.user);
    }
    res.json(records);
  });

  // ---- GET ONE ----
  router.get('/:id', requireAuth, requireRole(...permissions.read), (req, res) => {
    const record = db.findById(collection, req.params.id);
    if (!record) return res.status(404).json({ error: `${collection} record not found.` });

    if (req.user.role === 'parent' && options.scopeForParent) {
      const allowed = options.scopeForParent([record], req.user);
      if (!allowed.length) return res.status(403).json({ error: 'Not authorized to view this record.' });
    }
    res.json(record);
  });

  // ---- CREATE ----
  router.post('/', requireAuth, requireRole(...permissions.create), (req, res) => {
    const record = {
      id: uuidv4(),
      ...req.body,
      createdAt: new Date().toISOString(),
      createdBy: req.user.id,
    };
    db.insert(collection, record);
    res.status(201).json(record);
  });

  // ---- UPDATE ----
  router.patch('/:id', requireAuth, requireRole(...permissions.update), (req, res) => {
    const updated = db.update(collection, req.params.id, {
      ...req.body,
      updatedAt: new Date().toISOString(),
      updatedBy: req.user.id,
    });
    if (!updated) return res.status(404).json({ error: `${collection} record not found.` });
    res.json(updated);
  });

  // ---- DELETE ----
  router.delete('/:id', requireAuth, requireRole(...permissions.delete), (req, res) => {
    const removed = db.remove(collection, req.params.id);
    if (!removed) return res.status(404).json({ error: `${collection} record not found.` });
    res.status(204).end();
  });

  return router;
}

module.exports = createCrudRouter;
