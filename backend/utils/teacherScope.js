const db = require('./db');

/**
 * Resolves which class *names* a teacher is assigned to, via
 * classes.teacherIds (set by an admin on the Classes & Subjects page).
 * Returns an empty set if the account has no linked teacherId yet, or
 * isn't assigned to any class.
 */
async function getTeacherClassNames(user) {
  if (!user.teacherId) return new Set();
  const classes = await db.readAll('classes');
  return new Set(
    classes.filter(c => (c.teacherIds || []).includes(user.teacherId)).map(c => c.name)
  );
}

/** Same idea, but resolves to class *ids* instead of names. */
async function getTeacherClassIds(user) {
  if (!user.teacherId) return new Set();
  const classes = await db.readAll('classes');
  return new Set(
    classes.filter(c => (c.teacherIds || []).includes(user.teacherId)).map(c => c.id)
  );
}

/** Resolves which student ids fall under a teacher's assigned classes. */
async function getTeacherStudentIds(user) {
  const classNames = await getTeacherClassNames(user);
  if (!classNames.size) return new Set();
  const students = await db.readAll('students');
  return new Set(students.filter(s => classNames.has(s.class)).map(s => s.id));
}

module.exports = { getTeacherClassNames, getTeacherClassIds, getTeacherStudentIds };
