const createCrudRouter = require('../utils/crudRouterFactory');
const db = require('../utils/db');
const { getTeacherClassIds } = require('../utils/teacherScope');

// Each assignment: { id, title, description, dueDate, classId, subjectId, maxScore, createdBy }
// Assignments don't carry a studentId directly — they belong to a class.
// A student "belongs" to a class if student.class matches the class's name
// (see the assignments frontend module). We resolve that link here so
// parents/students only see assignments for the classes their child(ren) —
// or they themselves — are actually in.

async function classIdsForStudentIds(studentIds, schoolId) {
  const students = await db.readAll('students');
  const linkedStudents = students.filter(
    student => studentIds.includes(student.id) && student.schoolId === schoolId
  );
  const classes = await db.readAll('classes');
  const classIds = new Set(linkedStudents.map(student => student.classId).filter(Boolean));
  const legacyClassNames = new Set(
    linkedStudents.filter(student => !student.classId).map(student => student.class).filter(Boolean)
  );
  return new Set(
    classes
      .filter(classRecord =>
        classRecord.schoolId === schoolId &&
        (classIds.has(classRecord.id) || legacyClassNames.has(classRecord.name))
      )
      .map(classRecord => classRecord.id)
  );
}

async function scopeByStudentIds(records, studentIds, schoolId) {
  const classIds = await classIdsForStudentIds(studentIds, schoolId);
  return records.filter(a => classIds.has(a.classId));
}

module.exports = createCrudRouter('assignments', {
  permissions: {
    create: ['admin', 'teacher'],
    read: ['admin', 'teacher', 'parent', 'student'],
    update: ['admin', 'teacher'],
    delete: ['admin', 'teacher'],
  },
  scopeForParent: (records, user) => scopeByStudentIds(records, user.childIds || [], user.schoolId),
  scopeForStudent: (records, user) => scopeByStudentIds(records, user.studentId ? [user.studentId] : [], user.schoolId),
  scopeForTeacher: async (records, user) => {
    const classIds = await getTeacherClassIds(user);
    return records.filter(a => classIds.has(a.classId));
  },
  writeGuardForTeacher: async (record, user) => {
    const classIds = await getTeacherClassIds(user);
    return classIds.has(record.classId);
  },
  validate: async (assignment, { user }) => {
    const classes = await db.readAll('classes');
    const schoolClasses = classes.filter(
      schoolClass => schoolClass.schoolId === user.schoolId
    );
    if (!assignment.classId || !schoolClasses.some(schoolClass => schoolClass.id === assignment.classId)) {
      const error = new Error('Class not found in your school.');
      error.statusCode = 404;
      error.code = 'CLASS_NOT_FOUND';
      throw error;
    }
    if (assignment.subjectId) {
      const subject = await db.findById('subjects', assignment.subjectId);
      if (!subject || subject.schoolId !== user.schoolId) {
        const error = new Error('Subject not found in your school.');
        error.statusCode = 404;
        error.code = 'SUBJECT_NOT_FOUND';
        throw error;
      }
    }
  },
  seed: [],
});
