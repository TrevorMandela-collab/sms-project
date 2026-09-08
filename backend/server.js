require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const authRoutes = require('./routes/auth');
const studentsRoutes = require('./routes/students');
const teachersRoutes = require('./routes/teachers');
const subjectsRoutes = require('./routes/subjects');
const classesRoutes = require('./routes/classes');
const assignmentsRoutes = require('./routes/assignments');
const assignmentSubmissionsRoutes = require('./routes/assignment-submissions');
const announcementsRoutes = require('./routes/announcements');
const attendanceRoutes = require('./routes/attendance');
const feesRoutes = require('./routes/fees');
const examsRoutes = require('./routes/exams');
const timetableRoutes = require('./routes/timetable');
const libraryRoutes = require('./routes/library');
const libraryLoansRoutes = require('./routes/library-loans');
const eventsRoutes = require('./routes/events');
const inviteCodesRoutes = require('./routes/invite-codes');
const chatsRoutes = require('./routes/chats');
const db = require('./utils/db');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.use('/api/auth', authRoutes);
app.use('/api/students', studentsRoutes);
app.use('/api/teachers', teachersRoutes);
app.use('/api/subjects', subjectsRoutes);
app.use('/api/classes', classesRoutes);
app.use('/api/assignments', assignmentsRoutes);
app.use('/api/assignment-submissions', assignmentSubmissionsRoutes);
app.use('/api/announcements', announcementsRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/fees', feesRoutes);
app.use('/api/exams', examsRoutes);
app.use('/api/timetable', timetableRoutes);
app.use('/api/library', libraryRoutes);
app.use('/api/library-loans', libraryLoansRoutes);
app.use('/api/events', eventsRoutes);
app.use('/api/invite-codes', inviteCodesRoutes);
app.use('/api/chats', chatsRoutes);

// 404 fallback for unmatched API routes
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// Generic error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

app.listen(PORT, () => {
  console.log(`SMS backend running on http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});

// Confirm the database is actually reachable at startup — this is the
// single most common thing to break when deploying (missing/incorrect
// DATABASE_URL), so fail loudly rather than silently 500ing on the
// first real request.
db.ensureSchema()
  .then(() => console.log('[db] Connected and schema ready.'))
  .catch(err => {
    console.error('[db] FAILED to connect/initialize database:', err.message);
    console.error('[db] Check that DATABASE_URL is set to a valid Postgres connection string.');
  });
