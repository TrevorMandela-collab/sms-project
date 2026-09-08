/* =========================================================
   Manage Logins module — admin-only.
   Lets an admin create teacher/parent login accounts and
   review every account that exists. Requires auth-client.js
   + auth-guard.js loaded first.
========================================================= */

/* ---------- Admin-only guard ---------- */
(function () {
  const user = SmsAuth.getUser();
  if (!user || user.role !== 'admin') {
    window.location.href = SmsAuth.homeUrlForRole(user ? user.role : null);
  }
})();

let teachersState = [];
let studentsState = [];
let accountsState = [];
let accountSearchTerm = '';
let accountRoleFilterValue = 'all';
let childSearchTerm = '';

/* ---------- Data loading ---------- */
async function loadAll() {
  await Promise.all([loadTeachers(), loadStudents(), loadAccounts()]);
}

async function loadTeachers() {
  try {
    teachersState = await SmsAuth.apiFetch('/teachers');
  } catch (err) {
    teachersState = [];
  }
  populateTeacherSelect();
}

async function loadStudents() {
  try {
    studentsState = await SmsAuth.apiFetch('/students');
  } catch (err) {
    studentsState = [];
  }
  renderChildCheckboxList();
}

async function loadAccounts() {
  const tbody = document.getElementById('accountsTableBody');
  tbody.innerHTML = `<tr><td colspan="5"><div class="loading-state">Loading accounts…</div></td></tr>`;
  try {
    accountsState = await SmsAuth.apiFetch('/auth/users');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="error-state">Couldn't load accounts: ${err.message}</div></td></tr>`;
    return;
  }
  renderAccountsTable();
}

/* ---------- Teacher link dropdown ---------- */
function populateTeacherSelect() {
  const select = document.getElementById('teacherLinkSelect');
  const currentValue = select.value;
  select.innerHTML = `<option value="">— not linked —</option>` +
    teachersState
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(t => `<option value="${t.id}">${t.name}</option>`)
      .join('');
  select.value = teachersState.some(t => t.id === currentValue) ? currentValue : '';
}

/* ---------- Child checkbox list ---------- */
function renderChildCheckboxList() {
  const container = document.getElementById('childCheckboxList');
  const filtered = studentsState
    .filter(s => s.name.toLowerCase().includes(childSearchTerm.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (!studentsState.length) {
    container.innerHTML = `<div class="empty-state">No students found. Add students first.</div>`;
    return;
  }
  if (!filtered.length) {
    container.innerHTML = `<div class="empty-state">No students match "${childSearchTerm}".</div>`;
    return;
  }

  // Preserve currently-checked ids across re-renders (e.g. while searching)
  const checkedIds = new Set(
    Array.from(container.querySelectorAll('input[type="checkbox"]:checked')).map(el => el.value)
  );

  container.innerHTML = filtered.map(s => `
    <label class="child-checkbox-item">
      <input type="checkbox" value="${s.id}" ${checkedIds.has(s.id) ? 'checked' : ''}>
      <span class="child-name">${s.name}</span>
      <span class="child-class">${s.class || '—'}</span>
    </label>
  `).join('');
}

function getCheckedChildIds() {
  return Array.from(document.querySelectorAll('#childCheckboxList input[type="checkbox"]:checked'))
    .map(el => el.value);
}

/* ---------- Existing accounts table ---------- */
function linkedToLabel(account) {
  if (account.role === 'teacher') {
    const teacher = teachersState.find(t => t.id === account.teacherId);
    return teacher ? teacher.name : (account.teacherId ? '—' : 'Not linked');
  }
  if (account.role === 'parent') {
    const names = (account.childIds || [])
      .map(id => studentsState.find(s => s.id === id)?.name)
      .filter(Boolean);
    return names.length ? names.join(', ') : 'No children linked';
  }
  if (account.role === 'student') {
    const student = studentsState.find(s => s.id === account.studentId);
    return student ? student.name : '—';
  }
  return '—';
}

function getFilteredAccounts() {
  return accountsState
    .filter(a =>
      a.name.toLowerCase().includes(accountSearchTerm.toLowerCase()) ||
      (a.email || '').toLowerCase().includes(accountSearchTerm.toLowerCase())
    )
    .filter(a => accountRoleFilterValue === 'all' || a.role === accountRoleFilterValue)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function renderAccountsTable() {
  const tbody = document.getElementById('accountsTableBody');
  const filtered = getFilteredAccounts();

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state">No accounts match your filters.</div></td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(a => `
    <tr>
      <td>${a.name}</td>
      <td>${a.email}</td>
      <td><span class="badge badge--blue">${a.role}</span></td>
      <td><span class="linked-tag">${linkedToLabel(a)}</span></td>
      <td>${a.createdAt ? new Date(a.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</td>
    </tr>
  `).join('');
}

/* ---------- Form helpers ---------- */
function setFormMessage(id, text, kind) {
  const el = document.getElementById(id);
  el.textContent = text || '';
  el.classList.remove('is-error', 'is-success');
  if (kind) el.classList.add(kind === 'error' ? 'is-error' : 'is-success');
}

/* ---------- Create teacher login ---------- */
const teacherForm = document.getElementById('createTeacherForm');
teacherForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  setFormMessage('teacherFormMessage', '', null);

  const payload = {
    name: document.getElementById('tchLoginName').value.trim(),
    email: document.getElementById('tchLoginEmail').value.trim(),
    password: document.getElementById('tchLoginPassword').value,
    role: 'teacher',
    teacherId: document.getElementById('teacherLinkSelect').value || null,
  };

  const submitBtn = teacherForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Creating…';

  try {
    await SmsAuth.register(payload);
    setFormMessage('teacherFormMessage', `Login created for ${payload.name}.`, 'success');
    teacherForm.reset();
    populateTeacherSelect();
    await loadAccounts();
  } catch (err) {
    setFormMessage('teacherFormMessage', err.message, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Create Teacher Login';
  }
});

/* ---------- Create parent login ---------- */
const parentForm = document.getElementById('createParentForm');
parentForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  setFormMessage('parentFormMessage', '', null);

  const childIds = getCheckedChildIds();
  const payload = {
    name: document.getElementById('parLoginName').value.trim(),
    email: document.getElementById('parLoginEmail').value.trim(),
    password: document.getElementById('parLoginPassword').value,
    role: 'parent',
    childIds,
  };

  const submitBtn = parentForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Creating…';

  try {
    await SmsAuth.register(payload);
    setFormMessage('parentFormMessage', `Login created for ${payload.name}.`, 'success');
    parentForm.reset();
    childSearchTerm = '';
    document.getElementById('childSearchInput').value = '';
    renderChildCheckboxList();
    await loadAccounts();
  } catch (err) {
    setFormMessage('parentFormMessage', err.message, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Create Parent Login';
  }
});

/* ---------- Filters ---------- */
document.getElementById('childSearchInput').addEventListener('input', (e) => {
  childSearchTerm = e.target.value;
  renderChildCheckboxList();
});

document.getElementById('accountSearchInput').addEventListener('input', (e) => {
  accountSearchTerm = e.target.value;
  renderAccountsTable();
});

document.getElementById('accountRoleFilter').addEventListener('change', (e) => {
  accountRoleFilterValue = e.target.value;
  renderAccountsTable();
});

/* ---------- Init ---------- */
loadAll();
