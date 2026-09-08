/* =========================================================
   Student portal — a single read-only dashboard covering a
   student's own attendance, exams, fees, timetable,
   assignments, and announcements. All data is scoped
   server-side to the logged-in student (see backend
   crudRouterFactory scopeForStudent), so no client-side
   filtering by studentId is needed here.
========================================================= */

const user = SmsAuth.getUser();

let data = {
  student: null,
  attendance: [],
  exams: [],
  fees: [],
  timetable: [],
  assignments: [],
  submissions: [],
  classes: [],
  announcements: [],
};

let activeTab = 'attendance';

async function loadAll() {
  const [
    students, attendance, exams, fees, timetable,
    assignments, submissions, classes, announcements,
  ] = await Promise.all([
    SmsAuth.apiFetch('/students').catch(() => []),
    SmsAuth.apiFetch('/attendance').catch(() => []),
    SmsAuth.apiFetch('/exams').catch(() => []),
    SmsAuth.apiFetch('/fees').catch(() => []),
    SmsAuth.apiFetch('/timetable').catch(() => []),
    SmsAuth.apiFetch('/assignments').catch(() => []),
    SmsAuth.apiFetch('/assignment-submissions').catch(() => []),
    SmsAuth.apiFetch('/classes').catch(() => []),
    SmsAuth.apiFetch('/announcements').catch(() => []),
  ]);

  data = {
    student: students.find(s => s.id === user.studentId) || null,
    attendance, exams, fees, timetable, assignments, submissions, classes, announcements,
  };

  if (data.student) {
    document.getElementById('portalSub').textContent = `${data.student.name} · ${data.student.class || 'No class assigned'}`;
  }
}

function classesById() {
  return Object.fromEntries(data.classes.map(c => [c.id, c]));
}

function renderTab() {
  const container = document.getElementById('portalContent');
  switch (activeTab) {
    case 'attendance':
      PortalViews.renderAttendance(container, data.attendance);
      break;
    case 'exams':
      PortalViews.renderExams(container, data.exams);
      break;
    case 'fees':
      PortalViews.renderFees(container, data.fees);
      break;
    case 'timetable':
      PortalViews.renderTimetable(container, data.timetable);
      break;
    case 'assignments':
      PortalViews.renderAssignments(container, data.assignments, data.submissions, classesById(), {}, user.studentId);
      break;
    case 'announcements':
      PortalViews.renderAnnouncements(container, data.announcements);
      break;
  }
}

document.getElementById('portalTabs').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-tab]');
  if (!btn) return;
  activeTab = btn.dataset.tab;
  document.querySelectorAll('.portal-tab').forEach(t => t.classList.toggle('is-active', t === btn));
  renderTab();
});

async function init() {
  try {
    await loadAll();
    renderTab();
  } catch (err) {
    document.getElementById('portalContent').innerHTML = `<div class="error-state">Couldn't load your portal: ${err.message}</div>`;
  }
}

init();
