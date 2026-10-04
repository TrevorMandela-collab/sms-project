const createCrudRouter = require('../utils/crudRouterFactory');
const db = require('../utils/db');

// Each loan: { id, itemId, itemTitle, studentId, studentName, borrowedDate, dueDate, returnedDate }
module.exports = createCrudRouter('library-loans', {
  permissions: {
    create: ['admin', 'teacher'],
    read: ['admin', 'teacher', 'parent'],
    update: ['admin', 'teacher'],
    delete: ['admin', 'teacher'],
  },
  scopeForParent: (records, user) => records.filter(r => (user.childIds || []).includes(r.studentId)),
  validate: async (loan, { user }) => {
    const student = loan.studentId
      ? await db.findById('students', loan.studentId)
      : null;
    const book = loan.itemId
      ? await db.findById('library', loan.itemId)
      : null;
    if (
      !student ||
      student.schoolId !== user.schoolId ||
      !book ||
      book.schoolId !== user.schoolId
    ) {
      const error = new Error('Book or student not found in your school.');
      error.statusCode = 404;
      error.code = 'LIBRARY_LOAN_REFERENCE_NOT_FOUND';
      throw error;
    }
  },
  seed: [],
});
