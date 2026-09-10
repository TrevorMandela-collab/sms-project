const createCrudRouter = require('../utils/crudRouterFactory');

module.exports = createCrudRouter('classes', {
  // Each class: { id, name, subjectIds, teacherIds }
  // teacherIds is a list — admin can assign as many teachers to a class as needed.
  permissions: {
    create: ['admin'],
    read: ['admin', 'teacher', 'parent', 'student'],
    update: ['admin'],
    delete: ['admin'],
  },
  seed: [],
});
