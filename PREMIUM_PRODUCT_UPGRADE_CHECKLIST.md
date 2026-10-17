# Mandela SMS Premium Product Upgrade Checklist

This is the recovery checklist for implementation. Statuses reflect source
inspection and tool results so far, not assumptions about deployment.

## Phase 0 — Audit and baseline

- [x] Inventory framework, routes, migrations, tests, frontend modules, and
  deployment/build files.
- [x] Record existing role/tenant architecture, product gaps, migration risks,
  and current dirty worktree in `PREMIUM_PRODUCT_UPGRADE_PLAN.md`.
- [x] Preserve the existing dirty worktree; no baseline tests or migrations
  were run during the read-only audit.

## Phase 1 — Multi-tenant architecture and security

- [x] Define explicit `super_admin` and `school_admin` semantics; legacy
  `admin` must never acquire platform-wide access.
- [x] Provide a non-public, auditable Super Admin provisioning path.
- [x] Implement platform-only school creation/list/detail/settings operations
  and first School Admin provisioning.
- [x] Add platform-only active/suspended school lifecycle status; suspended
  schools cannot sign in or use authenticated APIs, and active sockets close
  on revalidation. Status uses the existing settings JSON, so no migration was
  needed.
- [x] Verify stable school UUID assignment and school-user binding; a protected
  Super Admin endpoint now provisions the first School Admin for a school.
- [ ] Review every backend route and data-access path for school scope.
- [x] Fix the teacher timetable scope's missing `getTeacherClassIds` import and
  add an HTTP regression asserting teachers see only assigned-class entries.
- [x] Close invite single-use concurrency risk using conditional claim plus
  transaction rollback; the full SQLite smoke suite exercises redemption and
  the isolated claim test checks racing claims.
- [x] Revalidate WebSocket account, chat, and school lifecycle authorization
  during active sessions; the isolated smoke test verifies suspended-school
  sockets close with code `4003`.
- [ ] Expand route/role/cross-school regression tests to every route and
  PostgreSQL; the current verified suite uses isolated SQLite databases.
- [x] Add end-to-end HTTP regression coverage for school scoping and protected
  metadata across the shared CRUD router used by 14 school-data collections.
- [ ] Verify upgrades from legacy schemas without touching live data on both
  supported database engines.

## Phase 2 — Shared visual system

- [ ] Review the existing in-progress edits to shared theme, login, dashboard,
  and navigation; preserve useful work and identify remaining inconsistencies.
- [ ] Complete reusable accessible tokens and controls.
- [ ] Complete distinct platform and school shells while preserving role checks.
- [ ] Verify responsive layouts, focus, reduced motion, contrast, and themes.
- [x] Render shared account-menu profile fields with `textContent` so profile
  names/emails cannot be interpreted as markup; remaining module-specific
  dynamic HTML still needs a full page-by-page review.

## Phase 3 — Super Admin platform experience

- [x] Build a platform overview from authorized school directory data.
- [x] Build school directory/settings and initial School Admin provisioning
  views.
- [x] Add a Super Admin-only platform audit feed and audit provisioning,
  school settings, profile, and sensitive platform actions.
- [x] Verify platform directory and audit access is denied to school roles
  with isolated route tests.

## Phase 4 — School Admin and existing pages

- [ ] Complete real-data school dashboard, summaries, and actionable alerts.
- [ ] Review every current page for functional controls and safe API behavior.
- [ ] Add consistent loading, empty, partial-failure, and error states.
- [ ] Add responsive filters, sorting, pagination, and export where useful.
- [ ] Preserve business behavior and verify each module group before proceeding.

## Phase 5 — Premium shared features

- [x] Implement permission-aware search and Ctrl+K command palette for
  students, teachers, fees, and Super Admin school names; additional result
  types and broader accessibility verification remain.
- [x] Define dashboard alert sources from real fee, attendance, and exam data;
  actionable alerts now deep-link to their modules and retain per-user,
  per-school read state in local storage. Cross-device/server notification
  delivery and a broader notification center remain.
- [ ] Add real attendance/fee summaries and analytics.
- [x] Add authorized school branding/settings and profile workflows, including
  authenticated profile updates and password changes.
- [ ] Review audit-log coverage across every sensitive route and standardize
  toast/confirmation patterns.
- [ ] Do not add billing/subscriptions without explicit product requirements.

## Phase 6 — Backend and database integration

- [ ] Verify all frontend controls use real API flows and server-side access
  checks across every module.
- [ ] Add request validation, safe failures, indexes, and additive migrations
  only where needed. Migration `008` adds the platform audit stream; profile
  input validation and tests are in place.
- [ ] Keep SQLite/PostgreSQL behavior aligned.
- [ ] Preserve test/production data separation; do not modify existing DBs.

## Phase 7 — Local demo

- [x] Document a disposable local SQLite setup and safe fake-data seeding;
  the seed refuses PostgreSQL and SQLite paths outside the system temp folder.
- [x] Generate a cryptographically random local demo password at runtime when
  no explicit test password is configured; only bcrypt hashes are persisted.
- [x] Seed a fake account for `super_admin`, `school_admin`, legacy `admin`,
  `teacher`, `parent`, and `student`; audit the demo platform-admin creation.
- [ ] Verify each role's pages and data boundaries with synthetic records.

## Phase 8 — Verification

- [x] Run focused tests after each phase and the supported full SQLite backend
  suite; `npm test` passes, including migration, smoke, QA, role, audit,
  profile, invite, and shared CRUD tenant-isolation tests.
- [x] Extend the manual QA matrix to 86 test cases across 14 suites, including
  Super Admin platform workflows, school isolation, school modules, portals,
  mobile/accessibility, and QA Lab access; the QA Lab workspace now includes
  Platform Overview for Super Admins.
- [x] In the isolated browser, verify login destination/navigation for the
  seeded admin, School Admin, teacher, parent, student, and Super Admin roles;
  student and School Admin direct access to the platform page redirects away.
- [x] Verify parent child switching, the School Admin notification panel,
  Super Admin directory filtering/empty state/audit rows, Ctrl+K school search,
  and logout clearing the session. At 390px, portal and platform pages have no
  page-level horizontal overflow.
- [ ] Extend browser coverage to remaining CRUD workflows, cross-school
  attempts, network-failure handling, and keyboard/contrast/reduced-motion
  checks across the full application.
- [x] Run Node syntax checks across all 93 backend/frontend JavaScript files,
  the chat renderer tests, and `git diff --check`.
- [ ] Complete browser-level responsive and accessibility checks; there is no
  frontend build/lint script.
- [ ] Review final diff for secrets, unrelated edits, and accidental data.

## Phase 9 — Documentation and final polish

- [ ] Update setup, environment, migration, testing, and local demo guidance.
  Backend migration/audit/profile and local role-demo instructions are updated;
  remaining pages and browser test instructions still need review.
- [ ] Record external dependencies and any unverified or blocked features.
- [ ] Reconcile this checklist with verified implementation and test evidence.

## Current checkout notes

- Branch: `phase-1/database-persistence-hardening`; HEAD observed at `4fff8d5`.
- The audit observed 37 dirty/untracked entries before this checklist was
  created. Existing changes and untracked files must be preserved.
- No production database, QA database, backup, `.env` value, or `.Render`
  content was inspected for this plan.
- Latest verified work (2026-10-16): migrations `001`-`008` pass on disposable
  SQLite test files; the latest full backend `npm test` passed, including
  platform audit, profile, lifecycle, invite, seed-safety, and shared CRUD
  tenant-isolation coverage. The seed now provisions six fake role accounts
  only into an explicit SQLite file under the OS temp folder, refuses any
  `DATABASE_URL`, and creates a random one-time password when no password is
  configured. Syntax checks passed across all 93 backend/frontend JavaScript
  files; chat renderer tests (2) and `git diff --check` passed. Development API
  binds to loopback by default. No database under `backend/data` was modified;
  test databases were isolated under `%TEMP%` or `:memory:`.
- Latest continuation (2026-10-16): Super Admin Ctrl+K now returns matching
  schools from the protected platform directory. Removing the platform table's
  mobile minimum width eliminated page-level overflow at 390px. The full
  backend suite passed after adding assigned-class timetable coverage; the
  chat renderer tests (2), changed-file syntax checks, and `git diff --check`
  passed.
- Latest smoke-fix verification (2026-10-16): the failing chat audit smoke path
  was isolated to the test fixture rather than the route itself. The chat PATCH
  test was using a member list that included a student outside the admin's
  school; corrected to `[auth.user.id]`, added route-level failure context,
  reran `node test/smoke.js`, and then ran the full `npm test` backend suite.
  Result: all smoke and backend tests passed with exit code 0.
- Browser verification used
  `C:\Users\kates\AppData\Local\Temp\mandela-browser-2f53977586e44bb98867e251104a43cf\demo.sqlite`;
  startup output confirmed the exact path. Both test server processes stopped,
  ports `4311` and `5500` have no listeners, and only that SQLite file was
  removed. No repository database was used or modified.
- Current next work: finish route-by-route isolation audit; complete
  remaining route-by-route and PostgreSQL authorization validation; assess
  the other pages, responsive/accessibility behavior, analytics, and
  notification coverage;
  document local demos for all roles; inspect final diff for secrets and
  unintended changes.
