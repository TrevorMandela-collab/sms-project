/* Mandela SMS - manual QA test cases (static data).
   Written from the real local code. Suite: Authentication and sessions. */
window.QA_TEST_CASES = [
  {
    id: "AUTH-001", suite: "Authentication and sessions",
    title: "Log in with a valid email and password",
    prerequisites: "Backend running. Demo account admin@greenvalley.example exists. You are logged out.",
    steps: ["Open the login page.", "Enter admin@greenvalley.example and the demo password.", "Click the login button."],
    expected: "You are logged in and taken into the app. The sidebar and your name appear."
  },
  {
    id: "AUTH-002", suite: "Authentication and sessions",
    title: "Log in with a wrong password",
    prerequisites: "You are logged out. Counts toward the login limit (see AUTH-004).",
    steps: ["Open the login page.", "Enter admin@greenvalley.example and a WRONG password.", "Click the login button."],
    expected: "Login is refused with the message: Invalid email or password. You are not logged in."
  },
  {
    id: "AUTH-003", suite: "Authentication and sessions",
    title: "Log in with an email that does not exist",
    prerequisites: "You are logged out. Counts toward the login limit.",
    steps: ["Open the login page.", "Enter nobody@example.com and any password.", "Click the login button."],
    expected: "The SAME message as AUTH-002: Invalid email or password. It must not reveal whether the account exists."
  },
  {
    id: "AUTH-004", suite: "Authentication and sessions",
    title: "Login rate limit blocks repeated attempts",
    prerequisites: "Run this test LAST. The limit is 10 login attempts per 15 minutes. Restarting the backend resets it.",
    steps: ["On the login page, submit a wrong password 11 times in a row."],
    expected: "After the limit, login is refused with: Too many login attempts. Try again later. Even the correct password is refused until the window passes."
  },
  {
    id: "AUTH-005", suite: "Authentication and sessions",
    title: "A suspended account cannot log in",
    prerequisites: "Logged in as admin. The Users and Roles page can suspend accounts (if it cannot, mark Blocked and note it).",
    steps: ["As admin, open Users and Roles and suspend teacher@greenvalley.example.", "Log out.", "Try to log in as the teacher."],
    expected: "Login is refused with a message that the account has been suspended and to contact the school admin."
  },
  {
    id: "AUTH-006", suite: "Authentication and sessions",
    title: "Suspending an account cuts off an already logged-in user",
    prerequisites: "Use two browsers (or one normal and one private window).",
    steps: ["Window A: log in as the teacher and stay on a page.", "Window B: log in as admin and suspend the teacher.", "Window A: reload the page or click another menu item."],
    expected: "The teacher is refused (suspended message / sent to login) on the next request. They do not keep working."
  },
  {
    id: "AUTH-007", suite: "Authentication and sessions",
    title: "A reactivated account can log in again",
    prerequisites: "AUTH-005 done, teacher is suspended.",
    steps: ["As admin, reactivate the teacher.", "Log out, then log in as the teacher."],
    expected: "The teacher logs in normally."
  },
  {
    id: "AUTH-008", suite: "Authentication and sessions",
    title: "Log out from the account menu",
    prerequisites: "Logged in as any demo account.",
    steps: ["Click the Mandela block at the top of the sidebar.", "Click Log out.", "Press the browser Back button."],
    expected: "You are sent to the login page. Going Back does not show protected data."
  },
  {
    id: "AUTH-009", suite: "Authentication and sessions",
    title: "Logout ends ALL sessions of that account",
    prerequisites: "Two browsers (or normal + private window).",
    steps: ["Window A and Window B: log in as the same account.", "Window A: log out.", "Window B: reload, then click another menu item."],
    expected: "Window B is no longer logged in (this session is no longer valid) and is sent to login."
  },
  {
    id: "AUTH-010", suite: "Authentication and sessions",
    title: "Protected page without being logged in",
    prerequisites: "You are logged out.",
    steps: ["Type the Students page address directly into the browser."],
    expected: "You are sent to the login page. No student data is shown."
  },
  {
    id: "AUTH-011", suite: "Authentication and sessions",
    title: "Registration is closed to the public after the first account",
    prerequisites: "You are logged out. The database already has users (demo seed).",
    steps: ["Open the register page.", "Fill in a new name, email and a password of 12+ characters.", "Submit."],
    expected: "Refused: Only an admin can create new accounts. No account is created."
  },
  {
    id: "AUTH-012", suite: "Authentication and sessions",
    title: "Forgot password: email left empty",
    prerequisites: "You are logged out.",
    steps: ["Open the forgot-password page.", "Leave the email empty and submit."],
    expected: "Error: Enter the email address for your account."
  },
  {
    id: "AUTH-013", suite: "Authentication and sessions",
    title: "Forgot password gives the same answer for known and unknown emails",
    prerequisites: "You are logged out. Limit: 5 reset requests per 15 minutes.",
    steps: ["Submit the forgot-password form with admin@greenvalley.example.", "Submit it again with nobody@example.com."],
    expected: "Both show the same message: If an account exists for that email, a reset link has been sent."
  },
  {
    id: "PLAT-001", suite: "Super Admin platform",
    title: "Open the platform command center",
    prerequisites: "Log in as platform-admin@mandela.example and open the Platform Overview module in QA Lab.",
    steps: ["Read the platform overview summary.", "Confirm the school directory and recent platform audit events load."],
    expected: "The page shows live platform data, and platform-only actions are available to the Super Admin."
  },
  {
    id: "PLAT-002", suite: "Super Admin platform",
    title: "Search the school directory",
    prerequisites: "At least two demo schools exist.",
    steps: ["Open Platform Overview.", "Search for a distinctive part of one school name.", "Clear the search."],
    expected: "Matching schools remain visible while non-matching schools are hidden; clearing the search restores the directory."
  },
  {
    id: "PLAT-003", suite: "Super Admin platform",
    title: "Export the school directory",
    prerequisites: "The platform directory contains at least one demo school.",
    steps: ["Open Platform Overview.", "Click Export CSV.", "Open the downloaded CSV file."],
    expected: "A CSV downloads with school directory data, readable headers, and no unrelated school-user or secret data."
  },
  {
    id: "PLAT-004", suite: "Super Admin platform",
    title: "Create a school with a unique name",
    prerequisites: "Use the isolated development demo database. Choose a name not already present.",
    steps: ["Enter a unique test school name.", "Submit Create school.", "Search for the new school."],
    expected: "The school is created once, appears in the directory, and has a stable identifier."
  },
  {
    id: "PLAT-005", suite: "Super Admin platform",
    title: "Reject a blank school name",
    prerequisites: "Logged in as Super Admin.",
    steps: ["Leave School name empty.", "Submit Create school."],
    expected: "The form or API rejects the request with clear feedback; no blank school is added."
  },
  {
    id: "PLAT-006", suite: "Super Admin platform",
    title: "Open and save school settings",
    prerequisites: "Use a newly created test school or record the demo school's original settings so they can be restored.",
    steps: ["Open Manage for a school.", "Review its current settings.", "Change one harmless setting and save.", "Close and reopen the details."],
    expected: "The saved value persists and the page gives clear success or error feedback."
  },
  {
    id: "PLAT-007", suite: "Super Admin platform",
    title: "Provision the first School Admin",
    prerequisites: "Create a separate test school first. Use a unique test email address.",
    steps: ["Open Manage for the test school.", "Create its first School Admin.", "Sign out and sign in with the new account."],
    expected: "The account is assigned to that school, receives the School Admin role, and lands in the school experience."
  },
  {
    id: "PLAT-008", suite: "Super Admin platform",
    title: "Suspend and reactivate a test school",
    prerequisites: "Use only a newly created test school, not Green Valley demo data.",
    steps: ["Suspend the test school.", "Confirm its status in the directory.", "Reactivate it."],
    expected: "The lifecycle status changes and returns to Active; the existing demo school remains unaffected."
  },
  {
    id: "TEN-001", suite: "Roles and school isolation",
    title: "School Admin cannot open platform administration",
    prerequisites: "Log in as school-admin@greenvalley.example.",
    steps: ["Open the platform URL directly.", "If available, request /api/schools/platform using the browser network panel."],
    expected: "The page redirects or shows access denied, and the API returns 403 without exposing the school directory."
  },
  {
    id: "TEN-002", suite: "Roles and school isolation",
    title: "School Admin sees only their school records",
    prerequisites: "Create two test schools and add records under each.",
    steps: ["Sign in as each school's School Admin.", "Open students, teachers, classes, and fees."],
    expected: "Each account sees records from its own school only."
  },
  {
    id: "TEN-003", suite: "Roles and school isolation",
    title: "Reject a cross-school record lookup",
    prerequisites: "Create records in two separate test schools and note a record ID from the other school.",
    steps: ["Sign in as the first school's School Admin.", "Request the other school's record URL directly."],
    expected: "The API returns not found or forbidden and does not disclose the other school's record."
  },
  {
    id: "TEN-004", suite: "Roles and school isolation",
    title: "Reject cross-school record writes",
    prerequisites: "Use an isolated test database and an ID belonging to another test school.",
    steps: ["As a School Admin, attempt to create or update a record using the foreign school ID.", "Inspect the response and refresh both schools' lists."],
    expected: "The server rejects the write and neither school's data is changed."
  },
  {
    id: "TEN-005", suite: "Roles and school isolation",
    title: "Teacher sees assigned classes only",
    prerequisites: "Use a teacher assigned to one test class and another class with a different teacher.",
    steps: ["Sign in as the teacher.", "Open timetable, assignments, attendance, and exam results."],
    expected: "Teacher data is limited to assigned classes and students; other classes cannot be opened by changing a URL or request ID."
  },
  {
    id: "TEN-006", suite: "Roles and school isolation",
    title: "Parent and student records stay linked",
    prerequisites: "Use the demo parent and student accounts.",
    steps: ["Sign in as the parent and review both linked children.", "Sign in as the student and open each student-facing section."],
    expected: "The parent sees only linked children; the student sees only their own records."
  },
  {
    id: "STU-001", suite: "Student management",
    title: "Load the student roster",
    prerequisites: "Sign in as a School Admin; the demo school has seeded students.",
    steps: ["Open Students.", "Wait for the roster to finish loading."],
    expected: "Real student records appear with readable names and class details; loading state clears."
  },
  {
    id: "STU-002", suite: "Student management",
    title: "Search the student roster",
    prerequisites: "At least two students are listed.",
    steps: ["Search for one student's distinctive name.", "Try a name that does not exist.", "Clear the search."],
    expected: "The matching student is shown, no-match feedback is clear, and clearing the search restores the roster."
  },
  {
    id: "STU-003", suite: "Student management",
    title: "Add a student with valid details",
    prerequisites: "Use the isolated development database and a unique test student name.",
    steps: ["Click Add Student.", "Enter the required name and class plus optional details.", "Save and search for the new student."],
    expected: "The new student appears once with the entered details and correct school association."
  },
  {
    id: "STU-004", suite: "Student management",
    title: "Validate required student fields",
    prerequisites: "Logged in as School Admin.",
    steps: ["Open Add Student.", "Leave a required field empty.", "Try to save."],
    expected: "The form identifies the missing value and does not create an incomplete record."
  },
  {
    id: "STU-005", suite: "Student management",
    title: "Generate a student registration invite",
    prerequisites: "A saved test student exists in the isolated development database.",
    steps: ["Open that student's invite action.", "Generate a code.", "Use Copy Code and Copy Message."],
    expected: "A one-time invite is shown for the intended student, copy actions work, and the code is not exposed to unrelated students."
  },
  {
    id: "STAFF-001", suite: "Teachers, classes and subjects",
    title: "Load and search the teacher directory",
    prerequisites: "Sign in as a School Admin; the demo school has a seeded teacher.",
    steps: ["Open Teachers.", "Search for the demo teacher.", "Search for a name with no match."],
    expected: "The teacher directory filters correctly and shows a clear empty result for a non-matching search."
  },
  {
    id: "STAFF-002", suite: "Teachers, classes and subjects",
    title: "Add a teacher with subjects",
    prerequisites: "Use a unique test teacher in the isolated development database.",
    steps: ["Click Add Teacher.", "Enter the required name, contact, and one or more subjects.", "Save and search for the teacher."],
    expected: "The teacher appears with the saved details and subject list."
  },
  {
    id: "STAFF-003", suite: "Teachers, classes and subjects",
    title: "Create a class and assign school relationships",
    prerequisites: "At least one teacher and subject exist in the same test school.",
    steps: ["Open Classes & Subjects.", "Add a uniquely named test class.", "Assign the existing teacher and subject.", "Save and reopen the class."],
    expected: "The class and its relationships persist; a teacher or subject from another school is rejected."
  },
  {
    id: "STAFF-004", suite: "Teachers, classes and subjects",
    title: "Add and search a subject",
    prerequisites: "Sign in as School Admin.",
    steps: ["Open the Subjects tab.", "Add a unique subject name and code.", "Search by name and then by code."],
    expected: "The subject is saved once and both searches locate it."
  },
  {
    id: "STAFF-005", suite: "Teachers, classes and subjects",
    title: "Switch between Classes and Subjects tabs",
    prerequisites: "Open Classes & Subjects.",
    steps: ["Select Classes.", "Select Subjects.", "Use search in each tab."],
    expected: "The selected tab is clear, displays the correct records, and keeps its search controls in the proper section."
  },
  {
    id: "STAFF-006", suite: "Teachers, classes and subjects",
    title: "Non-admin roles cannot create staff or classes",
    prerequisites: "Log in as a teacher, parent, or student.",
    steps: ["Open Teachers and Classes & Subjects directly.", "Try to reveal or invoke Add Teacher, Add Class, and Add Subject."],
    expected: "Create controls are hidden or disabled and protected API requests are denied."
  },
  {
    id: "ATT-001", suite: "Attendance",
    title: "Load attendance for a class and date",
    prerequisites: "A class with students exists.",
    steps: ["Open Attendance.", "Select a class and date.", "Review the student attendance list."],
    expected: "The page shows only students in the selected authorized class and a clear state when no records exist."
  },
  {
    id: "ATT-002", suite: "Attendance",
    title: "Mark and save attendance",
    prerequisites: "Use a test date in the isolated development database.",
    steps: ["Choose a class and test date.", "Set different students to present, absent, late, or excused.", "Save Attendance.", "Reload the page."],
    expected: "Saved statuses persist for the correct students, class, date, and session."
  },
  {
    id: "ATT-003", suite: "Attendance",
    title: "Prevent duplicate attendance records",
    prerequisites: "Attendance already exists for a student, date, and session.",
    steps: ["Try to create a duplicate record for the same student/date/session.", "Review the response and history."],
    expected: "The duplicate is rejected with a helpful explanation; the existing attendance is unchanged."
  },
  {
    id: "ATT-004", suite: "Attendance",
    title: "Review attendance history",
    prerequisites: "At least one attendance session has been saved.",
    steps: ["Open Attendance History.", "Change the class or date filter if available.", "Compare the displayed records with the saved session."],
    expected: "History reflects real saved records and filtering does not show another school's data."
  },
  {
    id: "ATT-005", suite: "Attendance",
    title: "Parent and student attendance views are scoped",
    prerequisites: "Use a parent account with linked children and a student account.",
    steps: ["Open Attendance as the parent.", "Open Attendance as the student.", "Try a record URL for an unrelated student."],
    expected: "Each account sees only authorized attendance and cannot retrieve an unrelated student's record."
  },
  {
    id: "FEE-001", suite: "Fees and finance",
    title: "Load the fee ledger and real totals",
    prerequisites: "The demo school has fee records.",
    steps: ["Open Fees as School Admin.", "Review the ledger and summary values."],
    expected: "Displayed rows and totals reflect saved fee data rather than placeholder statistics."
  },
  {
    id: "FEE-002", suite: "Fees and finance",
    title: "Search the fee ledger",
    prerequisites: "At least two fee records exist.",
    steps: ["Search for a student's name.", "Search for a non-existent name.", "Clear the search."],
    expected: "Rows filter to the matching student; no-match and reset states are clear."
  },
  {
    id: "FEE-003", suite: "Fees and finance",
    title: "Record a fee for a student",
    prerequisites: "Use a test student in the isolated development database.",
    steps: ["Click Record Payment.", "Choose the student, enter a valid amount and due date, and select a status.", "Save and reload."],
    expected: "The fee appears once with the saved amount, due date, and status."
  },
  {
    id: "FEE-004", suite: "Fees and finance",
    title: "Reject invalid fee amounts and statuses",
    prerequisites: "Open the Record Payment form.",
    steps: ["Try a negative amount, malformed amount, and an unsupported status.", "Submit each invalid value."],
    expected: "Invalid values are rejected with clear feedback and no invalid fee is saved."
  },
  {
    id: "FEE-005", suite: "Fees and finance",
    title: "Export fees and verify role boundaries",
    prerequisites: "A fee ledger is available and a parent account is available.",
    steps: ["Export the School Admin fee ledger to CSV.", "Open Fees as a parent and as a student.", "Try to record a payment as a non-admin."],
    expected: "The export contains the authorized fee rows; parent/student data is scoped to linked records and payment controls are unavailable."
  },
  {
    id: "ACAD-001", suite: "Academics, assignments and timetable",
    title: "Create and find an assignment",
    prerequisites: "A test class and subject exist.",
    steps: ["Open Assignments.", "Create a uniquely named assignment with class, subject, due date, and max score.", "Search for its title."],
    expected: "The assignment appears once with the correct class, subject, due date, and score limit."
  },
  {
    id: "ACAD-002", suite: "Academics, assignments and timetable",
    title: "Review and save assignment submissions",
    prerequisites: "An assignment and at least one enrolled student exist.",
    steps: ["Open the assignment's submissions.", "Enter a valid score and feedback for a test submission.", "Save All and reopen."],
    expected: "The score and feedback persist and stay attached to the right student and assignment."
  },
  {
    id: "ACAD-003", suite: "Academics, assignments and timetable",
    title: "Record and validate an exam score",
    prerequisites: "Use a test student in the isolated development database.",
    steps: ["Open Exams & Grades.", "Add a score between zero and its maximum.", "Try a negative score and a score above the maximum."],
    expected: "A valid score is saved; out-of-range scores are rejected and do not alter saved results."
  },
  {
    id: "ACAD-004", suite: "Academics, assignments and timetable",
    title: "Search exam results",
    prerequisites: "At least one exam result exists.",
    steps: ["Search by student name.", "Search by subject.", "Clear the search."],
    expected: "The ledger filters by student or subject and restores all authorized records when cleared."
  },
  {
    id: "ACAD-005", suite: "Academics, assignments and timetable",
    title: "Create a timetable period",
    prerequisites: "A class, subject, and teacher exist in the same test school.",
    steps: ["Open Timetable.", "Add a test period with day, start/end times, class, subject, and teacher.", "Save and revisit the day."],
    expected: "The period appears at the correct time and invalid time ranges or cross-school references are rejected."
  },
  {
    id: "ACAD-006", suite: "Academics, assignments and timetable",
    title: "Teacher timetable is limited to assigned classes",
    prerequisites: "The teacher has one assigned class and another class belongs to a different teacher.",
    steps: ["Sign in as the teacher.", "Open Timetable and select available classes.", "Request an unassigned class period directly if possible."],
    expected: "Only assigned-class periods are visible and direct requests for other classes are denied or empty."
  },
  {
    id: "ACAD-007", suite: "Academics, assignments and timetable",
    title: "Parent and student can review academic work",
    prerequisites: "A linked student has an assignment and exam result.",
    steps: ["Open Assignments and Exams as the student.", "Repeat as the linked parent.", "Try to open another student's result."],
    expected: "The linked student and parent see the correct records; unrelated student data remains hidden."
  },
  {
    id: "COMMS-001", suite: "Communication, events and chat",
    title: "Publish and search an announcement",
    prerequisites: "Sign in as a School Admin or teacher.",
    steps: ["Create an announcement with a unique title and message.", "Select an audience and publish.", "Search for the title."],
    expected: "The announcement appears once with the chosen audience and can be found by search."
  },
  {
    id: "COMMS-002", suite: "Communication, events and chat",
    title: "Validate announcement fields",
    prerequisites: "Open the new announcement form.",
    steps: ["Try to publish with a blank title or message.", "Then enter valid text and cancel before publishing."],
    expected: "Missing required content is rejected and Cancel closes the form without creating a record."
  },
  {
    id: "COMMS-003", suite: "Communication, events and chat",
    title: "Create and filter an event",
    prerequisites: "Sign in as an authorized school user.",
    steps: ["Create a uniquely named event with a future date/time.", "Search for it.", "Switch Upcoming, Past, and All events filters."],
    expected: "The event is shown in the appropriate range, search works, and the event remains saved after reload."
  },
  {
    id: "COMMS-004", suite: "Communication, events and chat",
    title: "Open and join a school chat",
    prerequisites: "A School Admin has created a test chat and shared its invite code with a test participant.",
    steps: ["Join using the valid code.", "Open the chat list.", "Try using an invalid code."],
    expected: "The authorized participant joins once, sees the chat, and an invalid code is rejected."
  },
  {
    id: "COMMS-005", suite: "Communication, events and chat",
    title: "Send, reply to, and react to a message",
    prerequisites: "Two authorized test users are members of the same test chat.",
    steps: ["Send a message.", "Reply to it from the other user.", "Add a supported reaction and toggle it off."],
    expected: "Messages and quoted reply render correctly; supported reactions update without reloading or duplicating."
  },
  {
    id: "COMMS-006", suite: "Communication, events and chat",
    title: "Chat content is safe from script injection",
    prerequisites: "Open a test chat as an authorized member and open browser developer tools.",
    steps: ["Send message text containing <img src=x onerror=alert(1)>.", "Use a hostile display-name test account if available.", "Inspect the message and page DOM."],
    expected: "Hostile input is rendered as text or rejected; no injected image or inline handler executes."
  },
  {
    id: "COMMS-007", suite: "Communication, events and chat",
    title: "Chat delete reports errors safely",
    prerequisites: "Use a newly created test chat in the isolated development database and note any messages it contains.",
    steps: ["Attempt to delete the test chat.", "Observe the confirmation and result.", "Check the API response and verify the chat list after reload."],
    expected: "Deletion succeeds cleanly or presents an actionable error; there is no raw database error, server crash, or misleading success."
  },
  {
    id: "PORT-001", suite: "Student, parent and teacher portals",
    title: "Student portal tabs load real records",
    prerequisites: "Log in as student@greenvalley.example.",
    steps: ["Open Attendance, Exams & Results, Fees, Timetable, Assignments, and Announcements tabs."],
    expected: "Each tab loads the student's real authorized records and gives a useful empty state when none exist."
  },
  {
    id: "PORT-002", suite: "Student, parent and teacher portals",
    title: "Parent switches between linked children",
    prerequisites: "Log in as parent@greenvalley.example with the two seeded linked students.",
    steps: ["Open the parent portal.", "Select each child in turn.", "Compare attendance, fees, exams, and assignments."],
    expected: "Each selection shows that child's data only and switching children refreshes every relevant section."
  },
  {
    id: "PORT-003", suite: "Student, parent and teacher portals",
    title: "Teacher portal shows assigned classes",
    prerequisites: "Log in as teacher@greenvalley.example with an assigned class.",
    steps: ["Open My Classes.", "Open class or student details available from the portal."],
    expected: "The teacher sees assigned class information and cannot browse another teacher's classes."
  },
  {
    id: "PORT-004", suite: "Student, parent and teacher portals",
    title: "Role login lands on the correct home page",
    prerequisites: "Log out between each test account.",
    steps: ["Log in as Super Admin, School Admin, teacher, parent, and student in turn."],
    expected: "Each role lands on its intended platform, school dashboard, teacher portal, parent portal, or student portal."
  },
  {
    id: "PORT-005", suite: "Student, parent and teacher portals",
    title: "Portal direct links enforce authorization",
    prerequisites: "Have one session for each supported role.",
    steps: ["Paste direct URLs for Platform, Student Portal, Parent Portal, and Teacher Portal while signed in as other roles."],
    expected: "Protected pages redirect or deny access according to role; hiding a navigation link is not the only protection."
  },
  {
    id: "SET-001", suite: "Settings, profile and audit",
    title: "Save profile changes",
    prerequisites: "Sign in with a demo account in the isolated development database.",
    steps: ["Open Settings.", "Change the display name to a test value and save.", "Reload the page."],
    expected: "The new name persists, appears in the account menu, and no password or token data is displayed."
  },
  {
    id: "SET-002", suite: "Settings, profile and audit",
    title: "Reject invalid profile updates",
    prerequisites: "Open profile settings.",
    steps: ["Try a blank name and malformed email address.", "Submit each invalid value."],
    expected: "Invalid profile values are rejected with clear feedback and the existing profile remains unchanged."
  },
  {
    id: "SET-003", suite: "Settings, profile and audit",
    title: "Save school branding settings",
    prerequisites: "Sign in as School Admin and record original demo school settings before editing.",
    steps: ["Change a harmless school contact or branding field.", "Save and reload.", "Restore the original setting."],
    expected: "Authorized changes persist, the restored value persists, and unauthorized roles cannot edit school settings."
  },
  {
    id: "SET-004", suite: "Settings, profile and audit",
    title: "Change password using valid and invalid current passwords",
    prerequisites: "Use a throwaway test account, not a shared demo account.",
    steps: ["Try changing the password with an incorrect current password.", "Then use the correct current password and a valid new password.", "Sign in with the new password."],
    expected: "The incorrect current password is rejected; the valid change succeeds and the new password works."
  },
  {
    id: "SET-005", suite: "Settings, profile and audit",
    title: "Review sensitive administrative audit events",
    prerequisites: "Create a school, update a school setting, provision an admin, and perform an authorized invite or user change in the demo environment.",
    steps: ["Open Audit Logs as a School Admin.", "Open platform audit events as Super Admin.", "Compare actor, action, and time."],
    expected: "Sensitive changes have accurate audit entries, school admins see only their school events, and platform events are restricted to Super Admin."
  },
  {
    id: "NAV-001", suite: "Search, notifications and navigation",
    title: "Open global search with Ctrl+K",
    prerequisites: "Log in as School Admin on a desktop keyboard.",
    steps: ["Press Ctrl+K.", "Type a real student name.", "Close the palette with Escape."],
    expected: "The palette opens, shows permission-aware matching records, supports keyboard dismissal, and returns focus to the page."
  },
  {
    id: "NAV-002", suite: "Search, notifications and navigation",
    title: "Use global search on a touch device",
    prerequisites: "Open a portal page at a mobile viewport or on a phone.",
    steps: ["Tap Search.", "Search for a student or fee record visible to the current role.", "Tap one result."],
    expected: "Search is usable without a hardware keyboard, results respect role and school access, and the selected result opens."
  },
  {
    id: "NAV-003", suite: "Search, notifications and navigation",
    title: "Open a notification action",
    prerequisites: "Use demo data that produces an attendance, fee, or exam alert.",
    steps: ["Open Notifications.", "Select an actionable alert.", "Mark alerts read and reopen the panel."],
    expected: "Alerts are based on real records, links open the relevant module, and read state is reflected."
  },
  {
    id: "NAV-004", suite: "Search, notifications and navigation",
    title: "Follow role-aware navigation links",
    prerequisites: "Sign in as each demo role in turn.",
    steps: ["Open and close the navigation, select each visible link, and use browser Back."],
    expected: "Links lead to the correct page, restricted items are absent, and browser navigation does not reveal protected content."
  },
  {
    id: "MOB-001", suite: "Mobile and accessibility",
    title: "Use the login page at 320 pixels wide",
    prerequisites: "Open the login page and set the browser viewport to 320 × 720.",
    steps: ["Check the page edges and form labels.", "Focus email and password.", "Tap Sign In with a test account."],
    expected: "No page-level horizontal scrolling or clipped text; controls remain readable and comfortably tappable."
  },
  {
    id: "MOB-002", suite: "Mobile and accessibility",
    title: "Use a dashboard at phone widths",
    prerequisites: "Sign in as School Admin and test viewport widths 360, 390, and 412 pixels.",
    steps: ["Open the dashboard at each width.", "Scroll through all dashboard sections.", "Open and close mobile navigation."],
    expected: "Cards reflow, menu opens and closes, text and actions remain visible, and the page has no unintended horizontal overflow."
  },
  {
    id: "MOB-003", suite: "Mobile and accessibility",
    title: "Use data tables on a phone",
    prerequisites: "Open Students, Fees, and the platform school directory at 320–412 pixels wide.",
    steps: ["Search and inspect each table.", "Try available row actions.", "Check whether any horizontal scrolling stays inside the table only."],
    expected: "Records remain readable and actionable without page-level horizontal scrolling or controls cut off-screen."
  },
  {
    id: "MOB-004", suite: "Mobile and accessibility",
    title: "Use forms and dialogs in portrait and landscape",
    prerequisites: "Test at 320 × 780 portrait and 780 × 360 landscape.",
    steps: ["Open student, event, and fee forms.", "Reach every field and action by scrolling.", "Close each form with its cancel control."],
    expected: "Dialogs fit within the viewport or scroll internally; fields and buttons remain reachable and easy to tap."
  },
  {
    id: "MOB-005", suite: "Mobile and accessibility",
    title: "Check tablet and desktop layouts",
    prerequisites: "Test viewport widths 768 pixels and 1280 pixels or wider.",
    steps: ["Open dashboard, directory tables, and portal pages.", "Resize between tablet and desktop widths."],
    expected: "Layouts reflow without overlap, clipped content, or unexpected horizontal page scrolling."
  },
  {
    id: "MOB-006", suite: "Mobile and accessibility",
    title: "Check keyboard focus and reduced motion",
    prerequisites: "Use a browser that supports keyboard navigation and reduced-motion preference.",
    steps: ["Navigate with Tab and Shift+Tab.", "Open and dismiss a modal and the command palette using the keyboard.", "Enable reduced motion and repeat."],
    expected: "Focus is visible and not trapped incorrectly; dialogs can be dismissed by keyboard and non-essential motion is reduced."
  },
  {
    id: "QA-001", suite: "QA Lab access and reporting",
    title: "Open QA Lab as an allowlisted Super Admin",
    prerequisites: "QA_OWNER_EMAILS includes platform-admin@mandela.example and the API has been restarted.",
    steps: ["Sign in as platform-admin@mandela.example.", "Open QA Lab from the development banner.", "Open Platform Overview in the QA workspace."],
    expected: "QA access succeeds and the Super Admin can load the platform workspace."
  },
  {
    id: "QA-002", suite: "QA Lab access and reporting",
    title: "Save a QA result and bug report",
    prerequisites: "QA Lab is open as an authorized owner in the Development environment.",
    steps: ["Mark a test Pass and enter an actual result.", "Wait for Saved.", "Report a low-severity test bug and reload."],
    expected: "The result and bug persist for the signed-in QA owner and appear in the appropriate lists."
  },
  {
    id: "QA-003", suite: "QA Lab access and reporting",
    title: "Deny non-allowlisted QA access",
    prerequisites: "A School Admin or teacher email is not included in QA_OWNER_EMAILS.",
    steps: ["Sign in as that user.", "Open the QA Lab URL directly.", "Request /api/qa/access."],
    expected: "The page shows Access restricted and the API returns 403; no test results or bug reports are exposed."
  },
  {
    id: "QA-004", suite: "QA Lab access and reporting",
    title: "Keep QA environments and owners isolated",
    prerequisites: "Two allowlisted QA users are available; use Development only.",
    steps: ["Save a result as the first owner.", "Sign in as the second owner and inspect results.", "Switch environments only if a safe configured backend is available."],
    expected: "The second owner cannot see or overwrite the first owner's results; unavailable Production remains disabled."
  }
];

window.QA_GAPS = [
  { suite: "Authentication and sessions", item: "Manual checks remain for /reset-password token expiry and one-time use, plus invite-code registration. The Settings password-change flow has a test case in the Settings suite." },
  { suite: "Authentication and sessions", item: "Login tokens last 7 days. Expiry cannot be checked manually in reasonable time." },
  { suite: "Authentication and sessions", item: "Logout ends every session of the account. There is no log out this device only option." },
  { suite: "Authentication and sessions", item: "No account lockout, only a rate limit on login attempts." },
  { suite: "Authentication and sessions", item: "In development, forgot-password returns the reset token in the response. Must never happen in production." },
  { suite: "Authentication and sessions", item: "No email verification step on new accounts." }
];