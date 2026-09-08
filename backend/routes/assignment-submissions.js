const createCrudRouter = require('../utils/crudRouterFactory');

// Each submission record: { id, assignmentId, studentId, submitted, submittedAt, score, feedback }
// One record per (assignment, student) pair. Scoped to a parent's own
// children the same way attendance and exams are.
module.exports = createCrudRouter('assignment-submissions', {
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
