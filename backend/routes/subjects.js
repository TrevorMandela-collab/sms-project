const createCrudRouter = require('../utils/crudRouterFactory');

module.exports = createCrudRouter('subjects', {
  requiredFields: ['name'],
  permissions: {
    create: ['admin'],
    read: ['admin', 'teacher', 'parent', 'student'],
    update: ['admin'],
    delete: ['admin'],
  },
  seed: [],
});
