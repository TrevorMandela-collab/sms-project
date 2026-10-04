const createCrudRouter = require('../utils/crudRouterFactory');
const { getTeacherStudentIds } = require('../utils/teacherScope');
const db = require('../utils/db');

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
  scopeForTeacher: async (records, user) => {
    const ids = await getTeacherStudentIds(user);
    return records.filter(r => ids.has(r.studentId));
  },
  writeGuardForTeacher: async (record, user) => {
    const ids = await getTeacherStudentIds(user);
    return ids.has(record.studentId);
  },
  validate: async (submission, { user }) => {
    const student = submission.studentId
      ? await db.findById('students', submission.studentId)
      : null;
    const assignment = submission.assignmentId
      ? await db.findById('assignments', submission.assignmentId)
      : null;
    if (
      !student ||
      student.schoolId !== user.schoolId ||
      !assignment ||
      assignment.schoolId !== user.schoolId
    ) {
      const error = new Error('Student or assignment not found in your school.');
      error.statusCode = 404;
      error.code = 'SUBMISSION_REFERENCE_NOT_FOUND';
      throw error;
    }
  },
  seed: [],
});
