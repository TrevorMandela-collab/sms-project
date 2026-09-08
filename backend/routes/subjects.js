const createCrudRouter = require('../utils/crudRouterFactory');

module.exports = createCrudRouter('subjects', {
  permissions: {
    create: ['admin'],
    read: ['admin', 'teacher', 'parent', 'student'],
    update: ['admin'],
    delete: ['admin'],
  },
  seed: [],
});
