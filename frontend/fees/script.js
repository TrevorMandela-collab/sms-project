/* =========================================================
   Fees module — School Management System
   Full CRUD against the API. Record create/edit/delete is
   admin-only (gated in HTML + enforced by the backend).
========================================================= */

const PAGE_SIZE = 6;

let feesState = [];
let studentsState = [];
let currentPage = 1;
let searchTerm = '';
let statusFilter = 'all';
let isLoading = true;
let loadError = null;

const money = (n) => `KSh ${Number(n || 0).toLocaleString('en-KE')}`;

/* ---------- Data loading ---------- */
async function loadFees() {
  isLoading = true;
  loadError = null;
  renderTable();
  try {
    const [fees, students] = await Promise.all([
      SmsAuth.apiFetch('/fees'),
      SmsAuth.apiFetch('/students').catch(() => []), // parents may not need this; tolerate failure
    ]);
    feesState = fees;
    studentsState = students;
    populateStudentSelect();
  } catch (err) {
    loadError = err.message;
  } finally {
    isLoading = false;
    renderTable();
  }
}

function populateStudentSelect() {
  const select = document.getElementById('feeStudentSelect');
  select.innerHTML = studentsState
    .map(s => `<option value="${s.id}" data-class="${s.class || ''}">${s.name} — ${s.class || 'No class'}</option>`)
    .join('') || '<option value="">Add students first</option>';
}

/* ---------- Derived views ---------- */
function getFilteredFees() {
  return feesState.filter(f => {
    const name = f.studentName || '';
    const matchesSearch = name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || f.status === statusFilter;
    return matchesSearch && matchesStatus;
  });
}

/* ---------- Rendering ---------- */
function renderStats() {
  const paid = feesState.filter(f => f.status === 'paid').reduce((s, f) => s + Number(f.amount || 0), 0);
  const outstanding = feesState.filter(f => f.status !== 'paid').reduce((s, f) => s + Number(f.amount || 0), 0);
  const overdueCount = feesState.filter(f => f.status === 'overdue').length;

  document.getElementById('statCollected').textContent = money(paid);
  document.getElementById('statOutstanding').textContent = money(outstanding);
  document.getElementById('statOverdue').textContent = overdueCount;
}

function renderTable() {
  const tbody = document.getElementById('feesTableBody');
  const user = SmsAuth.getUser();
  const canManage = user && user.role === 'admin';

  if (isLoading) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="loading-state">Loading fee records…</div></td></tr>`;
    document.getElementById('pagination').innerHTML = '';
    return;
  }

  if (loadError) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="error-state">Couldn't load fees: ${loadError}</div></td></tr>`;
    document.getElementById('pagination').innerHTML = '';
    return;
  }

  renderStats();

  const filtered = getFilteredFees();
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  currentPage = Math.min(currentPage, totalPages);
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);

  if (!pageItems.length) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state">No matching fee records.</div></td></tr>`;
  } else {
    tbody.innerHTML = pageItems.map(f => `
      <tr>
        <td>${f.studentName || '—'}</td>
        <td>${f.class || '—'}</td>
        <td>${money(f.amount)}</td>
        <td>${f.due ? new Date(f.due).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—'}</td>
        <td><span class="status-pill status-pill--${f.status}">${f.status}</span></td>
        <td>
          ${canManage ? `
            <div class="row-actions">
              <button class="icon-btn" data-edit="${f.id}">Edit</button>
              <button class="icon-btn danger" data-delete="${f.id}">Delete</button>
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
    btn.addEventListener('click', () => deleteFee(btn.dataset.delete));
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
const overlay = document.getElementById('feeModalOverlay');
const form = document.getElementById('feeForm');

function openModal(id = null) {
  const record = id ? feesState.find(f => f.id === id) : null;
  document.getElementById('modalTitle').textContent = record ? 'Edit Payment' : 'Record Payment';
  document.getElementById('feeId').value = record?.id || '';
  document.getElementById('feeStudentSelect').value = record?.studentId || '';
  document.getElementById('feeAmount').value = record?.amount || '';
  document.getElementById('feeDue').value = record?.due ? record.due.slice(0, 10) : '';
  document.getElementById('feeStatus').value = record?.status || 'pending';
  overlay.classList.add('is-open');
}

function closeModal() {
  overlay.classList.remove('is-open');
  form.reset();
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('feeId').value;
  const studentSelect = document.getElementById('feeStudentSelect');
  const selectedOption = studentSelect.selectedOptions[0];
  const student = studentsState.find(s => s.id === studentSelect.value);

  const payload = {
    studentId: studentSelect.value,
    studentName: student?.name || selectedOption?.textContent?.split(' — ')[0] || '',
    class: student?.class || selectedOption?.dataset.class || '',
    amount: Number(document.getElementById('feeAmount').value),
    due: document.getElementById('feeDue').value,
    status: document.getElementById('feeStatus').value,
  };

  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Saving…';

  try {
    if (id) {
      await SmsAuth.apiFetch(`/fees/${id}`, { method: 'PATCH', body: payload });
    } else {
      await SmsAuth.apiFetch('/fees', { method: 'POST', body: payload });
    }
    closeModal();
    await loadFees();
  } catch (err) {
    alert(`Couldn't save: ${err.message}`);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Save';
  }
});

async function deleteFee(id) {
  if (!confirm('Delete this fee record?')) return;
  try {
    await SmsAuth.apiFetch(`/fees/${id}`, { method: 'DELETE' });
    await loadFees();
  } catch (err) {
    alert(`Couldn't delete: ${err.message}`);
  }
}

/* ---------- CSV export ---------- */
function exportCSV() {
  const rows = [
    ['Student', 'Class', 'Amount', 'Due Date', 'Status'],
    ...getFilteredFees().map(f => [f.studentName, f.class, f.amount, f.due, f.status]),
  ];
  const csv = rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'fees-ledger.csv';
  a.click();
  URL.revokeObjectURL(url);
}

/* ---------- Events ---------- */
document.getElementById('newPaymentBtn').addEventListener('click', () => openModal());
document.getElementById('cancelModalBtn').addEventListener('click', closeModal);
overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

document.getElementById('searchInput').addEventListener('input', (e) => {
  searchTerm = e.target.value;
  currentPage = 1;
  renderTable();
});

document.getElementById('statusFilter').addEventListener('change', (e) => {
  statusFilter = e.target.value;
  currentPage = 1;
  renderTable();
});

document.getElementById('exportBtn').addEventListener('click', exportCSV);

/* ---------- Init ---------- */
loadFees().then(() => {
  if (new URLSearchParams(window.location.search).get('action') === 'new') {
    openModal();
  }
});
