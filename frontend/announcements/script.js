/* =========================================================
   Announcements module — School Management System
   Now backed by the real API (see /shared/auth-client.js).
   Requires auth-client.js + auth-guard.js to be loaded first.
========================================================= */

const PAGE_SIZE = 5;

let announcementsState = [];
let currentPage = 1;
let searchTerm = '';
let tagFilter = 'all';
let isLoading = true;
let loadError = null;

const shortDate = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

/* ---------- Data loading ---------- */
async function loadAnnouncements() {
  isLoading = true;
  loadError = null;
  renderFeed();
  try {
    announcementsState = await SmsAuth.apiFetch('/announcements');
  } catch (err) {
    loadError = err.message;
  } finally {
    isLoading = false;
    renderFeed();
  }
}

/* ---------- Derived views ---------- */
function getFiltered() {
  return announcementsState
    .filter(a => a.title.toLowerCase().includes(searchTerm.toLowerCase()) || a.body.toLowerCase().includes(searchTerm.toLowerCase()))
    .filter(a => tagFilter === 'all' || a.tag === tagFilter)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/* ---------- Rendering ---------- */
function renderFeed() {
  const feed = document.getElementById('announcementFeed');
  const user = SmsAuth.getUser();
  const canManage = user && ['admin', 'teacher'].includes(user.role);

  if (isLoading) {
    feed.innerHTML = `<div class="loading-state">Loading announcements…</div>`;
    document.getElementById('pagination').innerHTML = '';
    return;
  }

  if (loadError) {
    feed.innerHTML = `<div class="error-state">Couldn't load announcements: ${loadError}</div>`;
    document.getElementById('pagination').innerHTML = '';
    return;
  }

  const filtered = getFiltered();
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  currentPage = Math.min(currentPage, totalPages);

  const start = (currentPage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);

  if (!pageItems.length) {
    feed.innerHTML = `<div class="empty-state">No announcements match your filters.</div>`;
  } else {
    feed.innerHTML = pageItems.map(a => `
      <div class="announcement-card">
        <div class="announcement-card-head">
          <h4>${a.title}</h4>
          <div class="announcement-tags">
            <span class="tag-chip tag-chip--${a.tag}">${a.tag}</span>
          </div>
        </div>
        <p>${a.body}</p>
        <div class="announcement-footer">
          <span>${shortDate(a.createdAt)} · ${a.audience === 'all' ? 'Everyone' : a.audience}</span>
          ${canManage ? `
            <div class="row-actions">
              <button class="icon-btn" data-edit="${a.id}">Edit</button>
              <button class="icon-btn danger" data-delete="${a.id}">Delete</button>
            </div>
          ` : ''}
        </div>
      </div>
    `).join('');
  }

  renderPagination(totalPages);

  feed.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => openModal(btn.dataset.edit));
  });
  feed.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', () => deleteAnnouncement(btn.dataset.delete));
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

  el.querySelector('#prevPage').addEventListener('click', () => { currentPage--; renderFeed(); });
  el.querySelector('#nextPage').addEventListener('click', () => { currentPage++; renderFeed(); });
  el.querySelectorAll('[data-page]').forEach(btn => {
    btn.addEventListener('click', () => { currentPage = Number(btn.dataset.page); renderFeed(); });
  });
}

/* ---------- Modal / CRUD ---------- */
const overlay = document.getElementById('announcementModalOverlay');
const form = document.getElementById('announcementForm');

function openModal(id = null) {
  const record = id ? announcementsState.find(a => a.id === id) : null;
  document.getElementById('modalTitle').textContent = record ? 'Edit Announcement' : 'New Announcement';
  document.getElementById('announcementId').value = record?.id || '';
  document.getElementById('annTitle').value = record?.title || '';
  document.getElementById('annBody').value = record?.body || '';
  document.getElementById('annTag').value = record?.tag || 'general';
  document.getElementById('annAudience').value = record?.audience || 'all';
  overlay.classList.add('is-open');
}

function closeModal() {
  overlay.classList.remove('is-open');
  form.reset();
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('announcementId').value;
  const payload = {
    title: document.getElementById('annTitle').value.trim(),
    body: document.getElementById('annBody').value.trim(),
    tag: document.getElementById('annTag').value,
    audience: document.getElementById('annAudience').value,
  };

  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Saving…';

  try {
    if (id) {
      await SmsAuth.apiFetch(`/announcements/${id}`, { method: 'PATCH', body: payload });
    } else {
      await SmsAuth.apiFetch('/announcements', { method: 'POST', body: payload });
    }
    closeModal();
    await loadAnnouncements();
  } catch (err) {
    alert(`Couldn't save: ${err.message}`);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Publish';
  }
});

async function deleteAnnouncement(id) {
  if (!confirm('Delete this announcement?')) return;
  try {
    await SmsAuth.apiFetch(`/announcements/${id}`, { method: 'DELETE' });
    await loadAnnouncements();
  } catch (err) {
    alert(`Couldn't delete: ${err.message}`);
  }
}

/* ---------- Events ---------- */
document.getElementById('newAnnouncementBtn').addEventListener('click', () => openModal());
document.getElementById('cancelModalBtn').addEventListener('click', closeModal);
overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

document.getElementById('searchInput').addEventListener('input', (e) => {
  searchTerm = e.target.value;
  currentPage = 1;
  renderFeed();
});

document.getElementById('tagFilter').addEventListener('change', (e) => {
  tagFilter = e.target.value;
  currentPage = 1;
  renderFeed();
});

/* ---------- Init ---------- */
loadAnnouncements().then(() => {
  if (new URLSearchParams(window.location.search).get('action') === 'new') {
    openModal();
  }
});
