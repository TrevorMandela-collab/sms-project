const createCrudRouter = require('../utils/crudRouterFactory');

module.exports = createCrudRouter('teachers', {
  permissions: {
    create: ['admin'],
    read: ['admin', 'teacher', 'parent'],
    update: ['admin'],
    delete: ['admin'],
  },
  seed: [],
});
