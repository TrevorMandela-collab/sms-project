const createCrudRouter = require('../utils/crudRouterFactory');

// Each timetable entry: { id, className, day, period, subject, teacherId, startTime, endTime }
module.exports = createCrudRouter('timetable', {
  permissions: {
    create: ['admin'],
    read: ['admin', 'teacher', 'parent'],
    update: ['admin'],
    delete: ['admin'],
  },
  seed: [],
});
