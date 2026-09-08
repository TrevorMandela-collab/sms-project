const createCrudRouter = require('../utils/crudRouterFactory');
const db = require('../utils/db');

// Each assignment: { id, title, description, dueDate, classId, subjectId, maxScore, createdBy }
// Assignments don't carry a studentId directly — they belong to a class.
// A student "belongs" to a class if student.class matches the class's name
// (see the assignments frontend module). We resolve that link here so
// parents/students only see assignments for the classes their child(ren) —
// or they themselves — are actually in.

async function classNamesForStudentIds(studentIds) {
  const students = await db.readAll('students');
  return new Set(
    students.filter(s => studentIds.includes(s.id)).map(s => s.class).filter(Boolean)
  );
}

async function classIdsForClassNames(classNames) {
  const classes = await db.readAll('classes');
  return new Set(classes.filter(c => classNames.has(c.name)).map(c => c.id));
}

async function scopeByStudentIds(records, studentIds) {
  const classNames = await classNamesForStudentIds(studentIds);
  const classIds = await classIdsForClassNames(classNames);
  return records.filter(a => classIds.has(a.classId));
}

module.exports = createCrudRouter('assignments', {
  permissions: {
    create: ['admin', 'teacher'],
    read: ['admin', 'teacher', 'parent', 'student'],
    update: ['admin', 'teacher'],
    delete: ['admin', 'teacher'],
  },
  scopeForParent: (records, user) => scopeByStudentIds(records, user.childIds || []),
  scopeForStudent: (records, user) => scopeByStudentIds(records, user.studentId ? [user.studentId] : []),
  seed: [],
});
