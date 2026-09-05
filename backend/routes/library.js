const createCrudRouter = require('../utils/crudRouterFactory');

// Each library item: { id, title, author, isbn, copiesTotal, copiesAvailable, category }
module.exports = createCrudRouter('library', {
  permissions: {
    create: ['admin', 'teacher'],
    read: ['admin', 'teacher', 'parent'],
    update: ['admin', 'teacher'],
    delete: ['admin'],
  },
  seed: [],
});
