const createCrudRouter = require('../utils/crudRouterFactory');

// Each fee record: { id, studentId, studentName, class, amount, due, status }
module.exports = createCrudRouter('fees', {
  permissions: {
    create: ['admin'],
    read: ['admin', 'teacher', 'parent'],
    update: ['admin'],
    delete: ['admin'],
  },
  scopeForParent: (records, user) => records.filter(r => (user.childIds || []).includes(r.studentId)),
  seed: [],
});
