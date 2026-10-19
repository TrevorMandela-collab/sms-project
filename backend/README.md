# SMS Backend

Express API for the School Management System. Handles auth (JWT + roles) and
CRUD for every module: students, teachers, announcements, attendance, fees,
exams, timetable, and library.

## Setup

Use Node.js 22 or newer; `better-sqlite3` 13 requires Node.js 22+.

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

Run all suites with `npm test`. For a faster, priority-first run, use
`npm run test:critical`, `npm run test:major`, or `npm run test:minor`.
Critical covers API smoke, tenant isolation, invite claims, platform roles and
auditing, and QA authorization. Major covers database migrations, seed, profile,
and email behavior. Minor covers focused frontend helper and search tests.
PostgreSQL integration tests can be run with `TEST_DATABASE_URL` set to a newly provisioned, dedicated
database whose name includes `test`, then `npm run test:postgres`. The test
runner refuses a database with existing migration or legacy data, and it
leaves the test schema in place; provision a fresh disposable database for
each run. Do not point test commands at development or production databases.
In Windows PowerShell, set the variable for the current shell and run the test:

```powershell
$env:TEST_DATABASE_URL = "postgresql://sms_test:sms_test_password@localhost:5432/sms_test"
npm run test:postgres
Remove-Item Env:TEST_DATABASE_URL
```

The repository CI runs the complete SQLite suite and a PostgreSQL 16
integration suite against disposable service databases on pushes and pull
requests.

### Isolated local demo accounts

The demo seed creates fake accounts for each supported role:

- `platform-admin@mandela.example` — Super Admin, not linked to a school
- `school-admin@greenvalley.example` — School Admin
- `admin@greenvalley.example` — legacy-compatible school Admin
- `teacher@greenvalley.example`, `parent@greenvalley.example`, and
  `student@greenvalley.example` — school users

On Windows PowerShell, create a dedicated SQLite database under the system
temporary directory before seeding. If `DEMO_SEED_PASSWORD` is not set, the
seed generates a cryptographically random password and prints it once after a
successful seed. Copy it to a local password manager for testing; it is never
stored in plaintext. To choose your own unique test password instead, set
`DEMO_SEED_PASSWORD` to a value of at least 12 characters before the seed.

```powershell
cd "C:\Users\<you>\OneDrive\Documents\sms-project-repo\backend"
$env:NODE_ENV = "development"
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
$demoDirectory = Join-Path $env:TEMP ("mandela-sms-demo-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $demoDirectory | Out-Null
$env:SQLITE_PATH = Join-Path $demoDirectory "demo.sqlite"
Remove-Item Env:DEMO_SEED_PASSWORD -ErrorAction SilentlyContinue
npm run seed
# Keep this PowerShell window open and run the local API with the same isolated database:
npm run dev
```

The seed refuses to run unless `NODE_ENV=development`, `DATABASE_URL` is
unset, and `SQLITE_PATH` resolves inside the system temporary directory. It
does not use the default `backend/data/sms.sqlite` or the QA database. It
refuses partial/conflicting demo records and safely recognizes a complete
demo set on reruns. All demo roles share the one local test password. Setting
`DEMO_SEED_PASSWORD` is optional; if set, it is used for every demo account.
Do not reuse these credentials or this temporary database for real data.

Server runs on `http://localhost:4000` by default. In non-production it binds
to `127.0.0.1` unless `HOST` is explicitly configured; production defaults to
`0.0.0.0` unless overridden. Health check:
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

**Migration status:** the API reads and writes normalized relational tables;
production persistence does not use the legacy `store` table. Versioned
migrations run transactionally at server startup or with `npm run db:migrate`.
Migration `002` converts legacy `store` records, preserves IDs and unmodeled
fields, creates relational links for legacy class assignments, parent-child
links, chat members, and library loans, and verifies every imported collection
count. Invalid or orphaned data stops the migration and leaves the source
table intact. Migration `004` removes the legacy table only after conversion
succeeds. A fresh database can be created using migrations alone.
Migration `003` checks existing school-owned relationships and installs
database triggers that reject cross-school links on later inserts and updates.
If it finds an existing tenant mismatch, the migration fails without removing
records; correct or reconcile the reported relationship and rerun migrations.
Migration `005` also prevents changing a referenced record's school in a way
that would make an existing relationship cross-school.

SQLite and PostgreSQL use the same table definitions and data mapping.
`backend/migrations/001_relational_schema.js` contains the relational schema;
`002_import_legacy_store.js` is the versioned legacy import,
`003_enforce_school_relationships.js` adds tenant-consistency enforcement,
`004_remove_legacy_store.js` removes the converted source table, and
`005_guard_school_reassignment.js` protects those relationships from unsafe
school changes. Migration `006_qa_testing.js` adds owner-scoped QA records,
`007_platform_admin_roles.js` adds the distinct `school_admin` and
`super_admin` role codes without changing existing role assignments or school
IDs, and `008_platform_audit_logs.js` adds a separate platform-wide audit
stream for Super Admin actions.
Use the same migration command against development, test, and production
databases.
The data layer also exposes atomic `createInvoiceWithItems` and
`recordPaymentWithAllocations` operations. These are persistence primitives;
they do not add a payment API route or change the existing fees API.
Library loan creation, return, and archival adjust available-copy counts
inside the same transaction as the loan record, so API clients must not update
`copiesAvailable` separately when creating or returning loans.

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

The school roles are `admin` (retained for compatibility), `school_admin`,
`teacher`, `parent`, and `student`. `super_admin` is a separate platform
operator role.

- **The very first account you register becomes the admin automatically**
-  (school bootstrap); this public bootstrap only creates a school-scoped
  `admin`. `super_admin` is never accepted by public registration.
- **admin / school_admin** — school administrator permissions, scoped to the
  account's own school. Existing `admin` records remain school admins and
  never gain platform-wide access.
- **super_admin** — platform-only permission to list, create, read, and update
  school records through `GET/POST /api/schools/platform` and
  `GET/PATCH /api/schools/platform/:id`. This role does not satisfy school
  administrator route checks.
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
refreshed from the database for each API request. School IDs are generated
server-side and are not changed by platform school updates.

Provision a platform operator only from an interactive operator shell with
access to the intended configured database. `npm run provision:super-admin`
requires `DATABASE_URL` or an explicit `SQLITE_PATH`, applies pending
migrations, prompts for a name/email and a hidden password (12–72 UTF-8
bytes), and creates a `super_admin` with no school association. It does not
accept role, school ID, or credentials as command-line arguments or create an
account through the public bootstrap. Protect the database configuration and
operator shell as privileged access; never put a password in source control.
Super Admins can create schools, change school settings or lifecycle status, and
provision an initial school-scoped administrator through the platform API.
School lifecycle status is stored in the existing school settings JSON;
suspended schools cannot sign in or use authenticated APIs, and active WebSocket
sessions are revalidated. School administrators can update their own school's
details through `/api/schools/me`; those changes are written to the school's
audit log.

## Auth flow

```
POST /api/auth/register            { name, email, password, role, childIds? }  (admin/teacher/parent — admin-only after bootstrap)
POST /api/auth/register-with-code  { code, name, email, password }             (student — public, redeems an invite code)
POST /api/auth/login               { email, password }  -> { user, token }
POST /api/auth/logout              (invalidates all account sessions)
POST /api/auth/password/change     { currentPassword, newPassword }
POST /api/auth/forgot-password    { email }
POST /api/auth/reset-password     { token, password }
PATCH /api/auth/me                { name?, email? } (updates only the authenticated account)
GET  /api/audit-logs?page=1&limit=25&action=&entityType=&from=&to= (school admin only)
GET  /api/audit-logs/platform?page=1&limit=25 (Super Admin only)
GET  /api/auth/me                  (requires Bearer token)
```

Every other route requires `Authorization: Bearer <token>`.

New passwords must be at least 12 characters and fit bcrypt's 72-byte input
limit. Reset tokens are stored only as SHA-256 hashes, expire after 30 minutes,
and can be used once. Production reset messages use SMTP, and the API returns
the same generic response whether or not the email exists. The forgot-password
API never returns reset tokens; reset links are delivered only through the
configured email provider.
Authentication endpoints are rate limited per client IP.

Successful generic CRUD creates, updates, and deletes, account lifecycle
changes, sign-ins/outs, password changes/resets, and account creation are
recorded in `audit-logs`. The school-admin endpoint supports action, entity,
date-range, and pagination filters; it does not expose other schools' events.
Platform-level Super Admin events use the separately authorized
`platform_audit_logs` stream, exposed only through the platform audit endpoint.
Profile updates record changed field names without copying personal field
values into audit metadata.

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

Some frontend dashboard content remains static. Granular permissions,
role-specific dashboards, and the remaining finance/academic workflows are
future work.

## Local verification

Run the API smoke tests against a temporary SQLite database:

```bash
cd backend
npm test
```

For browser testing against the local API, set `localStorage.sms_api_base` to
`http://localhost:4000/api` before signing in. The shared frontend client
otherwise uses the deployed API URL.
