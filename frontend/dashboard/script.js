/* =========================================================
   Dashboard module — School Management System
   Pulls live data from the backend API. Requires
   auth-client.js + auth-guard.js loaded first.
========================================================= */

let calCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let cachedEvents = [];

const money = (n) => `KSh ${Number(n || 0).toLocaleString('en-KE')}`;
const shortDate = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
const todayStr = () => new Date().toISOString().slice(0, 10);

/* =========================================================
   Data loading — fetch everything in parallel, tolerate
   individual failures (e.g. a module's collection is empty
   or a role can't read one of them) without breaking the rest.
========================================================= */
async function loadDashboard() {
  const user = SmsAuth.getUser();
  document.getElementById('dashSubtitle').textContent =
    user.role === 'parent' ? "Your children's overview" : 'Everything at a glance';

  const results = await Promise.allSettled([
    SmsAuth.apiFetch('/announcements'),
    SmsAuth.apiFetch('/events'),
    SmsAuth.apiFetch('/fees'),
    SmsAuth.apiFetch('/students'),
    SmsAuth.apiFetch('/teachers'),
    SmsAuth.apiFetch('/attendance'),
  ]);

  const [announcementsR, eventsR, feesR, studentsR, teachersR, attendanceR] = results;

  const announcements = announcementsR.status === 'fulfilled' ? announcementsR.value : [];
  const events = eventsR.status === 'fulfilled' ? eventsR.value : [];
  const fees = feesR.status === 'fulfilled' ? feesR.value : [];
  const students = studentsR.status === 'fulfilled' ? studentsR.value : [];
  const teachers = teachersR.status === 'fulfilled' ? teachersR.value : [];
  const attendance = attendanceR.status === 'fulfilled' ? attendanceR.value : [];

  cachedEvents = events;

  renderAnnouncements(announcements, announcementsR.status === 'rejected' ? announcementsR.reason.message : null);
  renderCalendar();
  renderFees(fees);
  renderStats(students, teachers, attendance, fees);
  renderCharts(students, attendance);

  // Stash for quick-action export
  window.__dashboardFees = fees;
}

/* =========================================================
   Announcements
========================================================= */
function renderAnnouncements(announcements, error) {
  const list = document.getElementById('announcementList');
  const tagColor = { urgent: 'var(--chalk-pink)', info: 'var(--chalk-blue)', general: 'var(--chalk-green)' };

  if (error) {
    list.innerHTML = `<li class="error-state">Couldn't load announcements: ${error}</li>`;
    return;
  }

  const recent = [...announcements].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 4);

  if (!recent.length) {
    list.innerHTML = `<li class="empty-state">No announcements yet.</li>`;
    return;
  }

  list.innerHTML = recent.map(a => `
    <li class="announcement-item">
      <span class="announcement-dot" style="background:${tagColor[a.tag] || 'var(--chalk-white-dim)'}"></span>
      <div class="announcement-body">
        <h4>${a.title}</h4>
        <p>${a.body}</p>
        <span class="announcement-meta">${shortDate(a.createdAt)}</span>
      </div>
    </li>
  `).join('');
}

/* =========================================================
   Calendar
========================================================= */
function renderCalendar() {
  const grid = document.getElementById('calendarGrid');
  const label = document.getElementById('calMonthLabel');

  const year = calCursor.getFullYear();
  const month = calCursor.getMonth();
  const today = new Date();

  label.textContent = calCursor.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const eventDays = new Set(
    cachedEvents
      .filter(e => {
        const d = new Date(e.date);
        return d.getFullYear() === year && d.getMonth() === month;
      })
      .map(e => new Date(e.date).getDate())
  );

  const dow = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  let html = dow.map(d => `<div class="cal-dow">${d}</div>`).join('');
  for (let i = 0; i < firstDay; i++) html += `<div class="cal-day is-empty"></div>`;

  for (let day = 1; day <= daysInMonth; day++) {
    const isToday = year === today.getFullYear() && month === today.getMonth() && day === today.getDate();
    const hasEvent = eventDays.has(day);
    html += `<div class="cal-day ${isToday ? 'is-today' : ''} ${hasEvent ? 'has-event' : ''}">${day}</div>`;
  }
  grid.innerHTML = html;

  const eventList = document.getElementById('calEventList');
  const upcoming = cachedEvents
    .filter(e => new Date(e.date) >= new Date(today.toDateString()))
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(0, 4);

  eventList.innerHTML = upcoming.length
    ? upcoming.map(e => `
        <li class="cal-event-item">
          <span class="cal-event-date">${shortDate(e.date)}</span>
          <span class="cal-event-name">${e.name}</span>
        </li>
      `).join('')
    : `<li class="cal-event-item"><span class="cal-event-name">No upcoming events.</span></li>`;
}

document.getElementById('calPrev').addEventListener('click', () => {
  calCursor.setMonth(calCursor.getMonth() - 1);
  renderCalendar();
});
document.getElementById('calNext').addEventListener('click', () => {
  calCursor.setMonth(calCursor.getMonth() + 1);
  renderCalendar();
});

/* =========================================================
   Pending Fees
========================================================= */
function renderFees(fees) {
  const pending = fees.filter(f => f.status !== 'paid').sort((a, b) => new Date(a.due) - new Date(b.due));
  const tbody = document.getElementById('feesTableBody');
  const total = pending.reduce((sum, f) => sum + Number(f.amount || 0), 0);

  document.getElementById('feesTotalBadge').textContent = money(total);

  if (!pending.length) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state">No pending fees 🎉</div></td></tr>`;
    return;
  }

  tbody.innerHTML = pending.slice(0, 6).map(f => `
    <tr>
      <td>${f.studentName || f.student || '—'}</td>
      <td>${f.class || '—'}</td>
      <td class="amount-due">${money(f.amount)}</td>
      <td>${f.due ? shortDate(f.due) : '—'}</td>
      <td><button class="remind-btn" data-remind="${f.studentName || f.student}">Remind</button></td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-remind]').forEach(btn => {
    btn.addEventListener('click', () => {
      showToast(`Reminder queued for ${btn.dataset.remind}. Wire this up to your notifications/email service.`);
    });
  });
}

/* =========================================================
   Charts & Statistics
========================================================= */
function renderStats(students, teachers, attendance, fees) {
  document.getElementById('statTotalStudents').textContent = students.length;
  document.getElementById('statTotalTeachers').textContent = teachers.length;

  const todaysAttendance = attendance.filter(a => a.date === todayStr());
  const attendanceRate = todaysAttendance.length
    ? Math.round((todaysAttendance.filter(a => a.status === 'present').length / todaysAttendance.length) * 100)
    : null;
  document.getElementById('statAttendanceRate').textContent = attendanceRate === null ? '—' : `${attendanceRate}%`;

  const totalFees = fees.reduce((sum, f) => sum + Number(f.amount || 0), 0);
  const paidFees = fees.filter(f => f.status === 'paid').reduce((sum, f) => sum + Number(f.amount || 0), 0);
  const feesPct = totalFees ? Math.round((paidFees / totalFees) * 100) : 0;
  document.getElementById('statFeesCollected').textContent = `${feesPct}%`;
}

let enrollmentChartInstance = null;
let attendanceChartInstance = null;

function chalkChartDefaults() {
  Chart.defaults.color = '#cfcabb';
  Chart.defaults.font.family = "'Courier Prime', monospace";
  Chart.defaults.font.size = 11;
}

function renderCharts(students, attendance) {
  chalkChartDefaults();
  const chalkYellow = '#e3c567';
  const chalkBlue = '#7fb3c9';
  const chalkWhite = '#f0ede1';
  const gridColor = 'rgba(240,237,225,0.08)';

  // Enrollment by class
  const byClass = {};
  students.forEach(s => {
    const cls = s.class || 'Unassigned';
    byClass[cls] = (byClass[cls] || 0) + 1;
  });
  const classLabels = Object.keys(byClass).sort();
  const classValues = classLabels.map(l => byClass[l]);

  if (enrollmentChartInstance) enrollmentChartInstance.destroy();
  enrollmentChartInstance = new Chart(document.getElementById('enrollmentChart'), {
    type: 'bar',
    data: {
      labels: classLabels.length ? classLabels : ['No data'],
      datasets: [{
        data: classValues.length ? classValues : [0],
        backgroundColor: 'transparent',
        borderColor: chalkYellow,
        borderWidth: 2,
        borderRadius: 3,
        barThickness: 18,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, border: { color: gridColor } },
        y: { grid: { color: gridColor }, border: { display: false }, beginAtZero: true },
      },
    },
  });

  // Attendance — last 7 distinct dates present in the data
  const byDate = {};
  attendance.forEach(a => {
    if (!byDate[a.date]) byDate[a.date] = { present: 0, total: 0 };
    byDate[a.date].total++;
    if (a.status === 'present') byDate[a.date].present++;
  });
  const last7Dates = Object.keys(byDate).sort().slice(-7);
  const attLabels = last7Dates.map(d => new Date(d).toLocaleDateString('en-GB', { weekday: 'short' }));
  const attValues = last7Dates.map(d => Math.round((byDate[d].present / byDate[d].total) * 100));

  if (attendanceChartInstance) attendanceChartInstance.destroy();
  attendanceChartInstance = new Chart(document.getElementById('attendanceChart'), {
    type: 'line',
    data: {
      labels: attLabels.length ? attLabels : ['No data'],
      datasets: [{
        data: attValues.length ? attValues : [0],
        borderColor: chalkBlue,
        backgroundColor: 'transparent',
        borderWidth: 2,
        tension: 0.35,
        pointBackgroundColor: chalkWhite,
        pointRadius: 3,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, border: { color: gridColor } },
        y: { grid: { color: gridColor }, border: { display: false }, suggestedMin: 0, suggestedMax: 100 },
      },
    },
  });
}

/* =========================================================
   Quick Actions
========================================================= */
function showToast(message) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('is-visible'));
  setTimeout(() => {
    toast.classList.remove('is-visible');
    setTimeout(() => toast.remove(), 300);
  }, 2600);
}

const ACTION_MESSAGES = {};

document.querySelectorAll('.chalk-btn[data-action]').forEach(btn => {
  btn.addEventListener('click', () => {
    const action = btn.dataset.action;
    if (action === 'export-report') {
      exportSummaryCSV();
      return;
    }
    if (action === 'new-announcement') {
      window.location.href = '../announcements/index.html?action=new';
      return;
    }
    if (action === 'mark-attendance') {
      window.location.href = '../attendance/index.html';
      return;
    }
    if (action === 'record-payment') {
      window.location.href = '../fees/index.html?action=new';
      return;
    }
    showToast(ACTION_MESSAGES[action] || 'Coming soon.');
  });
});

document.querySelector('[data-action="view-all-announcements"]')?.addEventListener('click', () => {
  window.location.href = '../announcements/index.html';
});

function exportSummaryCSV() {
  const fees = window.__dashboardFees || [];
  const rows = [
    ['Student', 'Class', 'Amount Due', 'Due Date', 'Status'],
    ...fees.map(f => [f.studentName || f.student, f.class, f.amount, f.due, f.status]),
  ];
  const csv = rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'fees-report.csv';
  a.click();
  URL.revokeObjectURL(url);
}

/* =========================================================
   Init
========================================================= */
function setTodayChip() {
  document.getElementById('todayDate').textContent = new Date().toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
}

setTodayChip();
loadDashboard();
