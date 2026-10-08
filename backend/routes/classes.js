const createCrudRouter = require('../utils/crudRouterFactory');
const db = require('../utils/db');

module.exports = createCrudRouter('classes', {
  requiredFields: ['name'],
  // Each class: { id, name, subjectIds, teacherIds }
  // teacherIds is a list — admin can assign as many teachers to a class as needed.
  permissions: {
    create: ['admin'],
    read: ['admin', 'teacher', 'parent', 'student'],
    update: ['admin'],
    delete: ['admin'],
  },
  validate: async (record, { user }) => {
    for (const field of ['teacherIds', 'subjectIds']) {
      if (record[field] !== undefined && !Array.isArray(record[field])) {
        const error = new Error(`${field} must be an array.`);
        error.statusCode = 400;
        error.code = 'INVALID_CLASS_RELATIONSHIPS';
        throw error;
      }
    }
    for (const teacherId of new Set(Array.isArray(record.teacherIds) ? record.teacherIds : [])) {
      const teacher = await db.findById('teachers', teacherId);
      if (!teacher || teacher.schoolId !== user.schoolId) {
        const error = new Error('Teacher not found in your school.');
        error.statusCode = 404;
        error.code = 'TEACHER_NOT_FOUND';
        throw error;
      }
    }
    for (const subjectId of new Set(Array.isArray(record.subjectIds) ? record.subjectIds : [])) {
      const subject = await db.findById('subjects', subjectId);
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
