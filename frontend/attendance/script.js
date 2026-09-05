/* =========================================================
   Attendance module — School Management System
   Marking is admin/teacher only (gated in HTML + backend).
   Parents see history auto-scoped to their own children by
   the backend, regardless of filters here.
========================================================= */

let allStudents = [];
let allAttendance = [];
let currentStatuses = {}; // studentId -> status, for the currently selected class/date
let existingRecordIds = {}; // studentId -> attendance record id (for updates vs creates)

const user = SmsAuth.getUser();
const canMark = user && ['admin', 'teacher'].includes(user.role);

/* ---------- Init ---------- */
async function init() {
  document.getElementById('historyTitle').textContent = user.role === 'parent' ? "Your Children's Attendance" : 'Attendance History';

  try {
    allStudents = await SmsAuth.apiFetch('/students');
  } catch (err) {
    allStudents = [];
  }

  if (canMark) {
    populateClassSelect();
    setDefaultDate();
    document.getElementById('classSelect').addEventListener('change', renderMarkingTable);
    document.getElementById('dateSelect').addEventListener('change', renderMarkingTable);
    document.getElementById('saveAttendanceBtn').addEventListener('click', saveAttendance);
    await renderMarkingTable();
  }

  await loadHistory();
}

function populateClassSelect() {
  const select = document.getElementById('classSelect');
  const classes = [...new Set(allStudents.map(s => s.class).filter(Boolean))].sort();
  select.innerHTML = classes.map(c => `<option value="${c}">${c}</option>`).join('') || '<option value="">No classes yet</option>';
}

function setDefaultDate() {
  document.getElementById('dateSelect').value = new Date().toISOString().slice(0, 10);
}

/* ---------- Marking table ---------- */
async function renderMarkingTable() {
  const className = document.getElementById('classSelect').value;
  const date = document.getElementById('dateSelect').value;
  const students = allStudents.filter(s => s.class === className);
  const tbody = document.getElementById('attendanceTableBody');

  if (!className) {
    tbody.innerHTML = `<tr><td colspan="2"><div class="empty-state">Add students to a class first (Students module).</div></td></tr>`;
    renderSummary([]);
    return;
  }

  tbody.innerHTML = `<tr><td colspan="2"><div class="loading-state">Loading…</div></td></tr>`;

  let recordsForDay = [];
  try {
    const all = await SmsAuth.apiFetch('/attendance');
    recordsForDay = all.filter(r => r.date === date && r.className === className);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="2"><div class="error-state">Couldn't load attendance: ${err.message}</div></td></tr>`;
    return;
  }

  currentStatuses = {};
  existingRecordIds = {};
  students.forEach(s => {
    const existing = recordsForDay.find(r => r.studentId === s.id);
    currentStatuses[s.id] = existing?.status || 'present';
    if (existing) existingRecordIds[s.id] = existing.id;
  });

  if (!students.length) {
    tbody.innerHTML = `<tr><td colspan="2"><div class="empty-state">No students found in ${className}.</div></td></tr>`;
    renderSummary([]);
    return;
  }

  tbody.innerHTML = students.map(s => `
    <tr>
      <td>${s.name}</td>
      <td>
        <div class="status-toggle" data-student="${s.id}">
          <button type="button" class="status-btn" data-status="present">Present</button>
          <button type="button" class="status-btn" data-status="late">Late</button>
          <button type="button" class="status-btn" data-status="absent">Absent</button>
        </div>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.status-toggle').forEach(toggle => {
    const studentId = toggle.dataset.student;
    updateToggleUI(toggle, currentStatuses[studentId]);
    toggle.querySelectorAll('.status-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        currentStatuses[studentId] = btn.dataset.status;
        updateToggleUI(toggle, btn.dataset.status);
        renderSummary(students);
      });
    });
  });

  renderSummary(students);
}

function updateToggleUI(toggle, status) {
  toggle.querySelectorAll('.status-btn').forEach(btn => {
    btn.classList.toggle('is-active', btn.dataset.status === status);
  });
}

function renderSummary(students) {
  const counts = { present: 0, absent: 0, late: 0 };
  students.forEach(s => {
    const status = currentStatuses[s.id] || 'present';
    counts[status] = (counts[status] || 0) + 1;
  });
  document.getElementById('attendanceSummary').innerHTML = `
    <span class="chip"><strong>${counts.present}</strong> present</span>
    <span class="chip"><strong>${counts.late}</strong> late</span>
    <span class="chip"><strong>${counts.absent}</strong> absent</span>
    <span class="chip"><strong>${students.length}</strong> total</span>
  `;
}

async function saveAttendance() {
  const className = document.getElementById('classSelect').value;
  const date = document.getElementById('dateSelect').value;
  const btn = document.getElementById('saveAttendanceBtn');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    const entries = Object.entries(currentStatuses);
    for (const [studentId, status] of entries) {
      const existingId = existingRecordIds[studentId];
      if (existingId) {
        await SmsAuth.apiFetch(`/attendance/${existingId}`, { method: 'PATCH', body: { status } });
      } else {
        await SmsAuth.apiFetch('/attendance', { method: 'POST', body: { studentId, className, date, status } });
      }
    }
    await renderMarkingTable();
    await loadHistory();
  } catch (err) {
    alert(`Couldn't save attendance: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Attendance';
  }
}

/* ---------- History ---------- */
async function loadHistory() {
  const tbody = document.getElementById('historyTableBody');
  tbody.innerHTML = `<tr><td colspan="5"><div class="loading-state">Loading history…</div></td></tr>`;

  try {
    allAttendance = await SmsAuth.apiFetch('/attendance');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="error-state">Couldn't load history: ${err.message}</div></td></tr>`;
    return;
  }

  const grouped = {};
  allAttendance.forEach(r => {
    const key = `${r.date}__${r.className}`;
    if (!grouped[key]) grouped[key] = { date: r.date, className: r.className, present: 0, absent: 0, late: 0 };
    grouped[key][r.status] = (grouped[key][r.status] || 0) + 1;
  });

  const rows = Object.values(grouped).sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 15);

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state">No attendance recorded yet.</div></td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(r => {
    const total = r.present + r.absent + r.late;
    const rate = total ? Math.round((r.present / total) * 100) : 0;
    const rateClass = rate >= 90 ? 'rate-good' : 'rate-bad';
    return `
      <tr>
        <td>${new Date(r.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</td>
        <td>${r.className}</td>
        <td>${r.present}</td>
        <td>${r.absent}</td>
        <td class="${rateClass}">${rate}%</td>
      </tr>
    `;
  }).join('');
}

init();
