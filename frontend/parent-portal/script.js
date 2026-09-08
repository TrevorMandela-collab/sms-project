/* =========================================================
   Parent portal — same read-only views as the student portal,
   but scoped to whichever of the parent's children is
   currently selected. The backend already limits every
   fetch to the parent's own childIds (see crudRouterFactory
   scopeForParent) — the child selector here just picks which
   one of those already-scoped records to display.
========================================================= */

const user = SmsAuth.getUser();

let data = {
  children: [],
  attendance: [],
  exams: [],
  fees: [],
  timetable: [],
  assignments: [],
  submissions: [],
  classes: [],
  announcements: [],
};

let selectedChildId = null;
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
    children: students.filter(s => (user.childIds || []).includes(s.id)),
    attendance, exams, fees, timetable, assignments, submissions, classes, announcements,
  };

  selectedChildId = data.children[0]?.id || null;
}

function renderChildSelector() {
  const el = document.getElementById('childSelector');
  if (data.children.length <= 1) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = data.children.map(c => `
    <button class="child-chip ${c.id === selectedChildId ? 'is-active' : ''}" data-child="${c.id}">
      ${c.name}${c.class ? ` · ${c.class}` : ''}
    </button>
  `).join('');

  el.querySelectorAll('[data-child]').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedChildId = btn.dataset.child;
      renderChildSelector();
      renderTab();
    });
  });
}

function classesById() {
  return Object.fromEntries(data.classes.map(c => [c.id, c]));
}

function currentChild() {
  return data.children.find(c => c.id === selectedChildId) || null;
}

function renderTab() {
  const container = document.getElementById('portalContent');
  const child = currentChild();

  if (!child) {
    PortalViews.empty(container, 'No linked student records found for your account yet.');
    return;
  }

  switch (activeTab) {
    case 'attendance':
      PortalViews.renderAttendance(container, data.attendance.filter(r => r.studentId === child.id));
      break;
    case 'exams':
      PortalViews.renderExams(container, data.exams.filter(r => r.studentId === child.id));
      break;
    case 'fees':
      PortalViews.renderFees(container, data.fees.filter(r => r.studentId === child.id));
      break;
    case 'timetable':
      PortalViews.renderTimetable(container, data.timetable.filter(t => t.className === child.class));
      break;
    case 'assignments': {
      const byId = classesById();
      const childClassIds = new Set(Object.values(byId).filter(c => c.name === child.class).map(c => c.id));
      const assignments = data.assignments.filter(a => childClassIds.has(a.classId));
      PortalViews.renderAssignments(container, assignments, data.submissions, byId, {}, child.id);
      break;
    }
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
    renderChildSelector();
    renderTab();
  } catch (err) {
    document.getElementById('portalContent').innerHTML = `<div class="error-state">Couldn't load your portal: ${err.message}</div>`;
  }
}

init();
