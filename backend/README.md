# SMS Backend

Express API for the School Management System. Handles auth (JWT + roles) and
CRUD for every module: students, teachers, announcements, attendance, fees,
exams, timetable, and library.

## Setup

```bash
cd backend
npm install
cp .env.example .env      # set a unique JWT_SECRET before starting
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
PostgreSQL connections use a pool configured with `PG_POOL_MAX`,
`PG_IDLE_TIMEOUT_MS`, and `PG_CONNECTION_TIMEOUT_MS`. SQLite enforces foreign
keys and uses `SQLITE_BUSY_TIMEOUT_MS` to wait for a competing writer.
Both adapters expose `db.transaction(async () => { ... })`; nested calls use
savepoints, and related writes in the callback commit or roll back together.
The server closes its database pool/connection on `SIGINT` and `SIGTERM`.

Run the SQLite migration and API suite with `npm test`. PostgreSQL integration
tests can be run with `TEST_DATABASE_URL` set to a newly provisioned, dedicated
database whose name includes `test`, then `npm run test:postgres`. The test
runner refuses a database with existing migration or legacy data, and it
leaves the test schema in place; provision a fresh disposable database for
each run. Do not point test commands at development or production databases.

To seed an empty development database, set `DEMO_SEED_PASSWORD` to a unique
password of at least 12 characters, then run `npm run seed`. The command only
runs when `NODE_ENV=development`, refuses partial/conflicting seed data, and
can be safely run again after the complete demo set has been created.

Server runs on `http://localhost:4000` by default. Health check:
`GET /api/health`. Watch the startup logs for `[db] Connected and schema
ready.` — if you instead see `[db] FAILED to connect`, `DATABASE_URL` is
missing or wrong.

### Environment and production

`backend/.env.example` lists the supported variables. Production requires:

- `NODE_ENV=production`
- `DATABASE_URL` for PostgreSQL
- `JWT_SECRET` with at least 32 random characters
- `FRONTEND_URL` with one or more comma-separated HTTPS frontend origins
- `EMAIL_PROVIDER=smtp`, `EMAIL_FROM`, and SMTP host/user/password settings

The API refuses to start in production when these security-critical settings
are missing. Configure the backend as a Node service (for example, Render);
Netlify should host only the static frontend. The browser's API base URL is
configured by `frontend/shared/auth-client.js` and currently defaults to the
deployed API URL; local development can override it with
`localStorage.sms_api_base`. Set `TRUST_PROXY_HOPS` only when the API is behind
a known proxy, and use the actual deployment hop count so IP-based rate limits
do not trust client-supplied forwarding headers.

## Data storage

**Migration status:** the API reads and writes the normalized relational
tables. Versioned migrations run transactionally at server startup or with
`npm run db:migrate`. Migration `002` imports the legacy `store` records,
preserves IDs and unmodeled fields, creates relational links for legacy class
assignments, parent-child links, chat members, and library loans, and checks
the imported row counts. Invalid or orphaned data stops that migration and
leaves the source `store` intact. Do not remove `store`; it is retained as a
read-only recovery source and is not used by mapped API collections.
Migration `003` checks existing school-owned relationships and installs
database triggers that reject cross-school links on later inserts and updates.
If it finds an existing tenant mismatch, the migration fails without removing
records; correct or reconcile the reported relationship and rerun migrations.

SQLite and PostgreSQL use the same table definitions and data mapping.
`backend/migrations/001_relational_schema.js` contains the relational schema;
`002_import_legacy_store.js` is the versioned legacy import, and
`003_enforce_school_relationships.js` adds tenant-consistency enforcement.
Use the same migration command against development, test, and production
databases.
The data layer also exposes atomic `createInvoiceWithItems` and
`recordPaymentWithAllocations` operations. These are persistence primitives;
they do not add a payment API route or change the existing fees API.

### Backup, migration, and recovery

Back up the database before deploying a migration. Stop the API while taking a
SQLite file copy, or use SQLite's online backup API; for PostgreSQL use
`pg_dump --format=custom --file=<backup-file> <connection-target>` with
credentials supplied through the approved environment/configuration mechanism.
Never put a live connection string in shell history or documentation.

After verifying the backup, apply migrations with `npm run db:migrate`, then
start the API and verify `/api/health` and the migrated record counts. The
legacy-import migration is atomic; if it fails, it reports the migration
version and invalid collection/record IDs, rolls back normalized inserts, and
retains the legacy rows. There are currently no automatic down migrations.
Recovery from a failed deployment is to stop writes and restore the
pre-migration backup using the database provider's restore procedure (or
`pg_restore --clean --if-exists --dbname=<target> <backup-file>` for a
PostgreSQL custom-format backup). Do not manually delete schema or legacy
records as a rollback strategy.

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

School-owned CRUD and account-management requests are scoped on the server to
the authenticated account's current `schoolId`. Role and school claims are
refreshed from the database for each API request. The system still has only
these four roles; granular permissions and the additional school roles remain
future work.

## Auth flow

```
POST /api/auth/register            { name, email, password, role, childIds? }  (admin/teacher/parent — admin-only after bootstrap)
POST /api/auth/register-with-code  { code, name, email, password }             (student — public, redeems an invite code)
POST /api/auth/login               { email, password }  -> { user, token }
POST /api/auth/logout              (invalidates all account sessions)
POST /api/auth/password/change     { currentPassword, newPassword }
POST /api/auth/forgot-password    { email }
POST /api/auth/reset-password     { token, password }
GET  /api/audit-logs?page=1&limit=25&action=&entityType=&from=&to= (school admin only)
GET  /api/auth/me                  (requires Bearer token)
```

Every other route requires `Authorization: Bearer <token>`.

New passwords must be at least 12 characters and fit bcrypt's 72-byte input
limit. Reset tokens are stored only as SHA-256 hashes, expire after 30 minutes,
and can be used once. Production reset messages use SMTP, and the API returns
the same generic response whether or not the email exists. Development/test
responses include the reset token only when SMTP is not configured.
Authentication endpoints are rate limited per client IP.

Successful generic CRUD creates, updates, and deletes, account lifecycle
changes, sign-ins/outs, password changes/resets, and account creation are
recorded in `audit-logs`. The school-admin endpoint supports action, entity,
date-range, and pagination filters; it does not expose other schools' events.

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

### List queries and errors

CRUD list endpoints preserve their original array response by default. Where
the route declares the relevant fields, they also support `search`,
`filter[field]`, `sort` (prefix with `-` for descending), and opt-in
pagination:

```text
GET /api/students?search=brian&filter[class]=Grade%208&sort=-name&page=1&limit=25
```

When `page` or `limit` is supplied, the response is `{ data, meta }` with
`page`, `limit`, `total`, and `pages`. API errors use this shape:

```json
{
  "success": false,
  "error": {
    "code": "INVALID_EXAM_SCORE",
    "message": "Score must be between zero and the maximum score."
  }
}
```

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
  -d '{"name":"Admin","email":"admin@school.test","password":"replace-with-a-long-unique-password","role":"admin","schoolName":"Demo School"}'

# copy the "token" from the response, then:

# 2. Create a student
curl -X POST http://localhost:4000/api/students \
  -H "Content-Type: application/json" -H "Authorization: Bearer <TOKEN>" \
  -d '{"name":"Amina Otieno","class":"Grade 7B"}'
```

## Remaining architecture work

Some frontend dashboard content remains static. Relational database
migrations, a repeatable legacy-data conversion, granular permissions, audit
logs, role-specific dashboards, and the remaining finance/academic workflows
are not yet implemented.

## Local verification

Run the API smoke tests against a temporary SQLite database:

```bash
cd backend
npm test
```

For browser testing against the local API, set `localStorage.sms_api_base` to
`http://localhost:4000/api` before signing in. The shared frontend client
otherwise uses the deployed API URL.
