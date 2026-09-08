/* =========================================================
   Assignments module — School Management System
   Assignments are linked to a class (and optionally a subject).
   Submission tracking works off the class roster: a student
   "belongs" to a class if student.class matches the class's
   name (classes aren't yet a formal link on student records,
   just a shared text label — see project notes).
   Requires auth-client.js + auth-guard.js loaded first.
========================================================= */

const PAGE_SIZE = 8;

let assignmentsState = [];
let submissionsState = [];
let classesState = [];
let subjectsState = [];
let studentsState = [];

let currentPage = 1;
let searchTerm = '';
let classFilter = 'all';
let isLoading = true;
let loadError = null;

let activeAssignmentId = null; // which assignment the submissions modal is open for

/* ---------- Data loading ---------- */
async function loadAll() {
  isLoading = true;
  loadError = null;
  renderTable();
  try {
    [assignmentsState, submissionsState, classesState, subjectsState, studentsState] = await Promise.all([
      SmsAuth.apiFetch('/assignments'),
      SmsAuth.apiFetch('/assignment-submissions'),
      SmsAuth.apiFetch('/classes'),
      SmsAuth.apiFetch('/subjects'),
      SmsAuth.apiFetch('/students'),
    ]);
  } catch (err) {
    loadError = err.message;
  } finally {
    isLoading = false;
    populateClassFilter();
    renderStats();
    renderTable();
  }
}

function populateClassFilter() {
  const select = document.getElementById('classFilter');
  const currentValue = select.value;
  select.innerHTML = `<option value="all">All classes</option>` +
    classesState.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  select.value = [...classesState.map(c => c.id), 'all'].includes(currentValue) ? currentValue : 'all';
}

function renderStats() {
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById('statTotal').textContent = assignmentsState.length;
  document.getElementById('statUpcoming').textContent = assignmentsState.filter(a => a.dueDate >= today).length;
  document.getElementById('statOverdue').textContent = assignmentsState.filter(a => a.dueDate < today).length;
}

/* ---------- Helpers ---------- */
function className(id) {
  const c = classesState.find(c => c.id === id);
  return c ? c.name : '—';
}

function subjectName(id) {
  const s = subjectsState.find(s => s.id === id);
  return s ? s.name : '—';
}

function studentsInClass(classId) {
  const cls = classesState.find(c => c.id === classId);
  if (!cls) return [];
  return studentsState.filter(s => s.class === cls.name);
}

function submissionsFor(assignmentId) {
  return submissionsState.filter(s => s.assignmentId === assignmentId);
}

function submissionSummary(assignment) {
  const roster = studentsInClass(assignment.classId);
  const subs = submissionsFor(assignment.id);
  const submittedCount = subs.filter(s => s.submitted).length;
  return { submittedCount, total: roster.length };
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/* ---------- Derived views ---------- */
function getFiltered() {
  return assignmentsState
    .filter(a => a.title.toLowerCase().includes(searchTerm.toLowerCase()))
    .filter(a => classFilter === 'all' || a.classId === classFilter)
    .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
}

/* ---------- Rendering ---------- */
function renderTable() {
  const tbody = document.getElementById('assignmentsTableBody');
  const user = SmsAuth.getUser();
  const canManage = user && ['admin', 'teacher'].includes(user.role);

  if (isLoading) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="loading-state">Loading assignments…</div></td></tr>`;
    document.getElementById('pagination').innerHTML = '';
    return;
  }

  if (loadError) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="error-state">Couldn't load assignments: ${loadError}</div></td></tr>`;
    document.getElementById('pagination').innerHTML = '';
    return;
  }

  const filtered = getFiltered();
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  currentPage = Math.min(currentPage, totalPages);
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);

  if (!pageItems.length) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state">No assignments match your filters.</div></td></tr>`;
  } else {
    const today = new Date().toISOString().slice(0, 10);
    tbody.innerHTML = pageItems.map(a => {
      const { submittedCount, total } = submissionSummary(a);
      const overdue = a.dueDate < today;
      return `
      <tr>
        <td>${a.title}</td>
        <td>${className(a.classId)}</td>
        <td>${subjectName(a.subjectId)}</td>
        <td>${formatDate(a.dueDate)}${overdue ? ' <span class="overdue-tag">Overdue</span>' : ''}</td>
        <td>${submittedCount}/${total}</td>
        <td>
          ${canManage ? `
            <div class="row-actions">
              <button class="icon-btn" data-track="${a.id}">Submissions</button>
              <button class="icon-btn" data-edit="${a.id}">Edit</button>
              <button class="icon-btn danger" data-delete="${a.id}">Delete</button>
            </div>
          ` : ''}
        </td>
      </tr>
    `;
    }).join('');
  }

  renderPagination(totalPages);

  tbody.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => openAssignmentModal(btn.dataset.edit));
  });
  tbody.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', () => deleteAssignment(btn.dataset.delete));
  });
  tbody.querySelectorAll('[data-track]').forEach(btn => {
    btn.addEventListener('click', () => openSubmissionsModal(btn.dataset.track));
  });
}

function renderPagination(totalPages) {
  const el = document.getElementById('pagination');
  let html = `<button id="prevPage" ${currentPage === 1 ? 'disabled' : ''}>‹</button>`;
  for (let i = 1; i <= totalPages; i++) {
    html += `<button data-page="${i}" class="${i === currentPage ? 'active-page' : ''}">${i}</button>`;
  }
  html += `<button id="nextPage" ${currentPage === totalPages ? 'disabled' : ''}>›</button>`;
  el.innerHTML = html;

  el.querySelector('#prevPage').addEventListener('click', () => { currentPage--; renderTable(); });
  el.querySelector('#nextPage').addEventListener('click', () => { currentPage++; renderTable(); });
  el.querySelectorAll('[data-page]').forEach(btn => {
    btn.addEventListener('click', () => { currentPage = Number(btn.dataset.page); renderTable(); });
  });
}

/* ---------- Assignment modal ---------- */
const assignmentOverlay = document.getElementById('assignmentModalOverlay');
const assignmentForm = document.getElementById('assignmentForm');

function populateAssignmentSelects(classId, subjectId) {
  const classSelect = document.getElementById('asgClass');
  classSelect.innerHTML = `<option value="">— Select —</option>` +
    classesState.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  classSelect.value = classId || '';

  const subjectSelect = document.getElementById('asgSubject');
  subjectSelect.innerHTML = `<option value="">— None —</option>` +
    subjectsState.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
  subjectSelect.value = subjectId || '';
}

function openAssignmentModal(id = null) {
  const record = id ? assignmentsState.find(a => a.id === id) : null;
  document.getElementById('modalTitle').textContent = record ? 'Edit Assignment' : 'Add Assignment';
  document.getElementById('assignmentId').value = record?.id || '';
  document.getElementById('asgTitle').value = record?.title || '';
  document.getElementById('asgDescription').value = record?.description || '';
  document.getElementById('asgDueDate').value = record?.dueDate || '';
  document.getElementById('asgMaxScore').value = record?.maxScore ?? 100;
  populateAssignmentSelects(record?.classId, record?.subjectId);
  assignmentOverlay.classList.add('is-open');
}

function closeAssignmentModal() {
  assignmentOverlay.classList.remove('is-open');
  assignmentForm.reset();
}

assignmentForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('assignmentId').value;
  const payload = {
    title: document.getElementById('asgTitle').value.trim(),
    description: document.getElementById('asgDescription').value.trim(),
    classId: document.getElementById('asgClass').value,
    subjectId: document.getElementById('asgSubject').value || null,
    dueDate: document.getElementById('asgDueDate').value,
    maxScore: Number(document.getElementById('asgMaxScore').value) || 100,
  };

  const submitBtn = assignmentForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Saving…';

  try {
    if (id) {
      await SmsAuth.apiFetch(`/assignments/${id}`, { method: 'PATCH', body: payload });
    } else {
      await SmsAuth.apiFetch('/assignments', { method: 'POST', body: payload });
    }
    closeAssignmentModal();
    await loadAll();
  } catch (err) {
    alert(`Couldn't save: ${err.message}`);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Save';
  }
});

async function deleteAssignment(id) {
  if (!confirm('Delete this assignment? Its submission records will also be removed. This cannot be undone.')) return;
  try {
    await SmsAuth.apiFetch(`/assignments/${id}`, { method: 'DELETE' });
    // Clean up any orphaned submission records for this assignment
    const orphaned = submissionsState.filter(s => s.assignmentId === id);
    await Promise.all(orphaned.map(s => SmsAuth.apiFetch(`/assignment-submissions/${s.id}`, { method: 'DELETE' })));
    await loadAll();
  } catch (err) {
    alert(`Couldn't delete: ${err.message}`);
  }
}

/* ---------- Submissions tracker modal ---------- */
const submissionsOverlay = document.getElementById('submissionsModalOverlay');

function openSubmissionsModal(assignmentId) {
  activeAssignmentId = assignmentId;
  const assignment = assignmentsState.find(a => a.id === assignmentId);
  if (!assignment) return;

  document.getElementById('submissionsModalTitle').textContent = `Submissions — ${assignment.title}`;
  document.getElementById('submissionsModalSub').textContent =
    `${className(assignment.classId)} · Due ${formatDate(assignment.dueDate)} · Max score ${assignment.maxScore}`;

  const roster = studentsInClass(assignment.classId);
  const list = document.getElementById('submissionsList');

  if (!roster.length) {
    list.innerHTML = `<p class="chalk-sub">No students found in this class (student "class" field must match the class name exactly).</p>`;
  } else {
    list.innerHTML = roster.map(student => {
      const existing = submissionsState.find(s => s.assignmentId === assignmentId && s.studentId === student.id);
      return `
        <div class="submission-row" data-student="${student.id}">
          <span class="submission-name">${student.name}</span>
          <label class="checkbox-item submission-checkbox">
            <input type="checkbox" class="submitted-check" ${existing?.submitted ? 'checked' : ''}>
            <span>Submitted</span>
          </label>
          <input type="number" class="score-input" min="0" max="${assignment.maxScore}" placeholder="Score" value="${existing?.score ?? ''}">
        </div>
      `;
    }).join('');
  }

  submissionsOverlay.classList.add('is-open');
}

function closeSubmissionsModal() {
  submissionsOverlay.classList.remove('is-open');
  activeAssignmentId = null;
}

async function saveAllSubmissions() {
  if (!activeAssignmentId) return;
  const saveBtn = document.getElementById('saveSubmissionsBtn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';

  const rows = document.querySelectorAll('#submissionsList .submission-row');
  try {
    for (const row of rows) {
      const studentId = row.dataset.student;
      const submitted = row.querySelector('.submitted-check').checked;
      const scoreVal = row.querySelector('.score-input').value;
      const score = scoreVal === '' ? null : Number(scoreVal);

      const existing = submissionsState.find(s => s.assignmentId === activeAssignmentId && s.studentId === studentId);
      const payload = {
        assignmentId: activeAssignmentId,
        studentId,
        submitted,
        submittedAt: submitted ? (existing?.submittedAt || new Date().toISOString()) : null,
        score,
      };

      if (existing) {
        await SmsAuth.apiFetch(`/assignment-submissions/${existing.id}`, { method: 'PATCH', body: payload });
      } else {
        await SmsAuth.apiFetch('/assignment-submissions', { method: 'POST', body: payload });
      }
    }
    submissionsState = await SmsAuth.apiFetch('/assignment-submissions');
    closeSubmissionsModal();
    renderTable();
  } catch (err) {
    alert(`Couldn't save submissions: ${err.message}`);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save All';
  }
}

/* ---------- Events ---------- */
document.getElementById('newAssignmentBtn').addEventListener('click', () => openAssignmentModal());
document.getElementById('cancelModalBtn').addEventListener('click', closeAssignmentModal);
assignmentOverlay.addEventListener('click', (e) => { if (e.target === assignmentOverlay) closeAssignmentModal(); });

document.getElementById('closeSubmissionsBtn').addEventListener('click', closeSubmissionsModal);
document.getElementById('saveSubmissionsBtn').addEventListener('click', saveAllSubmissions);
submissionsOverlay.addEventListener('click', (e) => { if (e.target === submissionsOverlay) closeSubmissionsModal(); });

document.getElementById('searchInput').addEventListener('input', (e) => {
  searchTerm = e.target.value;
  currentPage = 1;
  renderTable();
});

document.getElementById('classFilter').addEventListener('change', (e) => {
  classFilter = e.target.value;
  currentPage = 1;
  renderTable();
});

/* ---------- Init ---------- */
loadAll().then(() => {
  if (new URLSearchParams(window.location.search).get('action') === 'new') {
    openAssignmentModal();
  }
});
