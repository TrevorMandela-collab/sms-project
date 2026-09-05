const createCrudRouter = require('../utils/crudRouterFactory');

// Each attendance record: { id, studentId, className, date, status, markedBy }
module.exports = createCrudRouter('attendance', {
  permissions: {
    create: ['admin', 'teacher'],
    read: ['admin', 'teacher', 'parent'],
    update: ['admin', 'teacher'],
    delete: ['admin', 'teacher'],
  },
  scopeForParent: (records, user) => records.filter(r => (user.childIds || []).includes(r.studentId)),
  seed: [],
});
