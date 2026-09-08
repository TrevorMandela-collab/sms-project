/* =========================================================
   Classes & Subjects module — School Management System
   Two linked collections in one page: classes reference a
   homeroom teacherId and an array of subjectIds; subjects
   are simple name+code records. Requires auth-client.js +
   auth-guard.js loaded first.
========================================================= */

const PAGE_SIZE = 8;

let classesState = [];
let subjectsState = [];
let teachersState = [];

let activeTab = 'classes';

let classSearchTerm = '';
let subjectSearchTerm = '';
let classPage = 1;
let subjectPage = 1;

let classesLoading = true;
let subjectsLoading = true;
let classesError = null;
let subjectsError = null;

/* ---------- Data loading ---------- */
async function loadAll() {
  await Promise.all([loadTeachers(), loadSubjects(), loadClasses()]);
}

async function loadTeachers() {
  try {
    teachersState = await SmsAuth.apiFetch('/teachers');
  } catch (err) {
    teachersState = [];
  }
}

async function loadSubjects() {
  subjectsLoading = true;
  subjectsError = null;
  renderSubjectsTable();
  try {
    subjectsState = await SmsAuth.apiFetch('/subjects');
  } catch (err) {
    subjectsError = err.message;
  } finally {
    subjectsLoading = false;
    renderStats();
    renderSubjectsTable();
  }
}

async function loadClasses() {
  classesLoading = true;
  classesError = null;
  renderClassesTable();
  try {
    classesState = await SmsAuth.apiFetch('/classes');
  } catch (err) {
    classesError = err.message;
  } finally {
    classesLoading = false;
    renderStats();
    renderClassesTable();
  }
}

function renderStats() {
  document.getElementById('statClasses').textContent = classesState.length;
  document.getElementById('statSubjects').textContent = subjectsState.length;
}

/* ---------- Helpers ---------- */
function teacherName(id) {
  const t = teachersState.find(t => t.id === id);
  return t ? t.name : '—';
}

function subjectName(id) {
  const s = subjectsState.find(s => s.id === id);
  return s ? s.name : null;
}

function classesUsingSubject(subjectId) {
  return classesState.filter(c => (c.subjectIds || []).includes(subjectId)).length;
}

/* ---------- Tabs ---------- */
document.querySelectorAll('.cs-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    activeTab = btn.dataset.tab;
    document.querySelectorAll('.cs-tab').forEach(b => b.classList.toggle('is-active', b === btn));
    document.getElementById('classesPanel').style.display = activeTab === 'classes' ? '' : 'none';
    document.getElementById('subjectsPanel').style.display = activeTab === 'subjects' ? '' : 'none';
  });
});

/* ---------- Classes: derived views + rendering ---------- */
function getFilteredClasses() {
  return classesState
    .filter(c => c.name.toLowerCase().includes(classSearchTerm.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function renderClassesTable() {
  const tbody = document.getElementById('classesTableBody');
  const user = SmsAuth.getUser();
  const canManage = user && user.role === 'admin';

  if (classesLoading) {
    tbody.innerHTML = `<tr><td colspan="4"><div class="loading-state">Loading classes…</div></td></tr>`;
    document.getElementById('classesPagination').innerHTML = '';
    return;
  }
  if (classesError) {
    tbody.innerHTML = `<tr><td colspan="4"><div class="error-state">Couldn't load classes: ${classesError}</div></td></tr>`;
    document.getElementById('classesPagination').innerHTML = '';
    return;
  }

  const filtered = getFilteredClasses();
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  classPage = Math.min(classPage, totalPages);
  const start = (classPage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);

  if (!pageItems.length) {
    tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state">No classes match your search.</div></td></tr>`;
  } else {
    tbody.innerHTML = pageItems.map(c => `
      <tr>
        <td>${c.name}</td>
        <td>${teacherName(c.teacherId)}</td>
        <td>${(c.subjectIds || []).map(subjectName).filter(Boolean).map(s => `<span class="subject-chip">${s}</span>`).join('') || '—'}</td>
        <td>
          ${canManage ? `
            <div class="row-actions">
              <button class="icon-btn" data-edit-class="${c.id}">Edit</button>
              <button class="icon-btn danger" data-delete-class="${c.id}">Delete</button>
            </div>
          ` : ''}
        </td>
      </tr>
    `).join('');
  }

  renderPagination('classesPagination', totalPages, classPage, (p) => { classPage = p; renderClassesTable(); });

  tbody.querySelectorAll('[data-edit-class]').forEach(btn => {
    btn.addEventListener('click', () => openClassModal(btn.dataset.editClass));
  });
  tbody.querySelectorAll('[data-delete-class]').forEach(btn => {
    btn.addEventListener('click', () => deleteClass(btn.dataset.deleteClass));
  });
}

/* ---------- Subjects: derived views + rendering ---------- */
function getFilteredSubjects() {
  const term = subjectSearchTerm.toLowerCase();
  return subjectsState
    .filter(s => s.name.toLowerCase().includes(term) || (s.code || '').toLowerCase().includes(term))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function renderSubjectsTable() {
  const tbody = document.getElementById('subjectsTableBody');
  const user = SmsAuth.getUser();
  const canManage = user && user.role === 'admin';

  if (subjectsLoading) {
    tbody.innerHTML = `<tr><td colspan="4"><div class="loading-state">Loading subjects…</div></td></tr>`;
    document.getElementById('subjectsPagination').innerHTML = '';
    return;
  }
  if (subjectsError) {
    tbody.innerHTML = `<tr><td colspan="4"><div class="error-state">Couldn't load subjects: ${subjectsError}</div></td></tr>`;
    document.getElementById('subjectsPagination').innerHTML = '';
    return;
  }

  const filtered = getFilteredSubjects();
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  subjectPage = Math.min(subjectPage, totalPages);
  const start = (subjectPage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);

  if (!pageItems.length) {
    tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state">No subjects match your search.</div></td></tr>`;
  } else {
    tbody.innerHTML = pageItems.map(s => `
      <tr>
        <td>${s.name}</td>
        <td>${s.code || '—'}</td>
        <td>${classesUsingSubject(s.id)}</td>
        <td>
          ${canManage ? `
            <div class="row-actions">
              <button class="icon-btn" data-edit-subject="${s.id}">Edit</button>
              <button class="icon-btn danger" data-delete-subject="${s.id}">Delete</button>
            </div>
          ` : ''}
        </td>
      </tr>
    `).join('');
  }

  renderPagination('subjectsPagination', totalPages, subjectPage, (p) => { subjectPage = p; renderSubjectsTable(); });

  tbody.querySelectorAll('[data-edit-subject]').forEach(btn => {
    btn.addEventListener('click', () => openSubjectModal(btn.dataset.editSubject));
  });
  tbody.querySelectorAll('[data-delete-subject]').forEach(btn => {
    btn.addEventListener('click', () => deleteSubject(btn.dataset.deleteSubject));
  });
}

/* ---------- Shared pagination renderer ---------- */
function renderPagination(elementId, totalPages, currentPage, onPage) {
  const el = document.getElementById(elementId);
  let html = `<button data-prev ${currentPage === 1 ? 'disabled' : ''}>‹</button>`;
  for (let i = 1; i <= totalPages; i++) {
    html += `<button data-page="${i}" class="${i === currentPage ? 'active-page' : ''}">${i}</button>`;
  }
  html += `<button data-next ${currentPage === totalPages ? 'disabled' : ''}>›</button>`;
  el.innerHTML = html;

  el.querySelector('[data-prev]').addEventListener('click', () => onPage(currentPage - 1));
  el.querySelector('[data-next]').addEventListener('click', () => onPage(currentPage + 1));
  el.querySelectorAll('[data-page]').forEach(btn => {
    btn.addEventListener('click', () => onPage(Number(btn.dataset.page)));
  });
}

/* ---------- Class modal ---------- */
const classOverlay = document.getElementById('classModalOverlay');
const classForm = document.getElementById('classForm');

function populateTeacherSelect(selectedId) {
  const select = document.getElementById('clsTeacher');
  select.innerHTML = `<option value="">— None —</option>` +
    teachersState.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
  select.value = selectedId || '';
}

function renderSubjectChecklist(selectedIds = []) {
  const container = document.getElementById('clsSubjectChecklist');
  if (!subjectsState.length) {
    container.innerHTML = `<p class="chalk-sub" style="margin:0;">No subjects yet — add one on the Subjects tab first.</p>`;
    return;
  }
  container.innerHTML = subjectsState.map(s => `
    <label class="checkbox-item">
      <input type="checkbox" value="${s.id}" ${selectedIds.includes(s.id) ? 'checked' : ''}>
      <span>${s.name}${s.code ? ` (${s.code})` : ''}</span>
    </label>
  `).join('');
}

function getCheckedSubjectIds() {
  return [...document.querySelectorAll('#clsSubjectChecklist input[type="checkbox"]:checked')].map(cb => cb.value);
}

function openClassModal(id = null) {
  const record = id ? classesState.find(c => c.id === id) : null;
  document.getElementById('classModalTitle').textContent = record ? 'Edit Class' : 'Add Class';
  document.getElementById('classId').value = record?.id || '';
  document.getElementById('clsName').value = record?.name || '';
  populateTeacherSelect(record?.teacherId);
  renderSubjectChecklist(record?.subjectIds || []);
  classOverlay.classList.add('is-open');
}

function closeClassModal() {
  classOverlay.classList.remove('is-open');
  classForm.reset();
}

classForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('classId').value;
  const payload = {
    name: document.getElementById('clsName').value.trim(),
    teacherId: document.getElementById('clsTeacher').value || null,
    subjectIds: getCheckedSubjectIds(),
  };

  const submitBtn = classForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Saving…';

  try {
    if (id) {
      await SmsAuth.apiFetch(`/classes/${id}`, { method: 'PATCH', body: payload });
    } else {
      await SmsAuth.apiFetch('/classes', { method: 'POST', body: payload });
    }
    closeClassModal();
    await loadClasses();
  } catch (err) {
    alert(`Couldn't save: ${err.message}`);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Save';
  }
});

async function deleteClass(id) {
  if (!confirm('Delete this class? This cannot be undone.')) return;
  try {
    await SmsAuth.apiFetch(`/classes/${id}`, { method: 'DELETE' });
    await loadClasses();
  } catch (err) {
    alert(`Couldn't delete: ${err.message}`);
  }
}

/* ---------- Subject modal ---------- */
const subjectOverlay = document.getElementById('subjectModalOverlay');
const subjectForm = document.getElementById('subjectForm');

function openSubjectModal(id = null) {
  const record = id ? subjectsState.find(s => s.id === id) : null;
  document.getElementById('subjectModalTitle').textContent = record ? 'Edit Subject' : 'Add Subject';
  document.getElementById('subjectId').value = record?.id || '';
  document.getElementById('subName').value = record?.name || '';
  document.getElementById('subCode').value = record?.code || '';
  subjectOverlay.classList.add('is-open');
}

function closeSubjectModal() {
  subjectOverlay.classList.remove('is-open');
  subjectForm.reset();
}

subjectForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('subjectId').value;
  const payload = {
    name: document.getElementById('subName').value.trim(),
    code: document.getElementById('subCode').value.trim(),
  };

  const submitBtn = subjectForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Saving…';

  try {
    if (id) {
      await SmsAuth.apiFetch(`/subjects/${id}`, { method: 'PATCH', body: payload });
    } else {
      await SmsAuth.apiFetch('/subjects', { method: 'POST', body: payload });
    }
    closeSubjectModal();
    await loadSubjects();
    renderClassesTable(); // subject-name lookups inside the classes table may have changed
  } catch (err) {
    alert(`Couldn't save: ${err.message}`);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Save';
  }
});

async function deleteSubject(id) {
  const inUse = classesUsingSubject(id);
  const msg = inUse
    ? `This subject is used by ${inUse} class${inUse === 1 ? '' : 'es'}. Delete it anyway? Those classes will keep the reference but it will no longer resolve.`
    : 'Delete this subject? This cannot be undone.';
  if (!confirm(msg)) return;
  try {
    await SmsAuth.apiFetch(`/subjects/${id}`, { method: 'DELETE' });
    await loadSubjects();
    renderClassesTable();
  } catch (err) {
    alert(`Couldn't delete: ${err.message}`);
  }
}

/* ---------- Events ---------- */
document.getElementById('newClassBtn').addEventListener('click', () => openClassModal());
document.getElementById('cancelClassModalBtn').addEventListener('click', closeClassModal);
classOverlay.addEventListener('click', (e) => { if (e.target === classOverlay) closeClassModal(); });

document.getElementById('newSubjectBtn').addEventListener('click', () => openSubjectModal());
document.getElementById('cancelSubjectModalBtn').addEventListener('click', closeSubjectModal);
subjectOverlay.addEventListener('click', (e) => { if (e.target === subjectOverlay) closeSubjectModal(); });

document.getElementById('classSearchInput').addEventListener('input', (e) => {
  classSearchTerm = e.target.value;
  classPage = 1;
  renderClassesTable();
});

document.getElementById('subjectSearchInput').addEventListener('input', (e) => {
  subjectSearchTerm = e.target.value;
  subjectPage = 1;
  renderSubjectsTable();
});

/* ---------- Init ---------- */
loadAll().then(() => {
  const action = new URLSearchParams(window.location.search).get('action');
  if (action === 'new-class') openClassModal();
  if (action === 'new-subject') openSubjectModal();
});
