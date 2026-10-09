require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const config = require('./config');

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
const schoolsRoutes = require('./routes/schools');
const auditLogsRoutes = require('./routes/audit-logs');
const db = require('./utils/db');
const { initRealtime } = require('./utils/realtime');

const app = express();
const PORT = process.env.PORT || 4000;

if (config.trustProxyHops) app.set('trust proxy', config.trustProxyHops);

app.use(
  cors({
    origin(origin, callback) {
      callback(null, !origin || config.allowedOrigins.has(origin));
    },
  }),
);
app.use(express.json({ limit: '1mb' }));
app.use(morgan(config.isProduction ? 'combined' : 'dev'));

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
app.use('/api/schools', schoolsRoutes);
app.use('/api/audit-logs', auditLogsRoutes);

// 404 fallback for unmatched API routes
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// Generic error handler
app.use((err, req, res, next) => {
  console.error("[api] request failed:", {
    name: err?.name || "Error",
    code: err?.code || "UNHANDLED_ERROR",
  });
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong on the server.',
    },
  });
});

// Use an explicit http server (rather than app.listen directly) so the
// WebSocket server can share the same port.
const server = http.createServer(app);
const closeRealtime = initRealtime(server);

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] ${signal} received; closing HTTP and database connections.`);
  closeRealtime();
  server.close(async (error) => {
    if (error) {
      console.error("[server] HTTP shutdown failed:", error.code || error.name);
    }
    try {
      await db.close();
    } catch (closeError) {
      console.error("[db] shutdown failed:", closeError.code || closeError.name);
      process.exitCode = 1;
    }
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

db.migrate()
  .then(() => {
    console.log('[db] Connected and schema ready.');
    server.listen(PORT, () => {
      console.log(`SMS backend running on http://localhost:${PORT}`);
      console.log(`Health check: http://localhost:${PORT}/api/health`);
      console.log(`WebSocket endpoint: ws://localhost:${PORT}/ws`);
    });
  })
  .catch(async (error) => {
    console.error(
      "[db] FAILED to initialize database:",
      error.code || error.name || "unknown database error",
    );
    try {
      await db.close();
    } catch (closeError) {
      console.error("[db] shutdown after initialization failure:", closeError.code || closeError.name);
    }
    process.exitCode = 1;
  });
