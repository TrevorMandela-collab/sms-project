/* =========================================================
   Library module — School Management System
   Two tabs: catalog (books) and loans. Both backed by the API.
========================================================= */

let catalogState = [];
let loansState = [];
let studentsState = [];
let catalogSearch = '';
let isLoading = true;
let loadError = null;

/* ---------- Tabs ---------- */
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('is-active'));
    btn.classList.add('is-active');
    document.getElementById('catalogPanel').style.display = btn.dataset.tab === 'catalog' ? 'block' : 'none';
    document.getElementById('loansPanel').style.display = btn.dataset.tab === 'loans' ? 'block' : 'none';
  });
});

/* ---------- Data loading ---------- */
async function loadLibrary() {
  isLoading = true;
  loadError = null;
  renderCatalog();
  renderLoans();

  try {
    const [catalog, loans, students] = await Promise.all([
      SmsAuth.apiFetch('/library'),
      SmsAuth.apiFetch('/library-loans'),
      SmsAuth.apiFetch('/students').catch(() => []),
    ]);
    catalogState = catalog;
    loansState = loans;
    studentsState = students;
    populateLoanSelects();
  } catch (err) {
    loadError = err.message;
  } finally {
    isLoading = false;
    renderCatalog();
    renderLoans();
  }
}

function populateLoanSelects() {
  document.getElementById('loanBookSelect').innerHTML = catalogState
    .map(b => `<option value="${b.id}">${b.title} (${b.copiesAvailable ?? b.copiesTotal} available)</option>`)
    .join('') || '<option value="">Add books first</option>';

  document.getElementById('loanStudentSelect').innerHTML = studentsState
    .map(s => `<option value="${s.id}">${s.name} — ${s.class || 'No class'}</option>`)
    .join('') || '<option value="">Add students first</option>';
}

/* ---------- Catalog rendering ---------- */
function renderCatalog() {
  const tbody = document.getElementById('catalogTableBody');
  const user = SmsAuth.getUser();
  const canManage = user && ['admin', 'teacher'].includes(user.role);

  if (isLoading) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="loading-state">Loading catalog…</div></td></tr>`;
    return;
  }
  if (loadError) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="error-state">Couldn't load catalog: ${loadError}</div></td></tr>`;
    return;
  }

  const filtered = catalogState.filter(b =>
    `${b.title} ${b.author}`.toLowerCase().includes(catalogSearch.toLowerCase())
  );

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state">No books in the catalog yet.</div></td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(b => {
    const available = b.copiesAvailable ?? b.copiesTotal ?? 0;
    return `
      <tr>
        <td>${b.title}</td>
        <td>${b.author}</td>
        <td>${b.category || '—'}</td>
        <td><span class="avail-pill ${available > 0 ? 'is-ok' : 'is-low'}">${available} / ${b.copiesTotal}</span></td>
        <td>
          ${canManage ? `
            <div class="row-actions">
              <button class="icon-btn" data-edit-book="${b.id}">Edit</button>
              <button class="icon-btn danger" data-delete-book="${b.id}">Delete</button>
            </div>
          ` : ''}
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('[data-edit-book]').forEach(btn => {
    btn.addEventListener('click', () => openBookModal(btn.dataset.editBook));
  });
  tbody.querySelectorAll('[data-delete-book]').forEach(btn => {
    btn.addEventListener('click', () => deleteBook(btn.dataset.deleteBook));
  });
}

/* ---------- Loans rendering ---------- */
function renderLoans() {
  const tbody = document.getElementById('loansTableBody');
  const user = SmsAuth.getUser();
  const canManage = user && ['admin', 'teacher'].includes(user.role);

  document.getElementById('loansTitle').textContent = user.role === 'parent' ? "Your Children's Loans" : 'Active Loans';

  if (isLoading) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="loading-state">Loading loans…</div></td></tr>`;
    return;
  }
  if (loadError) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="error-state">Couldn't load loans: ${loadError}</div></td></tr>`;
    return;
  }

  if (!loansState.length) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state">No loans recorded yet.</div></td></tr>`;
    return;
  }

  const sorted = [...loansState].sort((a, b) => new Date(b.borrowedDate) - new Date(a.borrowedDate));

  tbody.innerHTML = sorted.map(l => {
    const isReturned = !!l.returnedDate;
    const isOverdue = !isReturned && l.dueDate && new Date(l.dueDate) < new Date();
    const status = isReturned ? 'returned' : (isOverdue ? 'overdue' : 'out');
    return `
      <tr>
        <td>${l.itemTitle}</td>
        <td>${l.studentName}</td>
        <td>${new Date(l.borrowedDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</td>
        <td>${l.dueDate ? new Date(l.dueDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—'}</td>
        <td><span class="status-pill status-pill--${status}">${status}</span></td>
        <td>
          ${canManage && !isReturned ? `<button class="icon-btn" data-return="${l.id}">Mark Returned</button>` : ''}
          ${canManage ? `<button class="icon-btn danger" data-delete-loan="${l.id}">Delete</button>` : ''}
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('[data-return]').forEach(btn => {
    btn.addEventListener('click', () => markReturned(btn.dataset.return));
  });
  tbody.querySelectorAll('[data-delete-loan]').forEach(btn => {
    btn.addEventListener('click', () => deleteLoan(btn.dataset.deleteLoan));
  });
}

/* ---------- Book modal / CRUD ---------- */
const bookOverlay = document.getElementById('bookModalOverlay');
const bookForm = document.getElementById('bookForm');

function openBookModal(id = null) {
  const record = id ? catalogState.find(b => b.id === id) : null;
  document.getElementById('bookModalTitle').textContent = record ? 'Edit Book' : 'Add Book';
  document.getElementById('bookId').value = record?.id || '';
  document.getElementById('bookTitle').value = record?.title || '';
  document.getElementById('bookAuthor').value = record?.author || '';
  document.getElementById('bookCategory').value = record?.category || '';
  document.getElementById('bookIsbn').value = record?.isbn || '';
  document.getElementById('bookCopies').value = record?.copiesTotal || 1;
  bookOverlay.classList.add('is-open');
}

function closeBookModal() {
  bookOverlay.classList.remove('is-open');
  bookForm.reset();
}

bookForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('bookId').value;
  const copiesTotal = Number(document.getElementById('bookCopies').value);
  const existing = id ? catalogState.find(b => b.id === id) : null;
  // Preserve however many are already checked out when editing total copies
  const checkedOut = existing ? (existing.copiesTotal - (existing.copiesAvailable ?? existing.copiesTotal)) : 0;

  const payload = {
    title: document.getElementById('bookTitle').value.trim(),
    author: document.getElementById('bookAuthor').value.trim(),
    category: document.getElementById('bookCategory').value.trim(),
    isbn: document.getElementById('bookIsbn').value.trim(),
    copiesTotal,
    copiesAvailable: Math.max(0, copiesTotal - checkedOut),
  };

  const submitBtn = bookForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Saving…';

  try {
    if (id) {
      await SmsAuth.apiFetch(`/library/${id}`, { method: 'PATCH', body: payload });
    } else {
      await SmsAuth.apiFetch('/library', { method: 'POST', body: payload });
    }
    closeBookModal();
    await loadLibrary();
  } catch (err) {
    alert(`Couldn't save: ${err.message}`);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Save';
  }
});

async function deleteBook(id) {
  if (!confirm('Delete this book from the catalog?')) return;
  try {
    await SmsAuth.apiFetch(`/library/${id}`, { method: 'DELETE' });
    await loadLibrary();
  } catch (err) {
    alert(`Couldn't delete: ${err.message}`);
  }
}

/* ---------- Loan modal / CRUD ---------- */
const loanOverlay = document.getElementById('loanModalOverlay');
const loanForm = document.getElementById('loanForm');

function openLoanModal() {
  loanForm.reset();
  document.getElementById('loanBorrowedDate').value = new Date().toISOString().slice(0, 10);
  loanOverlay.classList.add('is-open');
}

function closeLoanModal() {
  loanOverlay.classList.remove('is-open');
  loanForm.reset();
}

loanForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const bookId = document.getElementById('loanBookSelect').value;
  const studentId = document.getElementById('loanStudentSelect').value;
  const book = catalogState.find(b => b.id === bookId);
  const student = studentsState.find(s => s.id === studentId);

  if (!book || (book.copiesAvailable ?? book.copiesTotal) < 1) {
    alert('No copies of this book are currently available.');
    return;
  }

  const payload = {
    itemId: bookId,
    itemTitle: book.title,
    studentId,
    studentName: student?.name || '',
    borrowedDate: document.getElementById('loanBorrowedDate').value,
    dueDate: document.getElementById('loanDueDate').value,
    returnedDate: null,
  };

  const submitBtn = loanForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Saving…';

  try {
    await SmsAuth.apiFetch('/library-loans', { method: 'POST', body: payload });
    await SmsAuth.apiFetch(`/library/${bookId}`, {
      method: 'PATCH',
      body: { copiesAvailable: (book.copiesAvailable ?? book.copiesTotal) - 1 },
    });
    closeLoanModal();
    await loadLibrary();
  } catch (err) {
    alert(`Couldn't save loan: ${err.message}`);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Save';
  }
});

async function markReturned(loanId) {
  const loan = loansState.find(l => l.id === loanId);
  if (!loan) return;
  try {
    await SmsAuth.apiFetch(`/library-loans/${loanId}`, {
      method: 'PATCH',
      body: { returnedDate: new Date().toISOString().slice(0, 10) },
    });
    const book = catalogState.find(b => b.id === loan.itemId);
    if (book) {
      await SmsAuth.apiFetch(`/library/${book.id}`, {
        method: 'PATCH',
        body: { copiesAvailable: (book.copiesAvailable ?? book.copiesTotal) + 1 },
      });
    }
    await loadLibrary();
  } catch (err) {
    alert(`Couldn't update loan: ${err.message}`);
  }
}

async function deleteLoan(id) {
  if (!confirm('Delete this loan record?')) return;
  try {
    await SmsAuth.apiFetch(`/library-loans/${id}`, { method: 'DELETE' });
    await loadLibrary();
  } catch (err) {
    alert(`Couldn't delete: ${err.message}`);
  }
}

/* ---------- Events ---------- */
document.getElementById('newBookBtn').addEventListener('click', () => openBookModal());
document.getElementById('cancelBookModalBtn').addEventListener('click', closeBookModal);
bookOverlay.addEventListener('click', (e) => { if (e.target === bookOverlay) closeBookModal(); });

document.getElementById('newLoanBtn').addEventListener('click', () => openLoanModal());
document.getElementById('cancelLoanModalBtn').addEventListener('click', closeLoanModal);
loanOverlay.addEventListener('click', (e) => { if (e.target === loanOverlay) closeLoanModal(); });

document.getElementById('catalogSearch').addEventListener('input', (e) => {
  catalogSearch = e.target.value;
  renderCatalog();
});

/* ---------- Init ---------- */
loadLibrary();
