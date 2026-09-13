const createCrudRouter = require('../utils/crudRouterFactory');
const { getTeacherStudentIds } = require('../utils/teacherScope');

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
  scopeForTeacher: async (records, user) => {
    const ids = await getTeacherStudentIds(user);
    return records.filter(r => ids.has(r.studentId));
  },
  writeGuardForTeacher: async (record, user) => {
    const ids = await getTeacherStudentIds(user);
    return ids.has(record.studentId);
  },
  seed: [],
});
