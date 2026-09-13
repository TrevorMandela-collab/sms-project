const createCrudRouter = require('../utils/crudRouterFactory');

// Each library item: { id, title, author, isbn, copiesTotal, copiesAvailable, category }
module.exports = createCrudRouter('library', {
  permissions: {
    create: ['admin'],
    read: ['admin', 'parent'],
    update: ['admin'],
    delete: ['admin'],
  },
  seed: [],
});
