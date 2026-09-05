const createCrudRouter = require('../utils/crudRouterFactory');

// Each loan: { id, itemId, itemTitle, studentId, studentName, borrowedDate, dueDate, returnedDate }
module.exports = createCrudRouter('library-loans', {
  permissions: {
    create: ['admin', 'teacher'],
    read: ['admin', 'teacher', 'parent'],
    update: ['admin', 'teacher'],
    delete: ['admin', 'teacher'],
  },
  scopeForParent: (records, user) => records.filter(r => (user.childIds || []).includes(r.studentId)),
  seed: [],
});
