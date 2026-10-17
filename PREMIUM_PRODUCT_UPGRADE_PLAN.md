# Mandela SMS — Premium Product Upgrade

## Read-only repository audit

### Current architecture

- The repository is a static, multi-page HTML/CSS/vanilla-JavaScript frontend in
  `frontend/` and a Node.js 22+ / Express 4 CommonJS API in `backend/`.
- The frontend has no package manifest, bundler, or frontend build step. Pages
  load shared scripts and styles directly and use relative links.
- The backend selects PostgreSQL when `DATABASE_URL` is set; otherwise it opens
  SQLite using `SQLITE_PATH` or `backend/data/sms.sqlite`. Migrations run before
  the HTTP server accepts requests.
- Existing school records already have stable UUID identifiers, and
  `schoolId` is the current tenant boundary. Existing roles are `admin`,
  `teacher`, `parent`, and `student`; the `admin` role currently means
  school-level administration.
- Shared authentication, API access, role-aware navigation, CRUD pages,
  school/role portals, audit logs, and several operational workflows are
  implemented. They should be evolved in place rather than replaced.
- Backend tests cover database/migration behavior, authentication, selected
  permissions and cross-school access, seed behavior, and QA endpoints.
  PostgreSQL CI coverage is narrower than the SQLite/API smoke coverage.
  There is no configured frontend build or browser-test suite; the chat
  renderer has a standalone Node test.
- Existing product documentation classifies finance as partial (no mounted
  payment/invoice workflow), guardian management as absent, and several
  browser journeys and module-level workflows as unverified.

### Findings that should shape implementation order

1. **Role change is security-sensitive.** Adding Super Admin and School Admin
   affects persisted roles, bootstrap, route permission lists, JWT user
   payloads, user management, navigation, and portals. Existing `admin`
   accounts must retain school-admin privileges without gaining platform-wide
   access.
2. **Tenant isolation is enforced at multiple route call sites.** The CRUD
   factory and custom routes generally scope access, while low-level ID
   helpers such as `findById`, `update`, and `remove` are not inherently
   school-scoped. New or changed routes need explicit scope checks and tests.
3. **There is a concurrency risk in invite redemption.** Invite validation
   and marking the invite used are separate from the account-creation
   transaction; concurrent redemption should be made atomic and tested.
4. **WebSocket authorization is established at connection/join time.** The
   current realtime layer does not visibly revalidate connected clients after
   token revocation, suspension, or later membership changes. Its query-string
   token also deserves a deliberate logging/exposure review.
5. **Some shared frontend rendering interpolates dynamic values into HTML.**
   The account menu and portal views are notable review targets. The chat
   renderer's DOM/text-node approach is a safer in-repository pattern.
6. **Some data-fetch failures are rendered as empty collections.** Dashboard
   and portal request handling should distinguish a genuine empty state from
   partial/API failure.
7. **The database upgrade path needs conservative handling.** Migration 002
   imports legacy data and migration 004 removes the legacy store. Migrations
   are ordered and transaction-wrapped, but there is no evident general
   down-migration mechanism. Never repurpose or rewrite existing migrations.
8. **The current checkout is already dirty.** At audit time, `git status
   --short` showed 37 changed/untracked entries, including backend/auth/chat
   work, QA Lab files, database backups, and `.Render`. Preserve all of it;
   implementation must be isolated by reviewed file-level diffs.
9. **“Premium” is treated here as product quality and visual direction, not
   paid subscription/billing.** No plan, entitlement, or subscription system
   is evident. Do not introduce one without separate product requirements.

This is a static source and documentation audit. No tests, migrations, browser
flows, or database access were performed for the audit.

## Proposed phased implementation

Work one phase at a time. Review each phase's diff and run its focused tests
before starting the next. Do not deploy, commit, or push without explicit
approval.

### Phase 0 — Freeze the baseline and acceptance criteria

- Reconfirm the actual worktree and preserve all existing dirty/untracked
  files.
- Establish a route/role/resource matrix from mounted routes and current
  middleware; map current page flows and API responses.
- Record the existing visual and responsive behavior, critical workflows,
  data-fetch error behavior, and migration state using disposable test data.
- Define security acceptance tests for school isolation, role denial,
  bootstrap, invite concurrency, and revoked WebSocket/API sessions.
- Do not treat existing inventory documents or prior test results as proof of
  current browser behavior.

**Likely areas:** `backend/routes/`, `backend/middleware/`,
`backend/utils/crudRouterFactory.js`, `backend/utils/db.js`,
`backend/test/`, `frontend/shared/`, and page entry points.

**Gate:** agree on role semantics, school ownership model, and how an initial
Super Admin is provisioned before schema or authorization changes.

### Phase 1 — Define and migrate the role model safely

- Introduce explicit `super_admin` and `school_admin` semantics. Preserve
  existing `admin` users as school administrators; never infer platform
  privilege from an old admin role or a client-supplied school ID.
- Define platform-level versus school-level route permissions and behavior
  for a Super Admin with no active school context.
- Design a controlled, auditable Super Admin provisioning flow that is not
  the public first-school bootstrap route.
- Add an additive, forward-only migration and compatibility handling for
  existing role rows, existing tokens, account management, and school bootstrap.
- Keep school IDs as stable UUIDs unless the ownership decision proves an
  additional organization/tenant layer is required.

**Likely areas:** `backend/migrations/`, `backend/middleware/auth.js`,
`backend/routes/auth.js`, `backend/routes/schools.js`,
`backend/utils/crudRouterFactory.js`, custom route permission declarations,
`backend/test/`, `frontend/shared/auth-client.js`,
`frontend/shared/auth-guard.js`, and `frontend/shared/sidebar.js`.

**Migration risks:** role rows/foreign keys and role codes may differ from
assumptions; bootstrap and existing school admins must continue to work;
SQLite and PostgreSQL behavior must agree; rollback is not assumed available.
Test fresh installs and upgrades from representative legacy schemas without
touching real data.

### Phase 2 — Make tenant authorization systematic

- Audit every mounted route's list/read/create/update/delete path, including
  custom routes and indirect references.
- Use authenticated server-side identity for tenant selection; validate
  every referenced school-owned record against that tenant.
- Introduce or reuse scope-aware data-access helpers where they reduce
  omissions; avoid broad rewrites of existing working route behavior.
- Make invite redemption single-use under concurrency.
- Define and enforce what happens to WebSocket connections when account
  status, token version, or chat membership changes; avoid credential leakage
  through URLs/logging.
- Add table-driven role and cross-school denial tests for all route families.

**Likely areas:** `backend/utils/crudRouterFactory.js`,
`backend/utils/db.js`, all `backend/routes/*.js`,
`backend/utils/realtime.js`, auth middleware, migrations only where required,
and `backend/test/`.

**Gate:** SQLite route/API suite passes; equivalent PostgreSQL authorization
coverage is available before production rollout.

### Phase 3 — Establish the shared visual and interaction system

- Define accessible color, typography, spacing, border, elevation, focus,
  control, table, dialog, feedback, and responsive tokens.
- Keep the Super Admin command-center treatment distinct from the welcoming
  school-user shell while sharing components and interaction patterns.
- Align shared navigation, page headers, feedback, forms, and empty/loading/
  error states without changing authorization behavior.
- Add reduced-motion and keyboard/focus behavior; support light/dark themes
  where it can be implemented without duplicating every page style.
- Replace unsafe dynamic HTML rendering in shared account/portal surfaces
  with safe DOM rendering or context-correct escaping.

**Likely areas:** `frontend/shared/theme.css`, `frontend/shared/portal.css`,
`frontend/shared/sidebar.js`, `frontend/shared/auth-guard.js`,
`frontend/shared/portal-views.js`, and shared feedback helpers.

**Risk:** shared styles/scripts affect all pages. Roll out incrementally and
verify representative desktop/mobile pages for each user role.

### Phase 4 — Super Admin platform overview and school management

- Add a dedicated platform shell, platform overview, and school directory/
  detail management backed by Super Admin-only APIs.
- Show real, correctly scoped school/account/activity data; do not use fake
  charts or counts.
- Provide safe school activation/status actions and audit sensitive changes.
- Keep School Admin routes restricted to their own school.

**Likely areas:** new `frontend/super-admin/` pages, shared navigation/styles,
new or extended `backend/routes/schools.js`, auth/role middleware, audit
logging, and API tests.

**Risk:** global queries must be available only to the platform role and must
not leak school data through filters, pagination, or exports.

### Phase 5 — School Admin dashboard and core administration

- Evolve `frontend/dashboard/` into a school-scoped operational overview
  using real aggregate endpoints and existing records.
- Add useful date/class/status filters, responsive data tables, pagination,
  safe exports, and explicit loading/empty/partial-failure states.
- Preserve existing school setup, date/currency formatting, charts, and
  useful workflow links.

**Likely areas:** `frontend/dashboard/`, relevant resource pages,
`backend/routes/` aggregate endpoints, query/data helpers, and tests.

**Risk:** existing dashboard requests and fallback-to-empty behavior may hide
failures. Establish exact aggregate definitions and authorization first.

### Phase 6 — Refine operational workflows in small module groups

- Improve students/teachers/classes/subjects, attendance, assignments/exams,
  fees, library, events, announcements, and audit-log workflows in small
  reviewable groups.
- Add consistent filtering, pagination, validation, confirmation, duplicate
  submission prevention, empty/error states, and keyboard-accessible dialogs.
- Implement finance/payment journeys only after product rules, authorization,
  and reconciliation requirements are defined; schema helpers alone are not
  a finished workflow.

**Likely areas:** each affected `frontend/<module>/{index.html,script.js,style.css}`,
matching `backend/routes/*.js`, shared components, and API tests.

**Risk:** broad modules include transactional and relational behavior. Keep
business logic stable unless a specific verified defect or approved workflow
change requires otherwise.

### Phase 7 — Teacher, parent, and student experiences

- Improve role-specific portals using only server-authorized linked records.
- Decide whether guardian records/accounts are in scope before adding routes
  or changing the current parent `childIds` model.
- Align role-specific navigation, summaries, announcements, assignments,
  attendance, results, and fees with the actual implemented APIs.

**Likely areas:** `frontend/teacher-portal/`, `frontend/parent-portal/`,
`frontend/student-portal/`, `frontend/shared/portal-views.js`, and related
backend route/tests.

**Risk:** do not broaden data access to fill a visual gap; verify child,
student, class, and teacher associations at the backend boundary.

### Phase 8 — Search, command palette, notifications, and actionable alerts

- Add Ctrl+K global search and keyboard-accessible command navigation using
  permitted, school-scoped results.
- Define notification sources, read/unread state, delivery, and retention
  before adding persistence or realtime mechanisms.
- Build actionable alerts from real conditions with clear links and
  authorization checks.

**Likely areas:** shared frontend shell/navigation, new search/notification
components and API routes, database migration only if persisted notifications
are approved, and tests.

**Risk:** global search can become a cross-tenant disclosure path; notification
counts and actions must be derived from authorized data.

### Phase 9 — Accessibility, browser regression, and rollout readiness

- Verify keyboard navigation, focus visibility, contrast, screen-reader
  labels, reduced motion, narrow viewports, and both themes.
- Add browser-level smoke coverage for login/session expiry, role navigation,
  school isolation, critical CRUD workflows, search, notifications, and
  failure states.
- Run fresh-schema and upgrade migration tests on SQLite and PostgreSQL.
- Document operator-only Super Admin provisioning and safe upgrade/backup
  procedures; review deployment settings separately before any deployment.

**Likely areas:** frontend shared/page tests, backend tests and CI workflow,
setup documentation, and migration verification.

## Decisions required before implementation

1. Confirm the proposed role mapping: legacy `admin` becomes School Admin;
   `super_admin` is a distinct platform-only role.
2. Approve a non-public, auditable Super Admin provisioning mechanism before
   implementing platform-wide access.
3. Confirm that each school remains the tenant boundary (no organization
   owning multiple schools in this scope).
4. Confirm guardian management and payment/invoice workflows are deferred
   until their product rules are specified.

## Baseline evidence and scope

- Branch: `phase-1/database-persistence-hardening`; HEAD observed as `4fff8d5`.
- Worktree status: 37 changed/untracked entries observed before adding this
  plan. They are preserved.
- Source inventory observed: 79 frontend files; 55 backend files excluding
  dependencies and data.
- No frontend package/build configuration was found. The checked-in GitHub
  Actions workflow runs backend SQLite tests and a narrower PostgreSQL
  database test.
- `.env` contents, database contents, QA data, backups, and `.Render` were not
  inspected. No tests, migrations, browser sessions, or deployments were run
  for this audit.
