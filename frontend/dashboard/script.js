/* =========================================================
   Dashboard module — School Management System
   Reads from localStorage where possible (falls back to
   sample data), same pattern as the Students/Teachers modules.
   Swap the `fetchX()` functions for your Express endpoints
   when the backend is wired up.
========================================================= */

const STORAGE_KEYS = {
  students: "sms_students",
  teachers: "sms_teachers",
  announcements: "sms_announcements",
  events: "sms_calendar_events",
  fees: "sms_pending_fees",
  attendance: "sms_attendance",
};

/* ---------- Sample fallback data ---------- */
const SAMPLE = {
  announcements: [
    {
      id: 1,
      title: "Mid-term exams begin Monday",
      body: "All classes to follow the revised exam timetable posted on the noticeboard.",
      tag: "urgent",
      date: "2026-08-04",
    },
    {
      id: 2,
      title: "PTA meeting rescheduled",
      body: "Moved to Friday 3:00 PM in the main hall due to the inter-house games.",
      tag: "info",
      date: "2026-08-03",
    },
    {
      id: 3,
      title: "New library books arrived",
      body: "Grade 6–8 students can now borrow the new science fiction collection.",
      tag: "info",
      date: "2026-08-01",
    },
    {
      id: 4,
      title: "Sports day sponsors needed",
      body: "Reach out to the PTA office if your business would like to sponsor a house.",
      tag: "general",
      date: "2026-07-29",
    },
  ],
  events: [
    { date: "2026-08-07", name: "Mid-term exams begin" },
    { date: "2026-08-10", name: "PTA meeting" },
    { date: "2026-08-14", name: "Inter-house sports day" },
    { date: "2026-08-21", name: "Term 2 closing day" },
  ],
  fees: [
    {
      student: "Amina Otieno",
      class: "Grade 7B",
      amount: 8500,
      due: "2026-08-10",
    },
    {
      student: "Brian Mwangi",
      class: "Grade 5A",
      amount: 12000,
      due: "2026-08-12",
    },
    {
      student: "Cynthia Wafula",
      class: "Grade 8C",
      amount: 5000,
      due: "2026-08-15",
    },
    {
      student: "David Kiprotich",
      class: "Grade 6A",
      amount: 9250,
      due: "2026-08-09",
    },
  ],
  students: Array.from({ length: 342 }),
  teachers: Array.from({ length: 24 }),
  enrollmentByClass: [
    { label: "G4", value: 52 },
    { label: "G5", value: 48 },
    { label: "G6", value: 61 },
    { label: "G7", value: 58 },
    { label: "G8", value: 55 },
    { label: "G9", value: 68 },
  ],
  attendanceLast7: [
    { day: "Wed", rate: 94 },
    { day: "Thu", rate: 96 },
    { day: "Fri", rate: 89 },
    { day: "Mon", rate: 97 },
    { day: "Tue", rate: 95 },
    { day: "Wed", rate: 93 },
    { day: "Today", rate: 96 },
  ],
  attendanceToday: 96,
  feesCollectedPct: 78,
};

function readStore(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length ? parsed : fallback;
  } catch {
    return fallback;
  }
}

/* ---------- Formatting helpers ---------- */
const money = (n) => `KSh ${Number(n).toLocaleString("en-KE")}`;
const shortDate = (iso) =>
  new Date(iso + "T00:00:00").toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
  });

/* =========================================================
   Announcements
========================================================= */
function renderAnnouncements() {
  const data = readStore(
    STORAGE_KEYS.announcements,
    SAMPLE.announcements,
  ).slice(0, 4);
  const list = document.getElementById("announcementList");
  const tagColor = {
    urgent: "var(--chalk-pink)",
    info: "var(--chalk-blue)",
    general: "var(--chalk-green)",
  };

  list.innerHTML = data
    .map(
      (a) => `
    <li class="announcement-item">
      <span class="announcement-dot" style="background:${tagColor[a.tag] || "var(--chalk-white-dim)"}"></span>
      <div class="announcement-body">
        <h4>${a.title}</h4>
        <p>${a.body}</p>
        <span class="announcement-meta">${shortDate(a.date)}</span>
      </div>
    </li>
  `,
    )
    .join("");
}

/* =========================================================
   Calendar
========================================================= */
let calCursor = new Date(2026, 7, 1); // August 2026 — replace with `new Date()` in production

function renderCalendar() {
  const events = readStore(STORAGE_KEYS.events, SAMPLE.events);
  const grid = document.getElementById("calendarGrid");
  const label = document.getElementById("calMonthLabel");

  const year = calCursor.getFullYear();
  const month = calCursor.getMonth();
  const today = new Date(2026, 7, 5); // "current date" per system context

  label.textContent = calCursor.toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  });

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const eventDays = new Set(
    events
      .filter((e) => {
        const d = new Date(e.date + "T00:00:00");
        return d.getFullYear() === year && d.getMonth() === month;
      })
      .map((e) => new Date(e.date + "T00:00:00").getDate()),
  );

  const dow = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
  let html = dow.map((d) => `<div class="cal-dow">${d}</div>`).join("");

  for (let i = 0; i < firstDay; i++)
    html += `<div class="cal-day is-empty"></div>`;

  for (let day = 1; day <= daysInMonth; day++) {
    const isToday =
      year === today.getFullYear() &&
      month === today.getMonth() &&
      day === today.getDate();
    const hasEvent = eventDays.has(day);
    html += `<div class="cal-day ${isToday ? "is-today" : ""} ${hasEvent ? "has-event" : ""}">${day}</div>`;
  }

  grid.innerHTML = html;

  const eventList = document.getElementById("calEventList");
  const upcoming = events
    .filter((e) => new Date(e.date + "T00:00:00") >= today)
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(0, 4);

  eventList.innerHTML =
    upcoming
      .map(
        (e) => `
    <li class="cal-event-item">
      <span class="cal-event-date">${shortDate(e.date)}</span>
      <span class="cal-event-name">${e.name}</span>
    </li>
  `,
      )
      .join("") ||
    '<li class="cal-event-item"><span class="cal-event-name">No upcoming events.</span></li>';
}

document.getElementById("calPrev").addEventListener("click", () => {
  calCursor.setMonth(calCursor.getMonth() - 1);
  renderCalendar();
});
document.getElementById("calNext").addEventListener("click", () => {
  calCursor.setMonth(calCursor.getMonth() + 1);
  renderCalendar();
});

/* =========================================================
   Pending Fees
========================================================= */
function renderFees() {
  const data = readStore(STORAGE_KEYS.fees, SAMPLE.fees);
  const tbody = document.getElementById("feesTableBody");
  const total = data.reduce((sum, f) => sum + Number(f.amount), 0);

  document.getElementById("feesTotalBadge").textContent = money(total);

  tbody.innerHTML = data
    .map(
      (f) => `
    <tr>
      <td>${f.student}</td>
      <td>${f.class}</td>
      <td class="amount-due">${money(f.amount)}</td>
      <td>${shortDate(f.due)}</td>
      <td><button class="remind-btn" data-remind="${f.student}">Remind</button></td>
    </tr>
  `,
    )
    .join("");

  tbody.querySelectorAll("[data-remind]").forEach((btn) => {
    btn.addEventListener("click", () => {
      alert(
        `Reminder queued for ${btn.dataset.remind}. Wire this up to your notifications/email service.`,
      );
    });
  });
}

/* =========================================================
   Charts & Statistics
========================================================= */
function renderStatCards() {
  const students = readStore(STORAGE_KEYS.students, SAMPLE.students);
  const teachers = readStore(STORAGE_KEYS.teachers, SAMPLE.teachers);

  document.getElementById("statTotalStudents").textContent = students.length;
  document.getElementById("statTotalTeachers").textContent = teachers.length;
  document.getElementById("statAttendanceRate").textContent =
    `${SAMPLE.attendanceToday}%`;
  document.getElementById("statFeesCollected").textContent =
    `${SAMPLE.feesCollectedPct}%`;
}

function chalkChartDefaults() {
  Chart.defaults.color = getComputedStyle(document.body)
    .getPropertyValue("--chalk-white-dim")
    .trim();
  Chart.defaults.font.family = "'Courier Prime', monospace";
  Chart.defaults.font.size = 11;
}

function renderCharts() {
  chalkChartDefaults();
  const chalkWhite = "#f0ede1";
  const chalkYellow = "#e3c567";
  const chalkBlue = "#7fb3c9";
  const gridColor = "rgba(240,237,225,0.08)";

  // Enrollment by class — chalk-sketch bar chart
  new Chart(document.getElementById("enrollmentChart"), {
    type: "bar",
    data: {
      labels: SAMPLE.enrollmentByClass.map((d) => d.label),
      datasets: [
        {
          data: SAMPLE.enrollmentByClass.map((d) => d.value),
          backgroundColor: "transparent",
          borderColor: chalkYellow,
          borderWidth: 2,
          borderRadius: 3,
          barThickness: 18,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, border: { color: gridColor } },
        y: {
          grid: { color: gridColor },
          border: { display: false },
          beginAtZero: true,
        },
      },
    },
  });

  // Attendance last 7 days — chalk-sketch line chart
  new Chart(document.getElementById("attendanceChart"), {
    type: "line",
    data: {
      labels: SAMPLE.attendanceLast7.map((d) => d.day),
      datasets: [
        {
          data: SAMPLE.attendanceLast7.map((d) => d.rate),
          borderColor: chalkBlue,
          backgroundColor: "transparent",
          borderWidth: 2,
          tension: 0.35,
          pointBackgroundColor: chalkWhite,
          pointRadius: 3,
          borderDash: [0],
        },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, border: { color: gridColor } },
        y: {
          grid: { color: gridColor },
          border: { display: false },
          suggestedMin: 80,
          suggestedMax: 100,
        },
      },
    },
  });
}

/* =========================================================
   Quick Actions
   NOTE: this dashboard is standalone right now — it doesn't
   assume attendance/fees/announcements pages exist. Each
   action below shows a placeholder toast. Once you build
   those modules, replace the toast call with:
     window.location.href = '../attendance/index.html';
   (adjust the path to match your real folder structure)
========================================================= */
function showToast(message) {
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add("is-visible"));
  setTimeout(() => {
    toast.classList.remove("is-visible");
    setTimeout(() => toast.remove(), 300);
  }, 2600);
}

const ACTION_MESSAGES = {
  "mark-attendance": "This will open your Attendance module once it's built.",
  "record-payment": "This will open your Fees module once it's built.",
};

document.querySelectorAll(".chalk-btn[data-action]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const action = btn.dataset.action;
    if (action === "export-report") {
      exportSummaryCSV();
      return;
    }
    if (action === "new-announcement") {
      window.location.href = "../announcements/index.html?action=new";
      return;
    }
    showToast(ACTION_MESSAGES[action] || "Coming soon.");
  });
});

document
  .querySelector('[data-action="view-all-announcements"]')
  ?.addEventListener("click", () => {
    window.location.href = "../announcements/index.html";
  });

function exportSummaryCSV() {
  const fees = readStore(STORAGE_KEYS.fees, SAMPLE.fees);
  const rows = [
    ["Student", "Class", "Amount Due", "Due Date"],
    ...fees.map((f) => [f.student, f.class, f.amount, f.due]),
  ];
  const csv = rows.map((r) => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "pending-fees-report.csv";
  a.click();
  URL.revokeObjectURL(url);
}

/* =========================================================
   Welcome Banner
========================================================= */
function renderWelcomeBanner() {
  const user = (typeof SmsAuth !== 'undefined' && SmsAuth.getUser) ? SmsAuth.getUser() : null;
  const firstName = user?.name ? user.name.split(' ')[0] : 'back';
  document.getElementById('welcomeHeading').textContent = `Welcome back, ${firstName}!`;

  const students = readStore(STORAGE_KEYS.students, SAMPLE.students);
  const teachers = readStore(STORAGE_KEYS.teachers, SAMPLE.teachers);
  const events = readStore(STORAGE_KEYS.events, SAMPLE.events);
  const upcomingCount = events.filter(e => new Date(e.date + 'T00:00:00') >= new Date(2026, 7, 5)).length;

  document.getElementById('welcomeChips').innerHTML = `
    <span class="welcome-chip">${students.length} Students</span>
    <span class="welcome-chip">${teachers.length} Teachers</span>
    <span class="welcome-chip">${upcomingCount} Upcoming Events</span>
  `;
}

/* =========================================================
   Init
========================================================= */
function setTodayChip() {
  const today = new Date(2026, 7, 5);
  document.getElementById("todayDate").textContent = today.toLocaleDateString(
    "en-GB",
    {
      weekday: "long",
      day: "numeric",
      month: "long",
    },
  );
}

function init() {
  setTodayChip();
  renderWelcomeBanner();
  renderAnnouncements();
  renderCalendar();
  renderFees();
  renderStatCards();
  renderCharts();
}

document.addEventListener("DOMContentLoaded", init);
