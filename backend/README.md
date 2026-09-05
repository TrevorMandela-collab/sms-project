# SMS Backend

Express API for the School Management System. Handles auth (JWT + roles) and
CRUD for every module: students, teachers, announcements, attendance, fees,
exams, timetable, and library.

## Setup

```bash
cd sms-backend
npm install
cp .env.example .env      # then edit JWT_SECRET to something random
npm start                 # or: npm run dev (auto-restarts on file changes)
```

Server runs on `http://localhost:4000` by default. Health check:
`GET /api/health`.

## Data storage

Records live as JSON files under `/data` (one file per collection, created
automatically on first write). No database setup needed to get started.
When you're ready for a real database, swap `utils/db.js` for a Postgres/
MySQL version — every route file calls the same five functions
(`readAll`, `findById`, `insert`, `update`, `remove`), so nothing else needs
to change.

## Roles

Three roles: `admin`, `teacher`, `parent`.

- **The very first account you register becomes the admin automatically**
  (bootstrap). After that, `POST /api/auth/register` requires an admin's
  token — only admins can create new accounts.
- **admin** — full access everywhere.
- **teacher** — can create/edit attendance, exams, and announcements; can
  read (but not delete) most things; cannot delete students or manage fees.
- **parent** — read-only, and automatically scoped to their own children.
  A parent's account has a `childIds` array (student IDs); attendance,
  fees, and exam endpoints filter results so a parent only ever sees their
  own kids' records — even if they call the API directly.

## Auth flow

```
POST /api/auth/register   { name, email, password, role, childIds? }
POST /api/auth/login      { email, password }  -> { user, token }
GET  /api/auth/me         (requires Bearer token)
```

Every other route requires `Authorization: Bearer <token>`.

## Endpoints

All of these follow the same shape:

```
GET    /api/<collection>       list (role-gated, parent-scoped where relevant)
GET    /api/<collection>/:id   single record
POST   /api/<collection>       create
PATCH  /api/<collection>/:id   update
DELETE /api/<collection>/:id   delete
```

Collections: `students`, `teachers`, `announcements`, `attendance`, `fees`,
`exams`, `timetable`, `library`, `library-loans`, `events`.

### Record shapes (suggested — the API doesn't enforce a schema)

- **students**: `{ name, class, dateOfBirth, guardianContact }`
- **teachers**: `{ name, subjects: [string], contact }`
- **announcements**: `{ title, body, tag, audience }`
- **events**: `{ name, date }` — school-wide calendar events (exams, meetings, sports day). Distinct from `timetable`, which is per-class daily periods.
- **attendance**: `{ studentId, className, date, status }`
- **fees**: `{ studentId, studentName, class, amount, due, status }`
- **exams**: `{ studentId, subject, examName, score, maxScore, term }`
- **timetable**: `{ className, day, period, subject, teacherId, startTime, endTime }`
- **library**: `{ title, author, isbn, copiesTotal, copiesAvailable, category }`
- **library-loans**: `{ itemId, itemTitle, studentId, studentName, borrowedDate, dueDate, returnedDate }`

## Example: getting started end to end

```bash
# 1. Register the first admin
curl -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Admin","email":"admin@school.test","password":"secret123","role":"admin"}'

# copy the "token" from the response, then:

# 2. Create a student
curl -X POST http://localhost:4000/api/students \
  -H "Content-Type: application/json" -H "Authorization: Bearer <TOKEN>" \
  -d '{"name":"Amina Otieno","class":"Grade 7B"}'
```

## What's next

This backend is ready for the frontend modules to call instead of
`localStorage`. Each frontend module's `readStore()`/`writeStore()` helper
functions can be swapped for `fetch()` calls to these endpoints, sending the
JWT in the `Authorization` header.
