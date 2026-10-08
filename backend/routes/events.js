const createCrudRouter = require('../utils/crudRouterFactory');

// Each event: { id, name, date, description }
// These are school-wide calendar events (exams, meetings, sports day),
// distinct from the per-class `timetable` collection.
module.exports = createCrudRouter('events', {
  requiredFields: ['name', 'date'],
  permissions: {
    create: ['admin', 'teacher'],
    read: ['admin', 'teacher', 'parent'],
    update: ['admin', 'teacher'],
    delete: ['admin', 'teacher'],
  },
  validate: async (event) => {
    if (Number.isNaN(Date.parse(event.date))) {
      const error = new Error('Enter a valid event date.');
      error.statusCode = 400;
      error.code = 'INVALID_EVENT_DATE';
      throw error;
    }
  },
  seed: [],
});
