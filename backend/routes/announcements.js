const createCrudRouter = require('../utils/crudRouterFactory');

module.exports = createCrudRouter('announcements', {
  requiredFields: ['title', 'body'],
  permissions: {
    create: ['admin'],
    read: ['admin', 'parent', 'student'],
    update: ['admin'],
    delete: ['admin'],
  },
  seed: [],
});
