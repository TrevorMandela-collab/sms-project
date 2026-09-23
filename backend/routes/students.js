const createCrudRouter = require('../utils/crudRouterFactory');

module.exports = createCrudRouter('students', {
  permissions: {
    create: ['admin'],
    read: ['admin', 'teacher', 'parent', 'student'],
    update: ['admin', 'teacher'],
    delete: ['admin'],
  },
  // Parents only see students whose id is in their own childIds list
  scopeForParent: (records, user) => records.filter(s => (user.childIds || []).includes(s.id)),
  // A student only ever sees their own record
  scopeForStudent: (records, user) => records.filter(s => s.id === user.studentId),
    searchFields: ['name', 'class', 'guardianContact'],
    filterFields: ['class', 'status', 'gender'],
    sortFields: ['name', 'class', 'createdAt'],
    validate: async (student, { operation }) => {
      if (!student.name?.trim()) {
        const error = new Error('Student name is required.');
        error.statusCode = 400;
        error.code = 'STUDENT_NAME_REQUIRED';
        throw error;
      }
      if (student.dateOfBirth && Number.isNaN(Date.parse(student.dateOfBirth))) {
        const error = new Error('Enter a valid date of birth.');
        error.statusCode = 400;
        error.code = 'INVALID_DATE_OF_BIRTH';
        throw error;
      }
    },
  seed: [],
});
