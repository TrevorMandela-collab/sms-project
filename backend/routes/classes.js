const createCrudRouter = require('../utils/crudRouterFactory');

module.exports = createCrudRouter('classes', {
  permissions: {
    create: ['admin'],
    read: ['admin', 'teacher', 'parent', 'student'],
    update: ['admin'],
    delete: ['admin'],
  },
  seed: [],
});
