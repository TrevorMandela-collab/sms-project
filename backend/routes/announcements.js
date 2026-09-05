const createCrudRouter = require('../utils/crudRouterFactory');

module.exports = createCrudRouter('announcements', {
  permissions: {
    create: ['admin', 'teacher'],
    read: ['admin', 'teacher', 'parent'],
    update: ['admin', 'teacher'],
    delete: ['admin', 'teacher'],
  },
  seed: [],
});
