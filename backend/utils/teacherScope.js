const db = require('./db');

/**
 * Resolves which class *names* a teacher is assigned to, via
 * classes.teacherIds (set by an admin on the Classes & Subjects page).
 * Returns an empty set if the account has no linked teacherId yet, or
 * isn't assigned to any class.
 */
async function getTeacherClassNames(user) {
  if (!user.teacherId || !user.schoolId) return new Set();
  const classes = await db.readBySchool('classes', user.schoolId);
  return new Set(
    classes
      .filter(c => (c.teacherIds || []).includes(user.teacherId))
      .map(c => c.name)
  );
}

/** Same idea, but resolves to class *ids* instead of names. */
async function getTeacherClassIds(user) {
  if (!user.teacherId || !user.schoolId) return new Set();
  const classes = await db.readBySchool('classes', user.schoolId);
  return new Set(
    classes
      .filter(c => (c.teacherIds || []).includes(user.teacherId))
      .map(c => c.id)
  );
}

/** Resolves which student ids fall under a teacher's assigned classes. */
async function getTeacherStudentIds(user) {
  const classIds = await getTeacherClassIds(user);
  if (!classIds.size) return new Set();
  const classes = await db.readBySchool('classes', user.schoolId);
  const legacyClassNames = new Set(
    classes
      .filter(classRecord => classIds.has(classRecord.id))
      .map(classRecord => classRecord.name)
  );
  const students = await db.readBySchool('students', user.schoolId);
  return new Set(
    students
      .filter(student =>
        (student.classId
          ? classIds.has(student.classId)
          : legacyClassNames.has(student.class))
      )
      .map(s => s.id)
  );
}

module.exports = { getTeacherClassNames, getTeacherClassIds, getTeacherStudentIds };
