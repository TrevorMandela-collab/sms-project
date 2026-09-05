/* =========================================================
   Students module — School Management System
   Full CRUD against the backend API. Requires auth-client.js
   + auth-guard.js loaded first.
========================================================= */

const PAGE_SIZE = 8;

let studentsState = [];
let currentPage = 1;
let searchTerm = '';
let classFilter = 'all';
let isLoading = true;
let loadError = null;

/* ---------- Data loading ---------- */
async function loadStudents() {
  isLoading = true;
  loadError = null;
  renderTable();
  try {
    studentsState = await SmsAuth.apiFetch('/students');
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
  const classes = [...new Set(studentsState.map(s => s.class).filter(Boolean))].sort();
  const currentValue = select.value;
  select.innerHTML = `<option value="all">All classes</option>` + classes.map(c => `<option value="${c}">${c}</option>`).join('');
  select.value = classes.includes(currentValue) ? currentValue : 'all';
}

function renderStats() {
  document.getElementById('statTotal').textContent = studentsState.length;
  document.getElementById('statClasses').textContent = new Set(studentsState.map(s => s.class).filter(Boolean)).size;
}

/* ---------- Derived views ---------- */
function getFiltered() {
  return studentsState
    .filter(s => s.name.toLowerCase().includes(searchTerm.toLowerCase()))
    .filter(s => classFilter === 'all' || s.class === classFilter)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/* ---------- Rendering ---------- */
function renderTable() {
  const tbody = document.getElementById('studentsTableBody');
  const user = SmsAuth.getUser();
  const canManage = user && user.role === 'admin';

  if (isLoading) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="loading-state">Loading students…</div></td></tr>`;
    document.getElementById('pagination').innerHTML = '';
    return;
  }

  if (loadError) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="error-state">Couldn't load students: ${loadError}</div></td></tr>`;
    document.getElementById('pagination').innerHTML = '';
    return;
  }

  const filtered = getFiltered();
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  currentPage = Math.min(currentPage, totalPages);
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);

  if (!pageItems.length) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state">No students match your filters.</div></td></tr>`;
  } else {
    tbody.innerHTML = pageItems.map(s => `
      <tr>
        <td>${s.name}</td>
        <td>${s.class || '—'}</td>
        <td>${s.dateOfBirth ? new Date(s.dateOfBirth).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</td>
        <td>${s.guardianContact || '—'}</td>
        <td>
          ${canManage ? `
            <div class="row-actions">
              <button class="icon-btn" data-edit="${s.id}">Edit</button>
              <button class="icon-btn danger" data-delete="${s.id}">Delete</button>
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
    btn.addEventListener('click', () => deleteStudent(btn.dataset.delete));
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

/* ---------- Modal / CRUD ---------- */
const overlay = document.getElementById('studentModalOverlay');
const form = document.getElementById('studentForm');

function openModal(id = null) {
  const record = id ? studentsState.find(s => s.id === id) : null;
  document.getElementById('modalTitle').textContent = record ? 'Edit Student' : 'Add Student';
  document.getElementById('studentId').value = record?.id || '';
  document.getElementById('stuName').value = record?.name || '';
  document.getElementById('stuClass').value = record?.class || '';
  document.getElementById('stuDob').value = record?.dateOfBirth ? record.dateOfBirth.slice(0, 10) : '';
  document.getElementById('stuGuardianContact').value = record?.guardianContact || '';
  overlay.classList.add('is-open');
}

function closeModal() {
  overlay.classList.remove('is-open');
  form.reset();
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('studentId').value;
  const payload = {
    name: document.getElementById('stuName').value.trim(),
    class: document.getElementById('stuClass').value.trim(),
    dateOfBirth: document.getElementById('stuDob').value || null,
    guardianContact: document.getElementById('stuGuardianContact').value.trim(),
  };

  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Saving…';

  try {
    if (id) {
      await SmsAuth.apiFetch(`/students/${id}`, { method: 'PATCH', body: payload });
    } else {
      await SmsAuth.apiFetch('/students', { method: 'POST', body: payload });
    }
    closeModal();
    await loadStudents();
  } catch (err) {
    alert(`Couldn't save: ${err.message}`);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Save';
  }
});

async function deleteStudent(id) {
  if (!confirm('Delete this student record? This cannot be undone.')) return;
  try {
    await SmsAuth.apiFetch(`/students/${id}`, { method: 'DELETE' });
    await loadStudents();
  } catch (err) {
    alert(`Couldn't delete: ${err.message}`);
  }
}

/* ---------- Events ---------- */
document.getElementById('newStudentBtn').addEventListener('click', () => openModal());
document.getElementById('cancelModalBtn').addEventListener('click', closeModal);
overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

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
loadStudents().then(() => {
  if (new URLSearchParams(window.location.search).get('action') === 'new') {
    openModal();
  }
});
