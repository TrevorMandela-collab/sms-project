# Mandela SMS — Phase 2 Verified Feature Inventory

## Scope and status definitions

This inventory records features visible in the checked-out repository on
`phase-1/database-persistence-hardening` at commit `4fff8d5`. It is based on
frontend page/script wiring, mounted backend routes and middleware, relational
migrations, project documentation, and the existing automated tests. It is not
a claim that every browser workflow has been manually exercised.

- **Implemented** — the relevant user-facing page and backend behavior are
  both present in source, or (for infrastructure features) the backend
  behavior is present. Automated test coverage is reported separately and
  may be incomplete.
- **Partially Implemented** — only part of the expected workflow exists, a
  feature depends on lower-level primitives without a user-facing route, or
  supporting functionality is explicitly described as future work.
- **Unverified** — relevant code is present, but the expected end-to-end
  behavior is not established by the available automated test evidence.
- **Not Implemented** — the inspected routes and frontend do not provide the
  feature; a related schema table or utility alone does not count as a
  user-facing implementation.

`database.js`, `fresh-migrations.js`, `migration-failure.js`, `seed.js`, and
`smoke.js` below refer to files under `backend/test/`. The frontend column
identifies checked-in pages/scripts; it does not indicate browser automation.
All route names are under `/api`.

## Authentication, authorization, and school isolation

The backend uses JWT bearer tokens. `requireAuth` reloads the user from the
database, checks token version and account status, and attaches the current
user; `requireRole` enforces route-specific roles. Generic collection routes
require authentication and configured role permissions, filter records to the
current `schoolId`, and apply parent, student, or teacher scoping where the
route supplies a scope. Database migrations also enforce school-consistent
relationships. Frontend role hiding and login guards are convenience/UI
behavior; backend guards are the access-control boundary.

## Feature inventory

| Feature and status | Frontend page(s) | API routes and authorization | Persisted data / dependencies | Automated evidence and status basis |
|---|---|---|---|---|
| **Authentication, sessions, and account lifecycle — Implemented** | `frontend/login/`, `frontend/register/`, `frontend/manage-logins/`, shared `frontend/shared/auth-client.js` and `auth-guard.js` | `/auth/register` (bootstrap first admin; admin-only after bootstrap), `/auth/login`, `/auth/logout`, `/auth/me`, `/auth/users` and account-management routes (authenticated admin for management), `/auth/password/change` (authenticated), `/auth/forgot-password` and `/auth/reset-password` (public, rate-limited), `/auth/register-with-code` (public invite redemption). Roles: admin, teacher, parent, student. | `users`, `roles`, `user_roles`, `password_resets`, `schools`; bcrypt password hashes, JWT token versions, reset-token hashes, account status. | `smoke.js`: bootstrap/admin registration, parent and teacher accounts, login/logout, password change/reset and single-use reset race, rate limit, role denial, stale token behavior. Core server/API behavior is covered; browser flows are not. |
| **School profile and tenant isolation — Implemented** | School settings are accessed from the dashboard/setup UI; shared page navigation and API client. | `/schools/me` GET/PATCH: authenticated admin only. Generic school-owned routes use the current user's school; special routes also check school ownership. | `schools`, `users.school_id`, school-owned resource `school_id`; migrations `003` and `005` add school-relationship enforcement. | `smoke.js`: school profile read/update, fallback school setup, cross-school student/attendance/fee/exam/assignment access attempts, account/chat/invite isolation. `database.js` and `fresh-migrations.js`: cross-school relationship and foreign-key checks. |
| **Students and linked parent/student views — Implemented** | `frontend/students/`, `frontend/parent-portal/`, `frontend/student-portal/`. No dedicated guardian-management page found. | `/students` CRUD: admin creates/deletes; admin and teacher update; admin, teacher, parent, and student read, with teacher-class, parent-child, and student-self scopes. | `students`, `classes`, user `childIds`/`studentId`, and school ownership. Student validation requires a name and validates date of birth. | `smoke.js`: student create/list, tenant boundaries, parent own-child vs foreign-child, student own-record vs another student's record, teacher class scope. `database.js`: uniqueness, FK, cross-school link and pagination checks. Guardian entity/relationship tables exist, but there is no guardian route or guardian UI; see the separate guardian status below. |
| **Teachers, classes, and subjects — Implemented** | `frontend/teachers/`, `frontend/classes-subjects/`; teacher portal displays role-scoped information. | `/teachers`: admin CRUD, admin/parent/student read. `/classes` and `/subjects`: admin create/update/delete; admin, teacher, parent, student read. | `teachers`, `classes`, `subjects`, `teacher_assignments`, `class_subjects`; class route validates referenced teachers/subjects belong to the same school. | `smoke.js`: create teacher/class, teacher assignment scoping and restricted access. `database.js`: unique identifiers, same-school relationships and constraints. No browser-level verification. |
| **Attendance — Implemented** | `frontend/attendance/`; parent and student portal views. | `/attendance` CRUD: admin/teacher write; admin/teacher/parent/student read. Parent, student, and teacher records are scoped to linked children, self, or assigned students. | `attendance`, `students`, `classes`, school scope; unique student/date/session and allowed attendance status. | `smoke.js`: cross-school write rejected, create, duplicate and concurrent duplicate conflict. `database.js`: uniqueness and concurrent insertion. Parent/student/teacher scoping is code-backed but not every role-specific attendance scenario is asserted by the smoke test. |
| **Assignments and assignment tracking — Implemented** | `frontend/assignments/` loads assignments, classes, subjects, students, and submissions; admins/teachers can create/edit assignments and use a roster modal to mark submission status and scores. | `/assignments`: admin/teacher write; admin/teacher/parent/student read, with class and assigned-teacher scoping. `/assignment-submissions`: admin/teacher write; admin/teacher/parent/student read, with student/parent/teacher scoping. The current submission workflow is teacher-managed; the server does not permit student-role writes. | `assignments`, `assignment_submissions`, `classes`, `subjects`, `students`, teacher assignments and school ownership. Assignment validation checks same-school class and optional subject. | `smoke.js`: rejects a cross-school assignment class, but does not exercise successful assignment or submission workflows. The teacher-managed status/score tracker exists in the page and API; student-authored submission is not part of the implemented workflow, and successful end-to-end behavior remains untested. |
| **Examinations and results — Implemented** | `frontend/exams/`; parent, student, and teacher portal views. | `/exams` CRUD: admin/teacher write; admin/teacher/parent/student read. Teacher, parent, and student scopes apply. | API collection `exams` maps to assessment/result data; relational tables include `assessments` and `assessment_results`, with score bounds and per-assessment/student uniqueness. | `smoke.js`: cross-school exam write rejected. `database.js`: result score bounds and duplicate result constraint. The full create/edit/read results workflow and role-specific result views lack direct end-to-end API assertions. |
| **Fees and payment collection — Partially Implemented** | `frontend/fees/`; parent/student portal views. | `/fees` CRUD: admin creates/updates/deletes; admin/teacher/parent/student read, with parent/student child scoping. The route validates non-negative amounts with at most two decimal places and requires a same-school student. No `/payments` or invoice API route is mounted. | `fees` API records; schema also has `fee_structures`, `invoices`, `invoice_items`, `payments`, and `payment_allocations`. `utils/db.js` exposes atomic invoice/payment persistence helpers, which are not exposed as fees/payment HTTP workflows. | `smoke.js`: rejects cross-school fee writes, teacher payment attempts, negative fee amounts, and excessive decimal precision. `database.js` directly tests invoice creation, payment allocations, invalid amounts, rollback, and concurrent allocations. Invoice/payment persistence primitives are tested, but complete user-facing finance workflows and reconciliation are not available or verified. |
| **Library catalogue and loans — Implemented** | `frontend/library/` has catalogue and loan views, book CRUD, loan creation, return, and deletion actions. | `/library`: admin CRUD; admin and parent read. `/library-loans`: admin/teacher create/update/delete; admin/teacher/parent read, parent scoped to own children. | Library books/copies and `library_loans`, with student/book school ownership and copy-availability updates handled transactionally. | `database.js`: loan capacity, concurrent loan, return, copy count and invalid-reference checks. No end-to-end API smoke coverage found for catalogue/loan workflows; student role cannot read the loans route under its configured permissions. |
| **Announcements — Implemented** | `frontend/announcements/`; dashboard/portal surfaces may display school announcements. | `/announcements`: admin create/update/delete; admin/parent/student read. | `announcements`, school scope; title and body required. | `smoke.js`: invalid announcement creation is rejected. Core CRUD and audience-specific visibility do not have comprehensive automated workflow coverage. |
| **Events and timetable — Implemented** | `frontend/events/`, `frontend/timetable/` | `/events`: admin/teacher write; admin/teacher/parent read. `/timetable`: admin write; admin/teacher/parent/student read with class/teacher scopes. | `events`, timetable entries, classes, students and optional teacher references; event dates and timetable weekdays/time ranges are validated. | The page scripts and route handlers are present, but no direct event or timetable API workflow assertions were found in `smoke.js`; those journeys remain unverified by automation. |
| **Chats and realtime messaging — Implemented** | `frontend/chats/` supports chat listing, message actions, invite/join, and WebSocket live updates with a polling fallback. | `/chats`: authenticated users see school chats where they are members; admin manages chats and invite codes. Join and message actions require authentication; message routes check chat membership (admins are permitted). `/ws` realtime endpoint is initialized by the server. | `chats`, `chat_messages`, membership/user IDs, school ownership, realtime WebSocket resources. | `smoke.js` checks school chat visibility and rejects foreign chat access. Message sending/editing/deletion/reactions, invite joining, and WebSocket delivery are present in source but not demonstrated by the automated suite. |
| **Audit logging — Implemented** | `frontend/audit-logs/` | `/audit-logs`: authenticated admin only; requires a linked school; supports pagination, action/entity and date filters. | `audit_logs`, user/school identifiers; writes are recorded by auth and generic CRUD helpers. | `smoke.js`: admin read, pagination/date validation, non-admin denial, and tenant isolation. It checks selected audit behavior, not completeness of audit coverage for every mutation. |
| **Database persistence, migrations, and development seed — Implemented** | No standalone user page; supports all backend workflows. | Migrations run at startup or through `npm run db:migrate`; SQLite by default and PostgreSQL with `DATABASE_URL`. Development seed through `npm run seed`. | Relational tables and constraints defined in migration `001`; legacy import `002`; tenant relationship enforcement `003` and `005`; legacy store removal `004`. | `database.js`, `fresh-migrations.js`, `migration-failure.js`, and `seed.js` cover migration/import/failure recovery, constraints, transactions, concurrency, query behavior and idempotent demo seed. Current `npm test` passed all five scripts in the Step 1 baseline. PostgreSQL CI invokes only `database.js`, not the full API smoke suite. |
| **Frontend navigation, validation, and connection/error states — Unverified** | `frontend/index.html`, shared `sidebar.js`, `auth-client.js`, `auth-guard.js`, and feature pages. | Shared API client adds bearer tokens; handles network errors, HTTP errors, session expiry and logout. UI role checks hide marked elements; server authorization remains authoritative. | Browser local storage for API base, user, and token; backend route/data behavior as above. | No browser automation or frontend test runner was found. Existing API smoke tests do not verify navigation, form behavior, empty/error states, responsive layouts, browser session persistence, or role-specific page rendering. |
| **Guardians as managed records — Not Implemented** | No guardian page found. | No guardian API route is mounted. | `guardians` and `guardian_students` tables exist in the relational schema; parent visibility is instead scoped through user `childIds`. | Schema presence alone does not implement guardian CRUD, account linking, or a guardian-facing workflow. No automated guardian workflow test found. |

## Critical workflows without adequate automated coverage

The repository's tests provide meaningful coverage for backend persistence,
migrations, seed data, authentication, selected authorization boundaries,
school isolation, and selected CRUD validation. The following high-impact
workflows remain absent or only partially exercised:

1. Browser-driven critical journeys, including sign-in, session expiry,
   account registration, password recovery, student administration, and
   role-specific portal navigation.
2. Assignment lifecycle coverage: teacher-side creation and submission
   tracking have no successful API workflow tests. The current workflow
   permits only admins/teachers to write submission records. Parent/student
   visibility also needs direct route-level verification.
3. Complete finance journey: invoice/line-item creation, payment recording and
   allocation, balance/reconciliation behavior, and appropriate authorization.
   Current payment helpers are not exposed through an API route.
4. End-to-end library catalogue and loan API behavior, including role-denied
   access and cross-school references; database primitive checks are not a
   substitute for route-level tests.
5. Event and timetable CRUD, validation, class scoping, and portal display.
6. Chat membership and invite redemption, message authorization/moderation,
   and realtime WebSocket delivery.
7. More systematic role-by-role and cross-school access checks across every
   route, including parent/student/teacher access to linked and unlinked
   records, and soft-delete/archive behavior where supported.
8. Frontend error, empty, validation, responsive, and persistence-after-restart
   behavior in an actual browser.
9. PostgreSQL API-level workflows: the CI PostgreSQL job runs the database
   test script only; the HTTP smoke suite is SQLite-only.

## Evidence sources and uncertainties

Evidence inspected for this inventory:

- Route registration and startup: `backend/server.js`.
- Authentication and role enforcement: `backend/middleware/auth.js`,
  `backend/middleware/rateLimiter.js`, and
  `backend/utils/crudRouterFactory.js`.
- Feature route definitions: `backend/routes/*.js`.
- Relational model and tenant guard migrations:
  `backend/migrations/001_relational_schema.js`,
  `backend/migrations/003_enforce_school_relationships.js`, and
  `backend/migrations/005_guard_school_reassignment.js`.
- Frontend pages and API clients: `frontend/*/index.html`,
  `frontend/*/script.js`, and `frontend/shared/*.js`.
- Automated evidence: `backend/test/*.js`, `backend/package.json`, and
  `.github/workflows/backend-tests.yml`.
- Product/setup context: `backend/README.md` and the existing
  `PHASE_1_PROJECT_INSPECTION_REPORT.md`.

This is a static code/documentation inventory, not a manual browser test or
security audit. Presence of a route, schema table, or frontend page does not
by itself prove deployment availability, correct behavior in every role,
production readiness, or completion of the workflow in a running browser.
Features marked **Unverified** require direct workflow evidence before they
can be treated as verified.
