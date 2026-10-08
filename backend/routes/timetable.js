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
  requiredFields: ['className', 'day', 'subject', 'startTime', 'endTime'],
  permissions: {
    create: ['admin'],
    read: ['admin', 'teacher', 'parent', 'student'],
    update: ['admin'],
    delete: ['admin'],
  },
  validate: async (entry, { user }) => {
    const weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
    const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;
    if (!weekdays.includes(String(entry.day).toLowerCase())) {
      const error = new Error('Choose a valid school day.');
      error.statusCode = 400;
      error.code = 'INVALID_TIMETABLE_DAY';
      throw error;
    }
    if (!timePattern.test(entry.startTime) || !timePattern.test(entry.endTime)) {
      const error = new Error('Enter valid start and end times.');
      error.statusCode = 400;
      error.code = 'INVALID_TIMETABLE_TIME';
      throw error;
    }
    const seconds = (time) => time.split(':').reduce(
      (total, part) => total * 60 + Number(part),
      0,
    );
    if (seconds(entry.startTime) >= seconds(entry.endTime)) {
      const error = new Error('The end time must be after the start time.');
      error.statusCode = 400;
      error.code = 'INVALID_TIMETABLE_TIME_RANGE';
      throw error;
    }
    if (entry.teacherId) {
      const teacher = await db.findById('teachers', entry.teacherId);
      if (!teacher || teacher.schoolId !== user.schoolId) {
        const error = new Error('Teacher not found in your school.');
        error.statusCode = 404;
        error.code = 'TEACHER_NOT_FOUND';
        throw error;
      }
    }
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
