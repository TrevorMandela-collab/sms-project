# SMS Backend

Express API for the School Management System. Handles auth (JWT + roles) and
CRUD for every module: students, teachers, announcements, attendance, fees,
exams, timetable, and library.

## Setup

```bash
cd sms-backend
npm install
cp .env.example .env      # then edit JWT_SECRET and optionally DATABASE_URL
npm start                 # or: npm run dev (auto-restarts on file changes)
```

For production, use a Postgres database — pick one:

- **Render**: New → PostgreSQL (free tier available). Copy the "Internal
  Database URL" if your backend is also on Render, or "External Database
  URL" otherwise.
- **Neon** (neon.tech) or **Supabase** (supabase.com) — both have a
  permanently free tier and give you a connection string on signup.

Paste that connection string into `DATABASE_URL` in `.env` (locally) and
into your Render service's environment variables (in production — `.env`
is never read there, only local `.env` files are).

Without `DATABASE_URL`, local development automatically uses SQLite at
`backend/data/sms.sqlite`. You can override that location with `SQLITE_PATH`.

Server runs on `http://localhost:4000` by default. Health check:
`GET /api/health`. Watch the startup logs for `[db] Connected and schema
ready.` — if you instead see `[db] FAILED to connect`, `DATABASE_URL` is
missing or wrong.

## Data storage

Records live in a single `store` table, one row per record, keyed by
`(collection, id)` with the record itself stored as JSON. Postgres is used
when `DATABASE_URL` is set; SQLite is used otherwise. Every route file calls
the same five async functions (`readAll`, `findById`, `insert`, `update`,
`remove`), so the storage engine can change without route changes.

## Roles

Four roles: `admin`, `teacher`, `parent`, `student`.

- **The very first account you register becomes the admin automatically**
  (bootstrap). After that, `POST /api/auth/register` requires an admin's
  token — only admins can create new accounts.
- **admin** — full access everywhere.
- **teacher** — can create/edit attendance, exams, and announcements; can
  read (but not delete) most things; cannot delete students or manage fees.
- **parent** — read-only, and automatically scoped to their own children.
  A parent's account has a `childIds` array (student IDs); attendance, fees,
  exams, assignments, and timetable endpoints filter results so a parent
  only ever sees their own kids' records — even if they call the API
  directly. (Assignments/timetable are scoped by matching each child's
  `class` against the assignment's/timetable entry's class.)
- **student** — read-only, and automatically scoped to their own record.
  A student's account has a `studentId` (the linked `students` record);
  the same collections as above are filtered to that one student. Students
  don't self-register with a password up front — see the invite-code flow
  below.

## Auth flow

```
POST /api/auth/register            { name, email, password, role, childIds? }  (admin/teacher/parent — admin-only after bootstrap)
POST /api/auth/register-with-code  { code, name, email, password }             (student — public, redeems an invite code)
POST /api/auth/login               { email, password }  -> { user, token }
GET  /api/auth/me                  (requires Bearer token)
```

Every other route requires `Authorization: Bearer <token>`.

## Student invite codes

Students don't get an admin/teacher-created account like other roles —
instead an admin generates a single-use invite code tied to a specific
`students` record, and the student redeems it themselves:

```
POST   /api/invite-codes             { studentId, expiresInDays? }   (admin only) -> { code, expiresAt, ... }
GET    /api/invite-codes?studentId=  (admin only) -> list codes, e.g. to check for an outstanding one
DELETE /api/invite-codes/:id         (admin only) -> revoke an unused code
```

The student then calls `POST /api/auth/register-with-code` with that code
plus their own name/email/password. On success the code is marked used and
a `student`-role account is created and linked to that `studentId`.

## Endpoints

All of these follow the same shape:

```
GET    /api/<collection>       list (role-gated, parent-scoped where relevant)
GET    /api/<collection>/:id   single record
POST   /api/<collection>       create
PATCH  /api/<collection>/:id   update
DELETE /api/<collection>/:id   delete
```

Collections: `students`, `teachers`, `subjects`, `classes`, `assignments`,
`assignment-submissions`, `announcements`, `attendance`, `fees`, `exams`,
`timetable`, `library`, `library-loans`, `events`.

`invite-codes` is managed separately under `/api/invite-codes` (see above)
rather than through the generic CRUD shape, since generating a code has
its own logic (random code, expiry, single-use).

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
