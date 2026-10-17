# Mandela SMS — Phase 2 Manual Regression Checklist

## How to use this checklist

This checklist covers features classified as implemented or partially
implemented in [PHASE_2_FEATURE_INVENTORY.md](./PHASE_2_FEATURE_INVENTORY.md).
It is a set of manual checks, not evidence that the application has passed
them. Execute only against a local development instance and synthetic data.

For each case, record the observed result and change **Status** to exactly
`Pass`, `Fail`, or `Blocked` after execution. Keep `Not Run` until then.
Record defects using `PHASE_2_DEFECT_TEMPLATE.md` when that template is
available; until then, use a temporary unique reference such as `DEF-001`.
Do not put credentials, tokens, or real student/guardian details in defect
notes.

### Safety and prerequisites

- Never use production, shared, or school data. Do not point the app at a
  production `DATABASE_URL`.
- Use a newly named, disposable local SQLite file for manual API tests. The
  server applies migrations at startup. Do not overwrite, delete, or reuse
  `backend/data/sms.sqlite` or the automated smoke-test database.
- Run the backend from `backend/` with a disposable `SQLITE_PATH` inside the
  system temporary directory, a synthetic `JWT_SECRET`, and `DATABASE_URL`
  unset/empty. The backend binds to loopback by default in development.
  Choose a free local port.
- Serve `frontend/` locally, open its login page, and set
  `localStorage.sms_api_base` to
  `http://127.0.0.1:<port>/api` (for example, in browser developer tools run
  `localStorage.setItem('sms_api_base', 'http://127.0.0.1:4000/api')`) before
  signing in. The shared frontend client otherwise defaults to the deployed
  API.
- Use a browser private window or clear the test origin's local storage
  between role changes. Never paste tokens into screenshots, reports, or
  committed files.
- Use fake names and `.example`/`.test` email addresses only. Seed the
  disposable local database using the isolated setup in `backend/README.md`;
  it creates demo accounts for all six supported roles and generates a
  one-time password unless `DEMO_SEED_PASSWORD` is configured. Do not record
  any generated password, token, or invite code in this checklist.
- New test accounts and replacement passwords must use fresh locally
  generated values; never copy a real or reusable password into the test
  notes. To test two schools, use one **separate disposable test database**
  containing both schools, populated through a reviewed local-only fixture
  procedure. There is no public route for creating another school. Do not
  treat the fixture as an API workflow.
- PostgreSQL checks must use a newly provisioned, dedicated, disposable
  database whose name includes `test`, following `backend/README.md`. The
  test runner leaves its schema in place. Never use development or production
  databases.

### Case record fields

Every case has a unique ID, priority, feature, prerequisites, synthetic data,
steps, expected result, actual result, status, and defect reference. Initial
actual results are blank and initial statuses are `Not Run`.

Priority: **P0** = security/data-loss or core access blocker; **P1** = critical
school workflow; **P2** = important supporting workflow or UI behavior.

## A. Manual browser checks

Run these against the local frontend and local API, not the attached or
deployed application.

### BR-AUTH-01 — Admin sign-in and sign-out

- **Priority:** P0
- **Feature:** Authentication and session handling
- **Prerequisites:** Local server and frontend running; isolated demo seed
  created as documented in `backend/README.md`.
- **Synthetic test data:** School Green Valley; seeded admin
  `admin@greenvalley.example`; use the one-time password printed by the seed.
- **Steps:**
  1. Set `localStorage.sms_api_base` to the local API base on the local
     frontend origin.
  2. Open `frontend/login/index.html`; sign in with the synthetic admin.
  3. Confirm the dashboard loads and the user badge shows the test account.
  4. Use the avatar menu to log out.
  5. In the same browser context, navigate to a protected page such as
     `frontend/students/index.html`.
- **Expected result:** Login succeeds to the admin dashboard; logout clears the
  local session and returns to sign-in; the protected page redirects to
  sign-in.
- **Actual result:** *(blank)*
- **Status:** Not Run
- **Defect reference:** None

### BR-AUTH-02 — Role-specific page navigation

- **Priority:** P0
- **Feature:** Role-based portals and authorization UI
- **Prerequisites:** Synthetic admin, teacher, parent, and student accounts
  exist in School Alpha; accounts are linked to the intended synthetic
  teacher/student/children records.
- **Synthetic test data:** `teacher-a@example.test`, `parent-a@example.test`,
  `student-a@example.test`; synthetic records `STU-A-001` and `STU-A-002`.
- **Steps:**
  1. Sign in separately as each role in a clean browser session.
  2. Observe the post-login landing page and navigation.
  3. Open the attendance, fees, assignments, library, and audit-log pages
     where visible.
  4. Compare shown records/actions with each role's linked records and
     permissions in the inventory.
- **Expected result:** Student and parent land on their portals; teacher/admin
  land on the dashboard. Role-hidden controls are not shown to unauthorized
  roles, and pages do not display records outside the account's intended
  scope. UI hiding is not accepted as proof of API authorization.
- **Actual result:** *(blank)*
- **Status:** Not Run
- **Defect reference:** None

### BR-STU-01 — Create and validate a student record

- **Priority:** P1
- **Feature:** Student records
- **Prerequisites:** Signed in as School Alpha admin; a synthetic class exists.
- **Synthetic test data:** Student `Maya Test`; class `Grade 7 Test`; admission
  number `TST-ADM-001`; optionally date of birth `2013-04-12`.
- **Steps:**
  1. Open `frontend/students/index.html` and create the synthetic student.
  2. Confirm the new student appears in the list.
  3. Attempt to create a student with a blank name.
  4. Attempt to create a student with an invalid date of birth.
  5. Create a second student with the same school admission number, if the
     form exposes that field.
- **Expected result:** Valid record is saved and remains visible after reload.
  Blank name and invalid date are rejected with understandable feedback.
  Duplicate admission number is rejected if submitted; no duplicate record is
  created.
- **Actual result:** *(blank)*
- **Status:** Not Run
- **Defect reference:** None

### BR-STU-02 — Parent and student portal record scope

- **Priority:** P0
- **Feature:** Student records and linked portal views
- **Prerequisites:** School Alpha has two synthetic students; one parent is
  linked only to the first student; each student account is linked to its own
  record.
- **Synthetic test data:** `STU-A-001` / `STU-A-002`, `parent-a@example.test`,
  and student accounts `student-a1@example.test` / `student-a2@example.test`.
- **Steps:**
  1. Sign in as the parent and inspect the student/attendance/fees/results
     information exposed in the parent portal.
  2. Sign in as the first student and inspect their student portal.
  3. Use only visible UI navigation and record links; do not alter a URL to
     manufacture a route not provided by the app.
- **Expected result:** Parent sees only the linked child; each student sees
  only their own information. Empty sections show a safe empty state, not
  another user's record.
- **Actual result:** *(blank)*
- **Status:** Not Run
- **Defect reference:** None

### BR-ATT-01 — Attendance create, duplicate, and list

- **Priority:** P1
- **Feature:** Attendance
- **Prerequisites:** Signed in as admin or teacher with the synthetic student
  in scope.
- **Synthetic test data:** `STU-A-001`; date `2026-10-12`; status `present`.
- **Steps:**
  1. Open `frontend/attendance/index.html` and mark the student present for
     the test date.
  2. Reload the page and verify the entry remains.
  3. Attempt to add another daily attendance entry for the same student/date.
  4. Attempt to save an unsupported status or omit a required student/date if
     the page allows submitting it.
- **Expected result:** First entry is saved and persists after reload.
  Duplicate student/date/session is rejected or the existing entry is edited;
  invalid status and missing/invalid required values do not create a record.
- **Actual result:** *(blank)*
- **Status:** Not Run
- **Defect reference:** None

### BR-CLS-01 — Class, subject, and teacher assignment display

- **Priority:** P1
- **Feature:** Teachers, classes, and subjects
- **Prerequisites:** Signed in as admin.
- **Synthetic test data:** Class `Grade 7 Test`; subject `Science Test`;
  teacher `T-TEST-001`.
- **Steps:**
  1. Open the classes/subjects and teachers pages.
  2. Create the synthetic teacher, class, and subject, linking the latter two
     where the UI supports it.
  3. Reload both pages and inspect the displayed assignments.
  4. Attempt to save a class with a blank name or a selected teacher/subject
     that is not available in this school, if the UI permits the attempt.
- **Expected result:** Valid entries and links persist and display correctly;
  blank required values and invalid relationship references are not silently
  accepted.
- **Actual result:** *(blank)*
- **Status:** Not Run
- **Defect reference:** None

### BR-ASG-01 — Teacher-managed assignment tracking

- **Priority:** P1
- **Feature:** Assignments and assignment tracking
- **Prerequisites:** Signed in as an admin or assigned teacher; class has at
  least two synthetic students.
- **Synthetic test data:** Assignment `Science Worksheet Test`; class
  `Grade 7 Test`; score maximum `20`; student `STU-A-001`.
- **Steps:**
  1. Open `frontend/assignments/index.html`; create the assignment.
  2. Open its submissions tracker; mark `STU-A-001` submitted and enter score
     `18`.
  3. Save, reload, and reopen the tracker.
  4. Attempt to save an assignment with a blank title.
- **Expected result:** Assignment and teacher-managed status/score persist;
  blank title is rejected. Other unmarked students remain unsubmitted. This
  does not test student-authored submission, which is not implemented.
- **Actual result:** *(blank)*
- **Status:** Not Run
- **Defect reference:** None

### BR-FEE-01 — Fee record and amount validation

- **Priority:** P1
- **Feature:** Fees (existing `/fees` records only)
- **Prerequisites:** Signed in as admin; `STU-A-001` exists in the same school.
- **Synthetic test data:** Fee amount `125.50`, status `outstanding`, student
  `STU-A-001`; invalid boundary values `-1` and `1.005`.
- **Steps:**
  1. Open `frontend/fees/index.html` and create the synthetic fee record.
  2. Reload and verify it remains visible.
  3. Attempt to save amounts `-1` and `1.005`.
  4. Sign in as a teacher and check that fee mutation controls are absent or
     disabled.
- **Expected result:** Valid fee record persists; negative and over-precision
  amounts are rejected; teacher cannot create/update/delete fees. This case
  does not represent invoice or payment collection.
- **Actual result:** *(blank)*
- **Status:** Not Run
- **Defect reference:** None

### BR-LIB-01 — Library catalogue and loan lifecycle

- **Priority:** P1
- **Feature:** Library catalogue and loans
- **Prerequisites:** Signed in as admin; one synthetic student exists.
- **Synthetic test data:** Book `Science Reader Test`, one available copy;
  student `STU-A-001`; borrowed date `2026-10-12`; due date `2026-10-26`.
- **Steps:**
  1. Open `frontend/library/index.html`; create the book.
  2. Create a loan for the synthetic student.
  3. Confirm the available-copy count reflects the loan.
  4. Mark the loan returned and verify the copy becomes available again.
  5. Attempt to loan a nonexistent book/student if the form permits choosing
     or submitting such an item.
- **Expected result:** Book and loan persist; available-copy count is adjusted
  on loan and return; invalid references are rejected without changing counts.
- **Actual result:** *(blank)*
- **Status:** Not Run
- **Defect reference:** None

### BR-UI-01 — Empty, error, and responsive page behavior

- **Priority:** P2
- **Feature:** Frontend navigation, validation, and error states
- **Prerequisites:** Local frontend and API; synthetic account with a clean
  school containing no records in at least one list; browser developer tools.
- **Synthetic test data:** Empty test collection; optional invalid local API
  base on the test origin only.
- **Steps:**
  1. Open the students, attendance, assignments, fees, library, and events
     pages with empty collections.
  2. Confirm loading completes; inspect the empty states.
  3. In a separate test session, set the API base to a deliberately
     unavailable local port, then reload a page that loads API data.
  4. Restore the correct local API base.
  5. Repeat at a narrow mobile viewport and a desktop viewport.
- **Expected result:** Empty data is communicated without stale or foreign
  records; network failure is surfaced rather than shown as success; layout
  remains usable at both viewports; restoring the API returns the page to
  normal.
- **Actual result:** *(blank)*
- **Status:** Not Run
- **Defect reference:** None

## B. Manual API and database checks

Use the local API base and synthetic credentials only. These checks may be
performed with a REST client or PowerShell `Invoke-RestMethod`. Do not use
undocumented routes or copy live tokens into the checklist.

### API-AUTH-01 — Authentication, missing credentials, and role denial

- **Priority:** P0
- **Feature:** Authentication and authorization
- **Prerequisites:** Local disposable SQLite database; synthetic admin and
  teacher accounts.
- **Synthetic test data:** `admin@greenvalley.example`,
  `teacher@greenvalley.example`; use an incorrect, locally generated value
  for the negative login case.
- **Steps:**
  1. `POST /api/auth/login` with the admin email and correct local password.
  2. Repeat with the wrong password.
  3. `GET /api/students` with no `Authorization` header, then with a malformed
     bearer token.
  4. `POST /api/fees` as teacher using a valid local teacher token and a
     same-school synthetic student.
- **Expected result:** Correct login returns a token; bad credentials and
  missing/invalid tokens are rejected; teacher fee write is denied (403);
  no rejected request creates or changes data.
- **Actual result:** *(blank)*
- **Status:** Not Run
- **Defect reference:** None

### API-AUTH-02 — Logout and password-change token invalidation

- **Priority:** P0
- **Feature:** Session revocation
- **Prerequisites:** Local admin account and a valid local bearer token.
- **Synthetic test data:** `admin@greenvalley.example`; a fresh local-only
  replacement password generated for this run.
- **Steps:**
  1. `POST /api/auth/logout` with the valid token.
  2. Repeat `GET /api/students` with that token.
  3. Log in again and retain the new token; `POST /api/auth/password/change`
     with that token and the current/new synthetic passwords.
  4. Repeat an authenticated request using the token from step 3.
  5. Attempt login with the old password, then with the new password.
- **Expected result:** Logout succeeds and invalidates the token. Password
  change succeeds and invalidates previously issued tokens; subsequent login
  rejects the old password and accepts the new password.
- **Actual result:** *(blank)*
- **Status:** Not Run
- **Defect reference:** None

### API-AUTH-03 — Password recovery token lifecycle

- **Priority:** P0
- **Feature:** Password recovery
- **Prerequisites:** Local test mode and a synthetic account; do not configure
  real SMTP for this check.
- **Synthetic test data:** `admin@greenvalley.example`; a fresh local-only
  password generated for this run.
- **Steps:**
  1. `POST /api/auth/forgot-password` with the synthetic email.
  2. Use the reset token returned by local test mode in
     `POST /api/auth/reset-password`.
  3. Attempt to reuse the same token.
  4. Log in with the new password.
- **Expected result:** Local test flow issues a reset token; the first reset
  succeeds; token reuse is rejected; login succeeds with the new password.
  Do not record the token in this checklist.
- **Actual result:** *(blank)*
- **Status:** Not Run
- **Defect reference:** None

### API-STU-01 — Student validation, duplicate key, and persistence

- **Priority:** P0
- **Feature:** Student data integrity
- **Prerequisites:** Local disposable SQLite database; admin token; class and
  school Alpha fixtures exist.
- **Synthetic test data:** Student `Maya Test`, admission number
  `TST-ADM-001`; an empty name, malformed date, and duplicate number for
  negative cases.
- **Steps:**
  1. `POST /api/students` with the valid synthetic student.
  2. Repeat with a blank `name`.
  3. Repeat with a malformed `dateOfBirth`.
  4. Submit another student using the same admission number.
  5. `GET /api/students` and confirm only one record with that admission
     number is present.
- **Expected result:** Valid student is created and persists; invalid name/date
  is rejected; duplicate school admission number conflicts or is rejected;
  no invalid/duplicate record is stored.
- **Actual result:** *(blank)*
- **Status:** Not Run
- **Defect reference:** None

### API-TEN-01 — Cross-school isolation

- **Priority:** P0
- **Feature:** School/tenant isolation
- **Prerequisites:** **Requires a second school and account.** Use a separate disposable SQLite
test database containing both School Alpha and School Beta, established
with reviewed local-only fixture setup, plus each admin account and
synthetic records. No public school-creation API exists.
- **Synthetic test data:** School Alpha student `STU-A-001`; School Beta
  student `STU-B-001`; School Alpha and Beta admin accounts.
- **Steps:**
  1. Authenticate as Alpha admin; request `/api/students` and record returned
     IDs.
  2. Authenticate as Beta admin; request `/api/students` and record returned
     IDs.
  3. Using the Alpha token, request
     `GET /api/students/<STU-B-001-id>`, then try to update and delete that
     record.
  4. Using the Alpha token, `POST /api/classes` with a unique class name and
     the Beta teacher ID in `teacherIds`.
- **Expected result:** Each school receives only its own records. Alpha
  cannot read, update, or delete Beta's record; cross-school relationships
  are rejected and neither school's data is changed.
- **Actual result:** *(blank)*
- **Status:** Not Run
- **Defect reference:** None

### API-TEN-02 — Parent, student, and teacher record scopes

- **Priority:** P0
- **Feature:** Authorization and linked-record isolation
- **Prerequisites:** **Requires linked accounts in one synthetic school.**
  Parent linked only to `STU-A-001`; student account linked to `STU-A-001`;
  teacher assigned to `Grade 7 Test`; `STU-A-002` belongs to another class.
- **Synthetic test data:** `STU-A-001`, `STU-A-002`, parent, student, and
  teacher test tokens.
- **Steps:**
  1. As parent, `GET /api/students` and `GET /api/fees`; confirm only linked
     child data is returned.
  2. As student, request `/api/students` and
     `/api/students/<STU-A-002-id>`.
  3. As teacher, request `/api/students/<STU-A-002-id>` and attempt a `PATCH`
     to it.
  4. As student, attempt `POST /api/attendance` for another student.
- **Expected result:** Parent sees only linked-child records; student sees
  only self and cannot create attendance; teacher cannot read or update an
  unassigned student's record. Denied record lookups may be returned as 404
  according to route scoping.
- **Actual result:** *(blank)*
- **Status:** Not Run
- **Defect reference:** None

### API-ATT-01 — Attendance status, duplicate, and boundary checks

- **Priority:** P1
- **Feature:** Attendance integrity
- **Prerequisites:** Local admin/teacher token; same-school synthetic student.
- **Synthetic test data:** `STU-A-001`; date `2026-10-12`; session
  `morning-test`; valid status `present`; invalid status `holiday`.
- **Steps:**
  1. `POST /api/attendance` with the valid student/date/session/status.
  2. Repeat the same student/date/session with status `absent`.
  3. In separate requests, try status `holiday`, omit the student ID, and
     submit an invalid date.
  4. `GET /api/attendance` and verify record count and stored values.
- **Expected result:** First record succeeds; duplicate returns conflict;
  invalid status, missing student, and invalid date are rejected; no invalid
  records are persisted.
- **Actual result:** *(blank)*
- **Status:** Not Run
- **Defect reference:** None

### API-CRUD-01 — Authorization boundaries for collection writes

- **Priority:** P1
- **Feature:** Role permissions
- **Prerequisites:** Valid synthetic teacher, parent, student, and admin
  tokens in School Alpha.
- **Synthetic test data:** Same-school class/student and test records with
  unique names.
- **Steps:**
  1. As teacher, attempt `POST /api/fees` with a valid student and amount.
  2. As parent and student, attempt `POST /api/students`.
  3. As teacher, attempt `DELETE /api/students/<STU-A-001-id>`.
  4. As non-admin, request `GET /api/audit-logs`.
  5. As unauthenticated client, request `GET /api/classes`.
- **Expected result:** Every unauthorized mutation/read is denied; no record
  changes; allowed-role requests continue to work. UI visibility is not used
  as an authorization check.
- **Actual result:** *(blank)*
- **Status:** Not Run
- **Defect reference:** None

### API-AUD-01 — Audit visibility and invalid filters

- **Priority:** P1
- **Feature:** Audit logs
- **Prerequisites:** Local admin token and a second non-admin account in the
  same test school.
- **Synthetic test data:** A harmless student create/update by the admin;
  invalid date filter `not-a-date`.
- **Steps:**
  1. Perform one student update and request
     `GET /api/audit-logs?page=1&limit=10`.
  2. Request `GET /api/audit-logs?from=not-a-date` as admin.
  3. Request `GET /api/audit-logs` as the non-admin.
- **Expected result:** Admin receives only same-school audit entries with
  valid pagination metadata; invalid date filter returns a client error;
  non-admin is denied; no other school's audit entry is exposed.
- **Actual result:** *(blank)*
- **Status:** Not Run
- **Defect reference:** None

### API-DB-01 — Migration, constraints, and restart persistence (SQLite)

- **Priority:** P0
- **Feature:** Database persistence and migrations
- **Prerequisites:** Local disposable SQLite file path does not already exist;
  local Node dependencies installed; no production database URL.
- **Synthetic test data:** School Alpha, admin, student `STU-A-001`, and one
  attendance record created through the local API.
- **Steps:**
  1. Start the backend with the dedicated SQLite path and confirm startup
     reports schema readiness.
  2. Create the synthetic school account and student/attendance records via
     their existing API routes.
  3. Stop the local server gracefully, then start it again with the same
     local SQLite path.
  4. `GET /api/students` and `/api/attendance` with the synthetic admin token.
  5. Attempt a duplicate admission number or attendance student/date/session.
- **Expected result:** Startup applies/recognizes migrations and succeeds;
  records remain after restart; duplicate constraints prevent duplicate
  records; no migration or foreign-key error is logged.
- **Actual result:** *(blank)*
- **Status:** Not Run
- **Defect reference:** None

### API-DB-02 — PostgreSQL migration and persistence smoke check

- **Priority:** P1
- **Feature:** PostgreSQL persistence support
- **Prerequisites:** **Requires PostgreSQL.** Dedicated, freshly provisioned,
  disposable database named with `test`; credentials supplied only through
  local environment variables. Consult `backend/README.md`; the test runner
  leaves the schema in place.
- **Synthetic test data:** Unique school, admin, student, and attendance
  records created only in that test database.
- **Steps:**
  1. Confirm the target is not a production or shared database and has no
     existing migration/legacy data.
  2. Start a local backend configured for the dedicated PostgreSQL database.
  3. Create and read a synthetic student and attendance record through the
     existing API; restart the backend and read them again.
  4. Attempt a duplicate admission number and duplicate attendance
     student/date/session.
- **Expected result:** Migrations and API writes succeed; data persists across
  restart; duplicate records are rejected; the target remains isolated from
  non-test data.
- **Actual result:** *(blank)*
- **Status:** Not Run
- **Defect reference:** None

### API-SCH-01 — School profile validation and persistence

- **Priority:** P1
- **Feature:** School profile and onboarding
- **Prerequisites:** Local admin token and School Alpha.
- **Synthetic test data:** Name `School Alpha Test Updated`; invalid blank
  name; invalid accent color `blue`.
- **Steps:**
  1. `GET /api/schools/me`.
  2. `PATCH /api/schools/me` with the synthetic name and a valid accent color
     such as `#237c78`.
  3. `GET /api/schools/me` again.
  4. In separate PATCH requests, submit a blank name and then accent color
     `blue`.
- **Expected result:** Admin reads and updates only their school profile;
  valid values persist; blank name and malformed color are rejected; other
  school settings remain unchanged.
- **Actual result:** *(blank)*
- **Status:** Not Run
- **Defect reference:** None

### API-CODE-01 — Student invite redemption and single use

- **Priority:** P1
- **Feature:** Invite codes and student account creation
- **Prerequisites:** School Alpha admin and student record; a fresh synthetic
  email not already used.
- **Synthetic test data:** Student `demo-student-amina`; a new `.example`
  student email and fresh local-only password generated for this run.
- **Steps:**
  1. As admin, `POST /api/invite-codes` with role `student` and the student
     ID; retain the code only in local test notes.
  2. `POST /api/auth/register-with-code` with the code, synthetic account
     details, and role `student`.
  3. Attempt to redeem the same code again with a different `.test` email.
  4. Log in as the created student and request the linked student record.
- **Expected result:** First redemption creates the linked student account;
  second redemption fails; the new student's read scope is limited to its
  own record. Do not paste the invite code or token into this document.
- **Actual result:** *(blank)*
- **Status:** Not Run
- **Defect reference:** None

### API-LIB-01 — Loan copy count and reference validation

- **Priority:** P1
- **Feature:** Library loan persistence
- **Prerequisites:** Local database and admin/teacher token; synthetic book
  and student belong to the same school.
- **Synthetic test data:** Book `BOOK-TEST-001`, one available copy;
  `STU-A-001`; loan dates `2026-10-12` to `2026-10-26`.
- **Steps:**
  1. `POST /api/library-loans` with the book/student/date fields.
  2. Read the book and loan using the existing `/api/library` and
     `/api/library-loans` routes.
  3. Mark the loan returned using `PATCH /api/library-loans/<loan-id>`.
  4. In separate requests, attempt another loan with a nonexistent student
     ID and with a nonexistent book ID.
- **Expected result:** Loan creation decreases available copies atomically;
  return restores a copy; invalid references are rejected without orphaned
  loan records or incorrect copy counts.
- **Actual result:** *(blank)*
- **Status:** Not Run
- **Defect reference:** None

### API-EXAM-01 — Exam result score validation

- **Priority:** P1
- **Feature:** Examinations and results
- **Prerequisites:** Local admin or assigned-teacher token; same-school
  synthetic student and subject.
- **Synthetic test data:** `STU-A-001`; exam `Science Test`; score `18`,
  maximum `20`; invalid scores `-1` and `21`.
- **Steps:**
  1. `POST /api/exams` with the valid student, subject, exam name, score, and
     maximum score.
  2. `GET /api/exams` and confirm the result is present.
  3. Try to create results with score `-1` and score `21` for maximum `20`.
- **Expected result:** Valid result is saved and readable; scores below zero
  or above maximum are rejected; invalid results are not persisted.
- **Actual result:** *(blank)*
- **Status:** Not Run
- **Defect reference:** None

### API-CAL-01 — Event and timetable input validation

- **Priority:** P1
- **Feature:** Events and timetable
- **Prerequisites:** Local admin token; a same-school class and optional
  teacher fixture.
- **Synthetic test data:** Event `Sports Day Test`, date `2026-11-20`;
  invalid date `not-a-date`; timetable entry for `Grade 7 Test`, Monday,
  `09:00`–`09:40`; invalid day `Sunday`, invalid range `10:00`–`09:00`.
- **Steps:**
  1. `POST /api/events` with the valid name/date and verify it appears in
     `GET /api/events`.
  2. Try an event with the invalid date.
  3. `POST /api/timetable` with the valid weekday and time range and verify it
     appears in `GET /api/timetable`.
  4. Try timetable records with Sunday and with end time before start time.
- **Expected result:** Valid records are saved; malformed event date,
  unsupported weekday, and reversed time range are rejected and do not
  create records.
- **Actual result:** *(blank)*
- **Status:** Not Run
- **Defect reference:** None

### API-CHAT-01 — Chat membership and message ownership

- **Priority:** P1
- **Feature:** Chats and realtime messaging
- **Prerequisites:** Synthetic admin, member, and non-member accounts in one
  school; authenticated local tokens.
- **Synthetic test data:** Chat `Grade 7 Test Chat`; message `Synthetic test
  message`; non-member account `teacher-outsider@example.test`.
- **Steps:**
  1. As admin, `POST /api/chats` with the chat name and member account ID.
  2. As a member, `POST /api/chats/<chat-id>/messages` with the synthetic
     message; then read the chat messages.
  3. As the non-member, request the chat messages.
  4. As the non-member, attempt to edit and delete the member's message.
  5. As the message owner, edit the message and then soft-delete it.
- **Expected result:** Member can read/post and edit/delete only their own
  messages. A non-member cannot read the chat and cannot alter another
  user's message. Deletion preserves the message record as deleted with its
  text cleared.
- **Actual result:** *(blank)*
- **Status:** Not Run
- **Defect reference:** None

## Features blocked from manual workflow testing

These are deliberately not executable test cases because the inspected
inventory confirms the corresponding user-facing workflow is absent:

- **Invoice creation and payment collection/allocation:** `/api/fees` manages
  fee records, but no invoice or payment HTTP route exists. Database helper
  coverage does not make a browser/API payment workflow available. Create a
  test only after a supported route and user flow are implemented.
- **Guardian management:** guardian schema tables exist, but no guardian page
  or API route exists. Do not test invented guardian endpoints.

Student-authored assignment submission is also not part of the current
workflow: submission writes are restricted to admins/teachers, who manage
submission status and scores in the assignments page. The checklist tests
only that implemented workflow.

## Execution summary

| Date | Tester | Environment (local SQLite / dedicated test PostgreSQL) | Cases run | Pass | Fail | Blocked | Defect references |
|---|---|---|---:|---:|---:|---:|---|
| *(blank)* | *(blank)* | *(blank)* | *(blank)* | *(blank)* | *(blank)* | *(blank)* | *(blank)* |
