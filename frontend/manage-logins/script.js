/* =========================================================
   Manage Logins module — admin-only.
   Teachers and parents now join via a self-service invite
   code/link (like students already do), generated here by
   the admin — this page no longer creates their accounts
   directly. It also manages every existing account: edit,
   suspend/reinstate, or delete. Requires auth-client.js +
   auth-guard.js loaded first.
========================================================= */

/* ---------- Admin-only guard ---------- */
(function () {
  const user = SmsAuth.getUser();
  if (!user || !['admin', 'school_admin'].includes(user.role)) {
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
  tbody.innerHTML = `<tr><td colspan="7"><div class="loading-state">Loading accounts…</div></td></tr>`;
  try {
    accountsState = await SmsAuth.apiFetch('/auth/users');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="error-state">Couldn't load accounts: ${err.message}</div></td></tr>`;
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

function statusLabel(account) {
  if ((account.status || 'active') === 'active') {
    return `<span class="badge badge--green">Active</span>`;
  }
  const until = account.suspendedUntil
    ? ` until ${new Date(account.suspendedUntil).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`
    : ' (indefinite)';
  return `<span class="badge badge--pink" title="Suspended${until}">Suspended${until}</span>`;
}

function renderAccountsTable() {
  const tbody = document.getElementById('accountsTableBody');
  const filtered = getFilteredAccounts();

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state">No accounts match your filters.</div></td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(a => `
    <tr>
      <td>${a.name}</td>
      <td>${a.email}</td>
      <td><span class="badge badge--blue">${a.role}</span></td>
      <td><span class="linked-tag">${linkedToLabel(a)}</span></td>
      <td>${statusLabel(a)}</td>
      <td>${a.createdAt ? new Date(a.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</td>
      <td>
        <div class="row-actions">
          <button class="icon-btn" data-edit-account="${a.id}">Edit</button>
          ${(a.status || 'active') === 'active'
            ? `<button class="icon-btn" data-suspend-account="${a.id}">Suspend</button>`
            : `<button class="icon-btn" data-reinstate-account="${a.id}">Reinstate</button>`}
          <button class="icon-btn danger" data-delete-account="${a.id}">Delete</button>
        </div>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-edit-account]').forEach(btn => {
    btn.addEventListener('click', () => openEditAccountModal(btn.dataset.editAccount));
  });
  tbody.querySelectorAll('[data-delete-account]').forEach(btn => {
    btn.addEventListener('click', () => deleteAccount(btn.dataset.deleteAccount));
  });
  tbody.querySelectorAll('[data-suspend-account]').forEach(btn => {
    btn.addEventListener('click', () => suspendAccount(btn.dataset.suspendAccount));
  });
  tbody.querySelectorAll('[data-reinstate-account]').forEach(btn => {
    btn.addEventListener('click', () => reinstateAccount(btn.dataset.reinstateAccount));
  });
}

/* ---------- Form helpers ---------- */
function setFormMessage(id, text, kind) {
  const el = document.getElementById(id);
  el.textContent = text || '';
  el.classList.remove('is-error', 'is-success');
  if (kind) el.classList.add(kind === 'error' ? 'is-error' : 'is-success');
}

/* ---------- Invite a teacher ---------- */
function registerUrl() {
  return new URL('../register/index.html', window.location.href).href;
}

document.getElementById('generateTeacherInviteBtn').addEventListener('click', async () => {
  setFormMessage('teacherInviteMessage', '', null);
  const btn = document.getElementById('generateTeacherInviteBtn');
  const teacherId = document.getElementById('teacherLinkSelect').value || null;
  const expiresInDays = Number(document.getElementById('teacherInviteExpiry').value) || 7;

  btn.disabled = true;
  btn.textContent = 'Generating…';
  try {
    const invite = await SmsAuth.apiFetch('/invite-codes', {
      method: 'POST',
      body: { role: 'teacher', teacherId, expiresInDays },
    });
    document.getElementById('teacherInviteCode').textContent = invite.code;
    document.getElementById('teacherInviteMeta').textContent =
      `Expires ${new Date(invite.expiresAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} · single use · share along with: ${registerUrl()}`;
    document.getElementById('teacherInviteResult').style.display = '';
    document.getElementById('copyTeacherInviteBtn').onclick = () => {
      navigator.clipboard?.writeText(
        `Here's your teacher login invite code for the school portal: ${invite.code}. Register at ${registerUrl()} using this code.`
      );
    };
  } catch (err) {
    setFormMessage('teacherInviteMessage', err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Generate Invite';
  }
});

/* ---------- Invite a parent ---------- */
document.getElementById('generateParentInviteBtn').addEventListener('click', async () => {
  setFormMessage('parentInviteMessage', '', null);
  const btn = document.getElementById('generateParentInviteBtn');
  const childIds = getCheckedChildIds();
  const expiresInDays = Number(document.getElementById('parentInviteExpiry').value) || 7;

  btn.disabled = true;
  btn.textContent = 'Generating…';
  try {
    const invite = await SmsAuth.apiFetch('/invite-codes', {
      method: 'POST',
      body: { role: 'parent', childIds, expiresInDays },
    });
    document.getElementById('parentInviteCode').textContent = invite.code;
    document.getElementById('parentInviteMeta').textContent =
      `Expires ${new Date(invite.expiresAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} · single use · share along with: ${registerUrl()}`;
    document.getElementById('parentInviteResult').style.display = '';
    document.getElementById('copyParentInviteBtn').onclick = () => {
      navigator.clipboard?.writeText(
        `Here's your parent login invite code for the school portal: ${invite.code}. Register at ${registerUrl()} using this code.`
      );
    };
  } catch (err) {
    setFormMessage('parentInviteMessage', err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Generate Invite';
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

/* ---------- Edit account modal ---------- */
const editOverlay = document.getElementById('editAccountOverlay');
const editForm = document.getElementById('editAccountForm');
let editingAccount = null;

function renderEditChildCheckboxList(preCheckedIds) {
  const container = document.getElementById('editChildCheckboxList');
  container.innerHTML = studentsState
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(s => `
      <label class="child-checkbox-item">
        <input type="checkbox" value="${s.id}" ${preCheckedIds.has(s.id) ? 'checked' : ''}>
        <span class="child-name">${s.name}</span>
        <span class="child-class">${s.class || '—'}</span>
      </label>
    `).join('') || `<div class="empty-state">No students found.</div>`;
}

function populateEditTeacherSelect(selectedId) {
  const select = document.getElementById('editTeacherLinkSelect');
  select.innerHTML = `<option value="">— not linked —</option>` +
    teachersState
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(t => `<option value="${t.id}">${t.name}</option>`)
      .join('');
  select.value = teachersState.some(t => t.id === selectedId) ? selectedId : '';
}

function openEditAccountModal(id) {
  editingAccount = accountsState.find(a => a.id === id);
  if (!editingAccount) return;

  document.getElementById('editAccountId').value = editingAccount.id;
  document.getElementById('editAccountName').value = editingAccount.name;
  document.getElementById('editAccountEmail').value = editingAccount.email;
  setFormMessage('editAccountMessage', '', null);

  const teacherField = document.getElementById('editTeacherLinkField');
  const childrenField = document.getElementById('editChildrenField');
  teacherField.style.display = editingAccount.role === 'teacher' ? '' : 'none';
  childrenField.style.display = editingAccount.role === 'parent' ? '' : 'none';

  if (editingAccount.role === 'teacher') {
    populateEditTeacherSelect(editingAccount.teacherId);
  }
  if (editingAccount.role === 'parent') {
    renderEditChildCheckboxList(new Set(editingAccount.childIds || []));
  }

  editOverlay.classList.add('is-open');
}

function closeEditAccountModal() {
  editOverlay.classList.remove('is-open');
  editingAccount = null;
}

document.getElementById('cancelEditAccountBtn').addEventListener('click', closeEditAccountModal);
editOverlay.addEventListener('click', (e) => { if (e.target === editOverlay) closeEditAccountModal(); });

editForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!editingAccount) return;
  setFormMessage('editAccountMessage', '', null);

  const payload = {
    name: document.getElementById('editAccountName').value.trim(),
    email: document.getElementById('editAccountEmail').value.trim(),
  };
  if (editingAccount.role === 'teacher') {
    payload.teacherId = document.getElementById('editTeacherLinkSelect').value || null;
  }
  if (editingAccount.role === 'parent') {
    payload.childIds = Array.from(
      document.querySelectorAll('#editChildCheckboxList input[type="checkbox"]:checked')
    ).map(el => el.value);
  }

  const submitBtn = editForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Saving…';

  try {
    await SmsAuth.apiFetch(`/auth/users/${editingAccount.id}`, { method: 'PATCH', body: payload });
    closeEditAccountModal();
    await loadAccounts();
  } catch (err) {
    setFormMessage('editAccountMessage', err.message, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Save Changes';
  }
});

async function deleteAccount(id) {
  const account = accountsState.find(a => a.id === id);
  if (!account) return;
  if (!confirm(`Delete the login for ${account.name} (${account.email})? This cannot be undone.`)) return;
  try {
    await SmsAuth.apiFetch(`/auth/users/${id}`, { method: 'DELETE' });
    await loadAccounts();
  } catch (err) {
    alert(`Couldn't delete: ${err.message}`);
  }
}

async function suspendAccount(id) {
  const account = accountsState.find(a => a.id === id);
  if (!account) return;
  const input = prompt(
    `Suspend ${account.name} until when?\n\nLeave blank to suspend indefinitely, or enter a date as YYYY-MM-DD (e.g. 2026-12-31).`,
    ''
  );
  if (input === null) return; // cancelled
  let suspendedUntil = null;
  if (input.trim()) {
    const parsed = new Date(input.trim());
    if (isNaN(parsed.getTime())) {
      alert("That date wasn't understood — use the format YYYY-MM-DD, or leave it blank for an indefinite suspension.");
      return;
    }
    suspendedUntil = parsed.toISOString();
  }
  try {
    await SmsAuth.apiFetch(`/auth/users/${id}/status`, {
      method: 'PATCH',
      body: { status: 'suspended', suspendedUntil },
    });
    await loadAccounts();
  } catch (err) {
    alert(`Couldn't suspend: ${err.message}`);
  }
}

async function reinstateAccount(id) {
  try {
    await SmsAuth.apiFetch(`/auth/users/${id}/status`, {
      method: 'PATCH',
      body: { status: 'active' },
    });
    await loadAccounts();
  } catch (err) {
    alert(`Couldn't reinstate: ${err.message}`);
  }
}

/* ---------- Init ---------- */
loadAll();
