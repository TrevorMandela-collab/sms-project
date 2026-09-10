/* =========================================================
   Teacher Portal — "My Classes" and "My Timetable".
   A class is "mine" if my teacherId is in that class's
   teacherIds list (assigned by an admin on the Classes &
   Subjects page). My timetable is every slot whose teacherId
   matches me directly. Requires auth-client.js + auth-guard.js
   loaded first, plus shared/portal-views.js for the timetable
   grid renderer.
========================================================= */

const user = SmsAuth.getUser();

let myClasses = [];
let subjectsState = [];
let studentsState = [];
let timetableState = [];

async function init() {
  if (!user || user.role !== 'teacher') {
    // Not a teacher account — nothing to show here.
    document.getElementById('classesContainer').innerHTML =
      `<div class="empty-state">This page is for teacher accounts only.</div>`;
    return;
  }

  if (!user.teacherId) {
    document.getElementById('classesContainer').innerHTML = `
      <div class="empty-state">
        Your login isn't linked to a teacher record yet — ask your admin to link it
        from the Manage Logins page, then log out and back in.
      </div>`;
    document.getElementById('timetableContainer').innerHTML =
      `<div class="empty-state">Nothing to show until your account is linked.</div>`;
    return;
  }

  try {
    const [classes, subjects, students, timetable] = await Promise.all([
      SmsAuth.apiFetch('/classes'),
      SmsAuth.apiFetch('/subjects'),
      SmsAuth.apiFetch('/students'),
      SmsAuth.apiFetch('/timetable'),
    ]);
    subjectsState = subjects;
    studentsState = students;
    myClasses = classes.filter(c => (c.teacherIds || []).includes(user.teacherId));
    timetableState = timetable.filter(t => t.teacherId === user.teacherId);
  } catch (err) {
    document.getElementById('classesContainer').innerHTML =
      `<div class="error-state">Couldn't load your classes: ${err.message}</div>`;
    return;
  }

  renderClasses();
  renderTimetable();
}

function subjectName(id) {
  const s = subjectsState.find(s => s.id === id);
  return s ? s.name : null;
}

function studentsInClass(className) {
  return studentsState.filter(s => s.class === className).sort((a, b) => a.name.localeCompare(b.name));
}

function renderClasses() {
  const container = document.getElementById('classesContainer');

  if (!myClasses.length) {
    container.innerHTML = `<div class="empty-state">You haven't been assigned to any classes yet — ask your admin to add you on the Classes & Subjects page.</div>`;
    return;
  }

  container.innerHTML = `
    <div class="class-card-grid">
      ${myClasses.map(c => {
        const roster = studentsInClass(c.name);
        const subjectChips = (c.subjectIds || []).map(subjectName).filter(Boolean);
        return `
          <div class="class-card">
            <h3>${c.name}</h3>
            <div class="class-card-meta">${roster.length} student${roster.length === 1 ? '' : 's'}</div>
            <div class="class-card-subjects">
              ${subjectChips.length
                ? subjectChips.map(s => `<span class="tag-chip tag-chip--info">${s}</span>`).join('')
                : `<span class="chalk-sub" style="font-size:0.75rem;">No subjects listed</span>`}
            </div>
            <button class="class-card-roster-toggle" data-toggle-roster="${c.id}">Show Roster</button>
            <div class="class-card-roster" id="roster-${c.id}">
              <ul>
                ${roster.length
                  ? roster.map(s => `<li>${s.name}</li>`).join('')
                  : '<li>No students in this class yet.</li>'}
              </ul>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;

  container.querySelectorAll('[data-toggle-roster]').forEach(btn => {
    btn.addEventListener('click', () => {
      const panel = document.getElementById(`roster-${btn.dataset.toggleRoster}`);
      const isOpen = panel.classList.toggle('is-open');
      btn.textContent = isOpen ? 'Hide Roster' : 'Show Roster';
    });
  });
}

function renderTimetable() {
  const container = document.getElementById('timetableContainer');
  PortalViews.renderTimetable(container, timetableState);
}

/* ---------- Tabs ---------- */
document.querySelectorAll('.portal-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.portal-tab').forEach(b => b.classList.toggle('is-active', b === btn));
    document.getElementById('classesTab').style.display = btn.dataset.tab === 'classes' ? '' : 'none';
    document.getElementById('timetableTab').style.display = btn.dataset.tab === 'timetable' ? '' : 'none';
  });
});

/* ---------- Init ---------- */
init();
