/* =========================================================
   Exams & Grades module — School Management System
   Full CRUD against the API. Create/edit/delete gated to
   admin+teacher (matches backend permissions).
========================================================= */

const PAGE_SIZE = 8;

let examsState = [];
let studentsState = [];
let currentPage = 1;
let searchTerm = '';
let termFilter = 'all';
let isLoading = true;
let loadError = null;

function letterGrade(pct) {
  if (pct >= 80) return 'A';
  if (pct >= 65) return 'B';
  if (pct >= 50) return 'C';
  if (pct >= 35) return 'D';
  return 'E';
}

/* ---------- Data loading ---------- */
async function loadExams() {
  isLoading = true;
  loadError = null;
  renderTable();
  try {
    const [exams, students] = await Promise.all([
      SmsAuth.apiFetch('/exams'),
      SmsAuth.apiFetch('/students').catch(() => []),
    ]);
    examsState = exams;
    studentsState = students;
    populateStudentSelect();
    populateTermFilter();
  } catch (err) {
    loadError = err.message;
  } finally {
    isLoading = false;
    renderStats();
    renderTable();
  }
}

function populateStudentSelect() {
  const select = document.getElementById('examStudentSelect');
  select.innerHTML = studentsState.map(s => `<option value="${s.id}">${s.name} — ${s.class || 'No class'}</option>`).join('')
    || '<option value="">Add students first</option>';
}

function populateTermFilter() {
  const select = document.getElementById('termFilter');
  const terms = [...new Set(examsState.map(e => e.term).filter(Boolean))].sort();
  const currentValue = select.value;
  select.innerHTML = `<option value="all">All terms</option>` + terms.map(t => `<option value="${t}">${t}</option>`).join('');
  select.value = terms.includes(currentValue) ? currentValue : 'all';
}

/* ---------- Derived views ---------- */
function getFiltered() {
  return examsState
    .filter(e => {
      const haystack = `${e.studentName || ''} ${e.subject || ''}`.toLowerCase();
      return haystack.includes(searchTerm.toLowerCase());
    })
    .filter(e => termFilter === 'all' || e.term === termFilter)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/* ---------- Rendering ---------- */
function renderStats() {
  document.getElementById('statRecorded').textContent = examsState.length;
  if (!examsState.length) {
    document.getElementById('statAverage').textContent = '—';
    return;
  }
  const avgPct = examsState.reduce((sum, e) => sum + (Number(e.score) / Number(e.maxScore || 100)) * 100, 0) / examsState.length;
  document.getElementById('statAverage').textContent = `${Math.round(avgPct)}%`;
}

function renderTable() {
  const tbody = document.getElementById('examsTableBody');
  const user = SmsAuth.getUser();
  const canManage = user && ['admin', 'teacher'].includes(user.role);

  if (isLoading) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="loading-state">Loading exam results…</div></td></tr>`;
    document.getElementById('pagination').innerHTML = '';
    return;
  }

  if (loadError) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="error-state">Couldn't load exams: ${loadError}</div></td></tr>`;
    document.getElementById('pagination').innerHTML = '';
    return;
  }

  const filtered = getFiltered();
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  currentPage = Math.min(currentPage, totalPages);
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);

  if (!pageItems.length) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state">No exam results match your filters.</div></td></tr>`;
  } else {
    tbody.innerHTML = pageItems.map(e => {
      const pct = Math.round((Number(e.score) / Number(e.maxScore || 100)) * 100);
      const grade = letterGrade(pct);
      return `
        <tr>
          <td>${e.studentName || '—'}</td>
          <td>${e.subject}</td>
          <td>${e.examName}</td>
          <td>${e.term}</td>
          <td>${e.score}/${e.maxScore} (${pct}%)</td>
          <td><span class="grade-badge grade-badge--${grade.toLowerCase()}">${grade}</span></td>
          <td>
            ${canManage ? `
              <div class="row-actions">
                <button class="icon-btn" data-edit="${e.id}">Edit</button>
                <button class="icon-btn danger" data-delete="${e.id}">Delete</button>
              </div>
            ` : ''}
          </td>
        </tr>
      `;
    }).join('');
  }

  renderPagination(totalPages);

  tbody.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => openModal(btn.dataset.edit));
  });
  tbody.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', () => deleteExam(btn.dataset.delete));
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
const overlay = document.getElementById('examModalOverlay');
const form = document.getElementById('examForm');

function openModal(id = null) {
  const record = id ? examsState.find(e => e.id === id) : null;
  document.getElementById('modalTitle').textContent = record ? 'Edit Score' : 'Add Score';
  document.getElementById('examId').value = record?.id || '';
  document.getElementById('examStudentSelect').value = record?.studentId || '';
  document.getElementById('examSubject').value = record?.subject || '';
  document.getElementById('examName').value = record?.examName || '';
  document.getElementById('examScore').value = record?.score ?? '';
  document.getElementById('examMaxScore').value = record?.maxScore ?? 100;
  document.getElementById('examTerm').value = record?.term || '';
  overlay.classList.add('is-open');
}

function closeModal() {
  overlay.classList.remove('is-open');
  form.reset();
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('examId').value;
  const studentSelect = document.getElementById('examStudentSelect');
  const student = studentsState.find(s => s.id === studentSelect.value);

  const payload = {
    studentId: studentSelect.value,
    studentName: student?.name || '',
    subject: document.getElementById('examSubject').value.trim(),
    examName: document.getElementById('examName').value.trim(),
    score: Number(document.getElementById('examScore').value),
    maxScore: Number(document.getElementById('examMaxScore').value),
    term: document.getElementById('examTerm').value.trim(),
  };

  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Saving…';

  try {
    if (id) {
      await SmsAuth.apiFetch(`/exams/${id}`, { method: 'PATCH', body: payload });
    } else {
      await SmsAuth.apiFetch('/exams', { method: 'POST', body: payload });
    }
    closeModal();
    await loadExams();
  } catch (err) {
    alert(`Couldn't save: ${err.message}`);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Save';
  }
});

async function deleteExam(id) {
  if (!confirm('Delete this exam result?')) return;
  try {
    await SmsAuth.apiFetch(`/exams/${id}`, { method: 'DELETE' });
    await loadExams();
  } catch (err) {
    alert(`Couldn't delete: ${err.message}`);
  }
}

/* ---------- Events ---------- */
document.getElementById('newGradeBtn').addEventListener('click', () => openModal());
document.getElementById('cancelModalBtn').addEventListener('click', closeModal);
overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

document.getElementById('searchInput').addEventListener('input', (e) => {
  searchTerm = e.target.value;
  currentPage = 1;
  renderTable();
});

document.getElementById('termFilter').addEventListener('change', (e) => {
  termFilter = e.target.value;
  currentPage = 1;
  renderTable();
});

/* ---------- Init ---------- */
const examUser = SmsAuth.getUser();
document.getElementById('ledgerTitle').textContent = examUser.role === 'parent' ? "Your Children's Results" : 'Exam Results';
loadExams();
