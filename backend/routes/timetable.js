const createCrudRouter = require('../utils/crudRouterFactory');
const db = require('../utils/db');
const { getTeacherClassNames } = require('../utils/teacherScope');

// Each timetable entry: { id, className, day, period, subject, teacherId, startTime, endTime }
// Timetable entries carry className directly (a free-text match to
// student.class), so scoping is a simpler one-hop lookup than assignments.

async function classRecordsForStudentIds(studentIds, schoolId) {
  const students = await db.readAll('students');
  const linkedStudents = students.filter(
    student => studentIds.includes(student.id) && student.schoolId === schoolId
  );
  const classes = await db.readAll('classes');
  const classIds = new Set(linkedStudents.map(student => student.classId).filter(Boolean));
  const legacyClassNames = new Set(
    linkedStudents.filter(student => !student.classId).map(student => student.class).filter(Boolean)
  );
  return classes.filter(classRecord =>
    classRecord.schoolId === schoolId &&
    (classIds.has(classRecord.id) || legacyClassNames.has(classRecord.name))
  );
}

async function scopeByStudentIds(records, studentIds, schoolId) {
  const classRecords = await classRecordsForStudentIds(studentIds, schoolId);
  const classIds = new Set(classRecords.map(classRecord => classRecord.id));
  const legacyClassNames = new Set(
    classRecords.map(classRecord => classRecord.name)
  );
  return records.filter(t =>
    t.classId
      ? classIds.has(t.classId)
      : legacyClassNames.has(t.className)
  );
}

module.exports = createCrudRouter('timetable', {
  permissions: {
    create: ['admin'],
    read: ['admin', 'teacher', 'parent', 'student'],
    update: ['admin'],
    delete: ['admin'],
  },
  scopeForParent: (records, user) => scopeByStudentIds(records, user.childIds || [], user.schoolId),
  scopeForStudent: (records, user) => scopeByStudentIds(records, user.studentId ? [user.studentId] : [], user.schoolId),
  scopeForTeacher: async (records, user) => {
    const classNames = await getTeacherClassNames(user);
    const classIds = await getTeacherClassIds(user);
    return records.filter(t =>
      t.teacherId === user.teacherId ||
      (t.classId ? classIds.has(t.classId) : classNames.has(t.className))
    );
  },
  seed: [],
});
