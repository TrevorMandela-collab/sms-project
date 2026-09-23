const createCrudRouter = require('../utils/crudRouterFactory');

module.exports = createCrudRouter('teachers', {
  permissions: {
    create: ['admin'],
    read: ['admin', 'parent', 'student'],
    update: ['admin'],
    delete: ['admin'],
  },
    searchFields: ['name', 'contact'],
    sortFields: ['name', 'createdAt'],
  seed: [],
});
