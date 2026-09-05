/* =========================================================
   Teachers module — School Management System
   Full CRUD against the backend API, with a multi-subject
   tag-chip input. Requires auth-client.js + auth-guard.js
   loaded first.
========================================================= */

const PAGE_SIZE = 8;

let teachersState = [];
let currentPage = 1;
let searchTerm = '';
let subjectFilter = 'all';
let isLoading = true;
let loadError = null;
let currentSubjects = []; // subjects for whichever record is open in the modal

/* ---------- Data loading ---------- */
async function loadTeachers() {
  isLoading = true;
  loadError = null;
  renderTable();
  try {
    teachersState = await SmsAuth.apiFetch('/teachers');
  } catch (err) {
    loadError = err.message;
  } finally {
    isLoading = false;
    populateSubjectFilter();
    renderStats();
    renderTable();
  }
}

function populateSubjectFilter() {
  const select = document.getElementById('subjectFilter');
  const subjects = [...new Set(teachersState.flatMap(t => t.subjects || []))].sort();
  const currentValue = select.value;
  select.innerHTML = `<option value="all">All subjects</option>` + subjects.map(s => `<option value="${s}">${s}</option>`).join('');
  select.value = subjects.includes(currentValue) ? currentValue : 'all';
}

function renderStats() {
  document.getElementById('statTotal').textContent = teachersState.length;
  document.getElementById('statSubjects').textContent = new Set(teachersState.flatMap(t => t.subjects || [])).size;
}

/* ---------- Derived views ---------- */
function getFiltered() {
  return teachersState
    .filter(t => t.name.toLowerCase().includes(searchTerm.toLowerCase()))
    .filter(t => subjectFilter === 'all' || (t.subjects || []).includes(subjectFilter))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/* ---------- Rendering ---------- */
function renderTable() {
  const tbody = document.getElementById('teachersTableBody');
  const user = SmsAuth.getUser();
  const canManage = user && user.role === 'admin';

  if (isLoading) {
    tbody.innerHTML = `<tr><td colspan="4"><div class="loading-state">Loading teachers…</div></td></tr>`;
    document.getElementById('pagination').innerHTML = '';
    return;
  }

  if (loadError) {
    tbody.innerHTML = `<tr><td colspan="4"><div class="error-state">Couldn't load teachers: ${loadError}</div></td></tr>`;
    document.getElementById('pagination').innerHTML = '';
    return;
  }

  const filtered = getFiltered();
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  currentPage = Math.min(currentPage, totalPages);
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);

  if (!pageItems.length) {
    tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state">No teachers match your filters.</div></td></tr>`;
  } else {
    tbody.innerHTML = pageItems.map(t => `
      <tr>
        <td>${t.name}</td>
        <td>${(t.subjects || []).map(s => `<span class="subject-chip">${s}</span>`).join('') || '—'}</td>
        <td>${t.contact || '—'}</td>
        <td>
          ${canManage ? `
            <div class="row-actions">
              <button class="icon-btn" data-edit="${t.id}">Edit</button>
              <button class="icon-btn danger" data-delete="${t.id}">Delete</button>
            </div>
          ` : ''}
        </td>
      </tr>
    `).join('');
  }

  renderPagination(totalPages);

  tbody.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => openModal(btn.dataset.edit));
  });
  tbody.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', () => deleteTeacher(btn.dataset.delete));
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

/* ---------- Tag-chip subject input ---------- */
function renderTagChips() {
  const container = document.getElementById('tagChips');
  container.innerHTML = currentSubjects.map((s, i) => `
    <span class="tag-chip-removable">
      ${s}
      <button type="button" class="tag-chip-remove" data-remove-index="${i}">×</button>
    </span>
  `).join('');

  container.querySelectorAll('[data-remove-index]').forEach(btn => {
    btn.addEventListener('click', () => {
      currentSubjects.splice(Number(btn.dataset.removeIndex), 1);
      renderTagChips();
    });
  });
}

function addSubjectFromInput() {
  const input = document.getElementById('teaSubjectInput');
  const value = input.value.trim();
  if (value && !currentSubjects.includes(value)) {
    currentSubjects.push(value);
    renderTagChips();
  }
  input.value = '';
}

document.getElementById('teaSubjectInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    addSubjectFromInput();
  } else if (e.key === 'Backspace' && !e.target.value && currentSubjects.length) {
    currentSubjects.pop();
    renderTagChips();
  }
});

document.getElementById('teaSubjectInput').addEventListener('blur', addSubjectFromInput);

/* ---------- Modal / CRUD ---------- */
const overlay = document.getElementById('teacherModalOverlay');
const form = document.getElementById('teacherForm');

function openModal(id = null) {
  const record = id ? teachersState.find(t => t.id === id) : null;
  document.getElementById('modalTitle').textContent = record ? 'Edit Teacher' : 'Add Teacher';
  document.getElementById('teacherId').value = record?.id || '';
  document.getElementById('teaName').value = record?.name || '';
  document.getElementById('teaContact').value = record?.contact || '';
  currentSubjects = record?.subjects ? [...record.subjects] : [];
  renderTagChips();
  overlay.classList.add('is-open');
}

function closeModal() {
  overlay.classList.remove('is-open');
  form.reset();
  currentSubjects = [];
  renderTagChips();
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  addSubjectFromInput(); // catch anything left un-submitted in the text field

  const id = document.getElementById('teacherId').value;
  const payload = {
    name: document.getElementById('teaName').value.trim(),
    subjects: currentSubjects,
    contact: document.getElementById('teaContact').value.trim(),
  };

  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Saving…';

  try {
    if (id) {
      await SmsAuth.apiFetch(`/teachers/${id}`, { method: 'PATCH', body: payload });
    } else {
      await SmsAuth.apiFetch('/teachers', { method: 'POST', body: payload });
    }
    closeModal();
    await loadTeachers();
  } catch (err) {
    alert(`Couldn't save: ${err.message}`);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Save';
  }
});

async function deleteTeacher(id) {
  if (!confirm('Delete this teacher record? This cannot be undone.')) return;
  try {
    await SmsAuth.apiFetch(`/teachers/${id}`, { method: 'DELETE' });
    await loadTeachers();
  } catch (err) {
    alert(`Couldn't delete: ${err.message}`);
  }
}

/* ---------- Events ---------- */
document.getElementById('newTeacherBtn').addEventListener('click', () => openModal());
document.getElementById('cancelModalBtn').addEventListener('click', closeModal);
overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

document.getElementById('searchInput').addEventListener('input', (e) => {
  searchTerm = e.target.value;
  currentPage = 1;
  renderTable();
});

document.getElementById('subjectFilter').addEventListener('change', (e) => {
  subjectFilter = e.target.value;
  currentPage = 1;
  renderTable();
});

/* ---------- Init ---------- */
loadTeachers().then(() => {
  if (new URLSearchParams(window.location.search).get('action') === 'new') {
    openModal();
  }
});
