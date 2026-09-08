const createCrudRouter = require('../utils/crudRouterFactory');

// Each exam/grade record: { id, studentId, subject, examName, score, maxScore, term, grade }
module.exports = createCrudRouter('exams', {
  permissions: {
    create: ['admin', 'teacher'],
    read: ['admin', 'teacher', 'parent', 'student'],
    update: ['admin', 'teacher'],
    delete: ['admin', 'teacher'],
  },
  scopeForParent: (records, user) => records.filter(r => (user.childIds || []).includes(r.studentId)),
  scopeForStudent: (records, user) => records.filter(r => r.studentId === user.studentId),
  seed: [],
});
