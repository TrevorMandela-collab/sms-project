const createCrudRouter = require('../utils/crudRouterFactory');

// Each event: { id, name, date, description }
// These are school-wide calendar events (exams, meetings, sports day),
// distinct from the per-class `timetable` collection.
module.exports = createCrudRouter('events', {
  permissions: {
    create: ['admin', 'teacher'],
    read: ['admin', 'teacher', 'parent'],
    update: ['admin', 'teacher'],
    delete: ['admin', 'teacher'],
  },
  seed: [],
});
