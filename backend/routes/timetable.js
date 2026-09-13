const createCrudRouter = require('../utils/crudRouterFactory');
const db = require('../utils/db');
const { getTeacherClassNames } = require('../utils/teacherScope');

// Each timetable entry: { id, className, day, period, subject, teacherId, startTime, endTime }
// Timetable entries carry className directly (a free-text match to
// student.class), so scoping is a simpler one-hop lookup than assignments.

async function classNamesForStudentIds(studentIds) {
  const students = await db.readAll('students');
  return new Set(
    students.filter(s => studentIds.includes(s.id)).map(s => s.class).filter(Boolean)
  );
}

async function scopeByStudentIds(records, studentIds) {
  const classNames = await classNamesForStudentIds(studentIds);
  return records.filter(t => classNames.has(t.className));
}

module.exports = createCrudRouter('timetable', {
  permissions: {
    create: ['admin'],
    read: ['admin', 'teacher', 'parent', 'student'],
    update: ['admin'],
    delete: ['admin'],
  },
  scopeForParent: (records, user) => scopeByStudentIds(records, user.childIds || []),
  scopeForStudent: (records, user) => scopeByStudentIds(records, user.studentId ? [user.studentId] : []),
  scopeForTeacher: async (records, user) => {
    const classNames = await getTeacherClassNames(user);
    return records.filter(t => classNames.has(t.className) || t.teacherId === user.teacherId);
  },
  seed: [],
});
