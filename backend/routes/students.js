const createCrudRouter = require('../utils/crudRouterFactory');

module.exports = createCrudRouter('students', {
  permissions: {
    create: ['admin'],
    read: ['admin', 'teacher', 'parent'],
    update: ['admin', 'teacher'],
    delete: ['admin'],
  },
  // Parents only see students whose id is in their own childIds list
  scopeForParent: (records, user) => records.filter(s => (user.childIds || []).includes(s.id)),
  seed: [],
});
