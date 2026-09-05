/* =========================================================
   Timetable module — School Management System
   Weekly per-class schedule. Create/edit/delete is admin-only.
========================================================= */

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

let timetableState = [];
let studentsState = [];
let teachersState = [];
let isLoading = true;
let loadError = null;

/* ---------- Data loading ---------- */
async function loadTimetable() {
  isLoading = true;
  loadError = null;
  renderGrid();
  try {
    const [slots, students, teachers] = await Promise.all([
      SmsAuth.apiFetch('/timetable'),
      SmsAuth.apiFetch('/students').catch(() => []),
      SmsAuth.apiFetch('/teachers').catch(() => []),
    ]);
    timetableState = slots;
    studentsState = students;
    teachersState = teachers;
    populateClassSelect();
    populateTeacherSelect();
  } catch (err) {
    loadError = err.message;
  } finally {
    isLoading = false;
    renderGrid();
  }
}

function populateClassSelect() {
  const select = document.getElementById('classSelect');
  const fromStudents = studentsState.map(s => s.class).filter(Boolean);
  const fromTimetable = timetableState.map(t => t.className).filter(Boolean);
  const classes = [...new Set([...fromStudents, ...fromTimetable])].sort();
  const currentValue = select.value;
  select.innerHTML = classes.map(c => `<option value="${c}">${c}</option>`).join('') || '<option value="">No classes yet</option>';
  if (classes.includes(currentValue)) select.value = currentValue;
}

function populateTeacherSelect() {
  const select = document.getElementById('slotTeacherSelect');
  select.innerHTML = `<option value="">Unassigned</option>` + teachersState.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
}

/* ---------- Rendering ---------- */
function renderGrid() {
  const grid = document.getElementById('timetableGrid');
  const user = SmsAuth.getUser();
  const canManage = user && user.role === 'admin';

  if (isLoading) {
    grid.innerHTML = `<div class="loading-state">Loading timetable…</div>`;
    return;
  }
  if (loadError) {
    grid.innerHTML = `<div class="error-state">Couldn't load timetable: ${loadError}</div>`;
    return;
  }

  const selectedClass = document.getElementById('classSelect').value;
  const slotsForClass = timetableState.filter(t => t.className === selectedClass);

  grid.innerHTML = DAYS.map(day => {
    const daySlots = slotsForClass
      .filter(s => s.day === day)
      .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));

    return `
      <div class="day-column">
        <h4>${day}</h4>
        ${daySlots.length ? daySlots.map(s => `
          <div class="period-card">
            ${canManage ? `
              <div class="period-actions">
                <button data-edit="${s.id}" title="Edit">✎</button>
                <button data-delete="${s.id}" title="Delete">×</button>
              </div>
            ` : ''}
            <span class="period-time">${s.startTime || ''}–${s.endTime || ''}</span>
            <span class="period-subject">${s.subject}</span>
            ${s.teacherId ? `<span class="period-teacher">${teacherName(s.teacherId)}</span>` : ''}
          </div>
        `).join('') : `<div class="day-empty">No periods</div>`}
      </div>
    `;
  }).join('');

  grid.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => openModal(btn.dataset.edit));
  });
  grid.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', () => deleteSlot(btn.dataset.delete));
  });
}

function teacherName(id) {
  return teachersState.find(t => t.id === id)?.name || 'Unassigned';
}

/* ---------- Modal / CRUD ---------- */
const overlay = document.getElementById('slotModalOverlay');
const form = document.getElementById('slotForm');

function openModal(id = null) {
  const record = id ? timetableState.find(s => s.id === id) : null;
  document.getElementById('modalTitle').textContent = record ? 'Edit Period' : 'Add Period';
  document.getElementById('slotId').value = record?.id || '';
  document.getElementById('slotClass').value = record?.className || document.getElementById('classSelect').value || '';
  document.getElementById('slotDay').value = record?.day || 'Monday';
  document.getElementById('slotSubject').value = record?.subject || '';
  document.getElementById('slotStart').value = record?.startTime || '';
  document.getElementById('slotEnd').value = record?.endTime || '';
  document.getElementById('slotTeacherSelect').value = record?.teacherId || '';
  overlay.classList.add('is-open');
}

function closeModal() {
  overlay.classList.remove('is-open');
  form.reset();
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('slotId').value;
  const payload = {
    className: document.getElementById('slotClass').value.trim(),
    day: document.getElementById('slotDay').value,
    subject: document.getElementById('slotSubject').value.trim(),
    startTime: document.getElementById('slotStart').value,
    endTime: document.getElementById('slotEnd').value,
    teacherId: document.getElementById('slotTeacherSelect').value || null,
  };

  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Saving…';

  try {
    if (id) {
      await SmsAuth.apiFetch(`/timetable/${id}`, { method: 'PATCH', body: payload });
    } else {
      await SmsAuth.apiFetch('/timetable', { method: 'POST', body: payload });
    }
    closeModal();
    await loadTimetable();
  } catch (err) {
    alert(`Couldn't save: ${err.message}`);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Save';
  }
});

async function deleteSlot(id) {
  if (!confirm('Delete this period?')) return;
  try {
    await SmsAuth.apiFetch(`/timetable/${id}`, { method: 'DELETE' });
    await loadTimetable();
  } catch (err) {
    alert(`Couldn't delete: ${err.message}`);
  }
}

/* ---------- Events ---------- */
document.getElementById('newSlotBtn').addEventListener('click', () => openModal());
document.getElementById('cancelModalBtn').addEventListener('click', closeModal);
overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
document.getElementById('classSelect').addEventListener('change', renderGrid);

/* ---------- Init ---------- */
loadTimetable();
