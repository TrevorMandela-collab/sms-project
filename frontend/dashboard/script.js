const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const dashboardData = { errors: {} };

const DATA_PATHS = {
  students: "/students",
  teachers: "/teachers",
  classes: "/classes",
  subjects: "/subjects",
  attendance: "/attendance",
  fees: "/fees",
  exams: "/exams",
  announcements: "/announcements",
  events: "/events",
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function money(amount) {
  return `KSh ${Number(amount || 0).toLocaleString("en-KE")}`;
}

async function loadDashboardData() {
  const entries = Object.entries(DATA_PATHS);
  const results = await Promise.allSettled(
    entries.map(([, path]) => SmsAuth.apiFetch(path)),
  );
  dashboardData.errors = {};
  entries.forEach(([key], index) => {
    const result = results[index];
    if (result.status === "fulfilled" && Array.isArray(result.value)) {
      dashboardData[key] = result.value;
    } else {
      dashboardData[key] = [];
      dashboardData.errors[key] =
        result.status === "rejected"
          ? result.reason.message
          : "The service returned an unexpected response.";
    }
  });

  const user = SmsAuth.getUser();
  if (user?.role === "admin" || user?.role === "school_admin") {
    try {
      const result = await SmsAuth.apiFetch("/audit-logs?page=1&limit=5");
      if (!Array.isArray(result.data)) {
        throw new Error("The audit service returned an unexpected response.");
      }
      dashboardData.auditLogs = result.data;
    } catch (error) {
      dashboardData.auditLogs = [];
      dashboardData.errors.auditLogs = error.message;
    }
  }

  const failedSources = Object.keys(dashboardData.errors);
  const warning = $("#dashboardLoadWarning");
  if (failedSources.length) {
    warning.textContent = `Some school data could not be loaded (${failedSources.join(", ")}). Affected metrics are marked unavailable.`;
    warning.hidden = false;
  } else {
    warning.hidden = true;
  }
}

function showToast(message) {
  const toast = $("#dashboardToast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(
    () => toast.classList.remove("is-visible"),
    2600,
  );
}

function navigate(button) {
  const href = button.dataset.href;
  if (href) window.location.href = href;
  else if (button.dataset.toast) showToast(button.dataset.toast);
}

function setUserProfile() {
  const user = typeof SmsAuth !== "undefined" ? SmsAuth.getUser() : null;
  const name = user?.name || "Admin";
  const firstName = name.split(/\s+/)[0];
  const element = $("#greetingName");
  if (element) {
    element.textContent = firstName;
  }
  const hour = new Date().getHours();
  $("#greetingPrefix").textContent =
    hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

function notificationStorageKey() {
  const user = SmsAuth.getUser() || {};
  return `sms:read-dashboard-alerts:${user.id || "unknown"}:${user.schoolId || "none"}`;
}

function readDashboardNotifications() {
  try {
    const stored = localStorage.getItem(notificationStorageKey());
    if (!stored) return new Set();
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed) || parsed.some((key) => typeof key !== "string")) {
      throw new TypeError("Stored notification state is invalid.");
    }
    return new Set(parsed);
  } catch (error) {
    console.error("[dashboard] notification state could not be read:", error);
    return new Set();
  }
}

function saveDashboardNotifications(readKeys) {
  try {
    localStorage.setItem(
      notificationStorageKey(),
      JSON.stringify([...readKeys].slice(-100)),
    );
    return true;
  } catch (error) {
    console.error("[dashboard] notification state could not be saved:", error);
    return false;
  }
}

function updateUnreadNotificationCount() {
  const unread = $$("#notificationList [data-notification]:not(.is-read)").length;
  $("#notificationCount").textContent = String(unread);
}

function markDashboardNotificationRead(notification) {
  const key = notification.dataset.notificationKey;
  if (key) {
    const readKeys = readDashboardNotifications();
    readKeys.add(key);
    if (!saveDashboardNotifications(readKeys)) {
      showToast("Read status could not be saved on this device.");
    }
  }
  notification.classList.add("is-read");
  updateUnreadNotificationCount();
}

function setupActions() {
  document.addEventListener("click", (event) => {
    const action = event.target.closest("[data-href], [data-toast], [data-action]");
    const notification = event.target.closest("[data-notification]");
    if (notification) markDashboardNotificationRead(notification);
    if (!action) return;
    if (action.dataset.action === "export-report") {
      exportDashboardReport();
      return;
    }
    navigate(action);
  });
  $("#markRead").addEventListener("click", () => {
    const notifications = $$("#notificationList [data-notification]");
    const readKeys = readDashboardNotifications();
    notifications.forEach((item) => {
      if (item.dataset.notificationKey) {
        readKeys.add(item.dataset.notificationKey);
      }
      item.classList.add("is-read");
    });
    const saved = saveDashboardNotifications(readKeys);
    updateUnreadNotificationCount();
    showToast(
      saved
        ? "All notifications marked as read"
        : "Read status could not be saved on this device.",
    );
  });
}

function setupMenus() {
  const profileMenu = $("#profileMenu");
  const topProfile = $("#topProfile");
  const topLogout = $("#topLogout");
  if (topProfile) {
    topProfile.addEventListener("click", (event) => {
      event.stopPropagation();
      if (profileMenu) {
        profileMenu.classList.toggle("is-open");
      }
      const panel = $("#notificationPanel");
      if (panel) panel.classList.remove("is-open");
    });
  }
  if (topLogout && typeof SmsAuth !== "undefined") {
    topLogout.addEventListener("click", () => SmsAuth.logout());
  }
  if (profileMenu) {
    document.addEventListener("click", (event) => {
      if (
        !profileMenu.contains(event.target) &&
        event.target.id !== "topProfile" &&
        event.target.id !== "sharedSidebarProfileButton"
      ) {
        profileMenu.classList.remove("is-open");
      }
    });
  }
  const notificationButton = $("#notificationButton");
  if (notificationButton) {
    notificationButton.addEventListener("click", (event) => {
      event.stopPropagation();
      const panel = $("#notificationPanel");
      if (panel) panel.classList.toggle("is-open");
      if (profileMenu) profileMenu.classList.remove("is-open");
    });
  }
}

function setupSearch() {
  const layer = $("#searchLayer");
  const input = $("#globalSearch");
  const results = $("#searchResults");
  const close = () => {
    layer.classList.remove("is-open");
    layer.setAttribute("aria-hidden", "true");
  };
  $("#searchButton").addEventListener("click", () => {
    layer.classList.add("is-open");
    layer.setAttribute("aria-hidden", "false");
    input.focus();
  });
  $("#searchClose").addEventListener("click", close);
  layer.addEventListener("click", (event) => {
    if (event.target === layer) close();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });
  input.addEventListener("input", () => {
    const term = input.value.trim().toLowerCase();
    if (!term) {
      results.innerHTML = "<p>Try “Brian”, “attendance”, or “fees”.</p>";
      return;
    }
    const searchIndex = [
      ...dashboardData.students.map((record) => ({ label: record.name, type: "Student", href: "../students/index.html" })),
      ...dashboardData.teachers.map((record) => ({ label: record.name, type: "Teacher", href: "../teachers/index.html" })),
      ...dashboardData.classes.map((record) => ({ label: record.name, type: "Class", href: "../classes-subjects/index.html" })),
      ...dashboardData.subjects.map((record) => ({ label: record.name, type: "Subject", href: "../classes-subjects/index.html" })),
      ...dashboardData.fees.map((record) => ({ label: record.studentName || `Fee ${money(record.amount)}`, type: "Fee record", href: "../fees/index.html" })),
      ...dashboardData.exams.map((record) => ({ label: `${record.studentName || "Result"} ${record.subject || ""}`, type: "Result", href: "../exams/index.html" })),
      ...dashboardData.announcements.map((record) => ({ label: record.title, type: "Announcement", href: "../announcements/index.html" })),
    ];
    const matches = searchIndex.filter((item) =>
      `${item.label} ${item.type}`.toLowerCase().includes(term),
    );
    results.innerHTML = matches.length
      ? matches
          .map(
            (item) =>
              `<button type="button" data-search-href="${item.href}"><strong>${escapeHtml(item.label)}</strong><small> · ${escapeHtml(item.type)}</small></button>`,
          )
          .join("")
      : "<p>No matching records found.</p>";
    results.querySelectorAll("[data-search-href]").forEach((button) =>
      button.addEventListener("click", () => {
        window.location.href = button.dataset.searchHref;
      }),
    );
  });
}

function renderDashboardAudit(error) {
  const panel = $(".audit-panel");
  const user = SmsAuth.getUser();
  const canReadAudit = ["admin", "school_admin"].includes(user?.role);
  if (!panel) return;
  panel.hidden = !canReadAudit;
  if (!canReadAudit) return;

  const list = $("#dashboardAuditList");
  list.replaceChildren();
  if (error) {
    const item = document.createElement("li");
    const message = document.createElement("p");
    message.className = "dashboard-empty";
    message.textContent = "Audit history is unavailable right now.";
    item.append(message);
    list.append(item);
    return;
  }

  const auditLogs = dashboardData.auditLogs || [];
  if (!auditLogs.length) {
    const item = document.createElement("li");
    const message = document.createElement("p");
    message.className = "dashboard-empty";
    message.textContent = "No audit activity has been recorded yet.";
    item.append(message);
    list.append(item);
    return;
  }

  for (const record of auditLogs) {
    const item = document.createElement("li");
    const icon = document.createElement("span");
    icon.textContent = "≋";
    const content = document.createElement("p");
    const title = document.createElement("strong");
    title.textContent = String(record.action || "Administrative activity")
      .replace(/_/g, " ")
      .toLocaleLowerCase();
    const detail = document.createElement("small");
    const date = record.timestamp ? new Date(record.timestamp) : null;
    const dateLabel =
      date && !Number.isNaN(date.getTime())
        ? date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
        : "Time not recorded";
    detail.textContent = `${record.entityType || "Record"} · ${dateLabel}`;
    content.append(title, detail);
    item.append(icon, content);
    list.append(item);
  }
}

function renderDashboardData() {
  const errors = dashboardData.errors || {};
  const students = dashboardData.students;
  const teachers = dashboardData.teachers;
  const attendance = dashboardData.attendance;
  const fees = dashboardData.fees;
  const exams = dashboardData.exams;
  const today = localDateString();
  const todayAttendance = attendance.filter((record) => record.date === today);
  const presentCount = todayAttendance.filter((record) => record.status === "present").length;
  const lateCount = todayAttendance.filter((record) => record.status === "late").length;
  const attendanceRate = todayAttendance.length
    ? Math.round(((presentCount + lateCount) / todayAttendance.length) * 100)
    : null;
  const totalFees = fees.reduce((total, record) => total + Number(record.amount || 0), 0);
  const collectedFees = fees
    .filter((record) => record.status === "paid")
    .reduce((total, record) => total + Number(record.amount || 0), 0);
  const outstandingFees = Math.max(0, totalFees - collectedFees);
  const feeRate = totalFees ? Math.round((collectedFees / totalFees) * 100) : 0;
  const classCount = dashboardData.classes.length || new Set(students.map((student) => student.class).filter(Boolean)).size;

  $("#metricStudents").textContent = students.length.toLocaleString();
  $("#metricClasses").textContent = `Across ${classCount} active classes`;
  $("#metricAttendance").textContent = attendanceRate === null ? "—" : `${attendanceRate}%`;
  $("#metricAttendanceNote").textContent = todayAttendance.length
    ? `${todayAttendance.length} of ${students.length} students marked`
    : "No register submitted today";
  $("#metricFees").textContent = `${feeRate}%`;
  $("#metricFeesNote").textContent = `${money(collectedFees)} collected of ${money(totalFees)}`;
  $("#metricTeachers").textContent = teachers.length.toLocaleString();

  const attendanceSummary = $("#attendanceSummary");
  attendanceSummary.textContent = attendanceRate === null ? "—" : `${attendanceRate}%`;
  $("#attendanceSummaryNote").textContent = todayAttendance.length
    ? `${presentCount} present · ${lateCount} late · ${todayAttendance.filter((record) => record.status === "absent").length} absent`
    : "No attendance records for today";

  const studentsById = new Map(students.map((student) => [student.id, student]));
  const classGroups = new Map();
  students.forEach((student) => {
    const className = student.class || "Unassigned";
    if (!classGroups.has(className)) classGroups.set(className, []);
    classGroups.get(className).push(student);
  });
  $("#classBreakdown").innerHTML = [...classGroups.entries()].slice(0, 6).map(([className, records]) => {
    const recordIds = new Set(records.map((student) => student.id));
    const marked = todayAttendance.filter((record) => recordIds.has(record.studentId));
    const count = marked.filter((record) => record.status === "present" || record.status === "late").length;
    const rate = marked.length ? Math.round((count / marked.length) * 100) : 0;
    return `<div><span>${escapeHtml(className)}</span><b>${marked.length ? `${rate}%` : "—"}</b><small>${marked.length} marked of ${records.length} students</small><i><em style="width:${rate}%"></em></i></div>`;
  }).join("") || `<p class="dashboard-empty">No classes or student groups yet.</p>`;

  const subjectScores = new Map();
  exams.forEach((record) => {
    const subject = record.subject || "Other";
    const percentage = Number(record.maxScore)
      ? (Number(record.score) / Number(record.maxScore)) * 100
      : 0;
    const group = subjectScores.get(subject) || { total: 0, count: 0 };
    group.total += percentage;
    group.count += 1;
    subjectScores.set(subject, group);
  });
  dashboardData.subjectAverages = [...subjectScores.entries()].map(([subject, group]) => ({
    subject,
    average: Math.round(group.total / group.count),
  }));
  const overallAverage = exams.length
    ? Math.round(exams.reduce((total, record) => total + (Number(record.maxScore) ? Number(record.score) / Number(record.maxScore) * 100 : 0), 0) / exams.length)
    : null;
  $("#performanceSummary").textContent = overallAverage === null ? "—" : `${overallAverage}%`;
  $("#performanceList").innerHTML = dashboardData.subjectAverages.slice(0, 5).map(({ subject, average }) =>
    `<div><span>${escapeHtml(subject)}</span><b>${average}%</b><i><em style="width:${Math.min(100, average)}%"></em></i></div>`,
  ).join("") || `<p class="dashboard-empty">No exam results recorded yet.</p>`;

  $("#financeStats").innerHTML = [
    ["Total expected", money(totalFees)],
    ["Collected", money(collectedFees)],
    ["Outstanding", money(outstandingFees)],
    ["Collection rate", `${feeRate}%`],
  ].map(([label, value]) => `<div><small>${label}</small><strong>${value}</strong></div>`).join("");

  const recentPayments = fees
    .filter((record) => record.status === "paid")
    .sort((left, right) => String(right.updatedAt || right.createdAt || "").localeCompare(String(left.updatedAt || left.createdAt || "")))
    .slice(0, 3);
  $("#paymentList").innerHTML = `<h3>Recent payments</h3>${recentPayments.map((record) => {
    const student = studentsById.get(record.studentId);
    const initials = (record.studentName || student?.name || "?").split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase();
    const paidDate = record.updatedAt || record.createdAt;
    const dateText = paidDate ? new Date(paidDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "Date not recorded";
    return `<div><span class="payment-avatar">${escapeHtml(initials)}</span><p><strong>${escapeHtml(record.studentName || student?.name || "Student")}</strong><small>${escapeHtml(record.class || student?.class || "")}${record.class || student?.class ? " · " : ""}${dateText}</small></p><b>${money(record.amount)}</b></div>`;
  }).join("") || `<p class="dashboard-empty">No paid fee records yet.</p>`}`;

  const attentionItems = [];
  const unpaidCount = fees.filter((record) => record.status !== "paid").length;
  if (unpaidCount) attentionItems.push({ type: "warning", icon: "!", title: `${unpaidCount} fee records need follow-up`, detail: `Outstanding balance ${money(outstandingFees)}`, href: "../fees/index.html" });
  const unmarkedCount = Math.max(0, students.length - new Set(todayAttendance.map((record) => record.studentId)).size);
  if (students.length && unmarkedCount) attentionItems.push({ type: "warning", icon: "!", title: `${unmarkedCount} students have no attendance entry today`, detail: "Attendance · Today's register", href: "../attendance/index.html" });
  const lowScores = exams.filter((record) => Number(record.maxScore) && Number(record.score) / Number(record.maxScore) < 0.4).length;
  if (lowScores) attentionItems.push({ type: "info", icon: "i", title: `${lowScores} results are below 40%`, detail: "Academic performance · Exams", href: "../exams/index.html" });
  $("#metricAlerts").textContent = attentionItems.length.toLocaleString();
  $("#attentionCount").textContent = `${attentionItems.length} open`;
  $("#attentionList").innerHTML = attentionItems.length
    ? attentionItems.map((item) => `<button class="attention-item attention-item--${item.type}" data-href="${item.href}"><span class="attention-symbol">${item.icon}</span><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.detail)}</small></span><b>→</b></button>`).join("")
    : `<p class="dashboard-empty">No follow-up items right now.</p>`;
  const readNotifications = readDashboardNotifications();
  $("#notificationList").innerHTML = attentionItems.map((item) => {
    const key = encodeURIComponent(
      JSON.stringify([today, item.type, item.title, item.detail, item.href]),
    );
    const isRead = readNotifications.has(key);
    return `<button class="notification-item${isRead ? " is-read" : ""}" data-notification data-notification-key="${key}" data-href="${item.href}"><span class="attention-symbol">${item.icon}</span><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.detail)}</small></span></button>`;
  }).join("") || `<p class="dashboard-empty">You're all caught up.</p>`;
  updateUnreadNotificationCount();

  const upcomingEvents = dashboardData.events
    .filter((record) => record.date && String(record.date).slice(0, 10) >= today)
    .sort((left, right) => String(left.date).localeCompare(String(right.date)))
    .slice(0, 4);
  $(".event-list").innerHTML = upcomingEvents.map((record) => {
    const date = new Date(`${String(record.date).slice(0, 10)}T12:00:00`);
    return `<div class="dashboard-event"><time><b>${date.toLocaleDateString("en-GB", { day: "2-digit" })}</b><small>${date.toLocaleDateString("en-GB", { month: "short" }).toUpperCase()}</small></time><span><strong>${escapeHtml(record.name || record.title || "School event")}</strong><small>${date.toLocaleDateString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" })}</small></span></div>`;
  }).join("") || `<p class="dashboard-empty">No upcoming events scheduled.</p>`;

  const activityItems = [
    ...students.map((record) => ({ date: record.createdAt, title: "Student enrolled", detail: record.name, icon: "+", color: "blue", href: "../students/index.html" })),
    ...fees.filter((record) => record.status === "paid").map((record) => ({ date: record.updatedAt || record.createdAt, title: "Fee payment recorded", detail: `${record.studentName || studentsById.get(record.studentId)?.name || "Student"} · ${money(record.amount)}`, icon: "₵", color: "green", href: "../fees/index.html" })),
    ...attendance.map((record) => ({ date: record.createdAt || record.date, title: "Attendance submitted", detail: `${record.className || "Class"} · ${record.status}`, icon: "✓", color: "yellow", href: "../attendance/index.html" })),
    ...dashboardData.announcements.map((record) => ({ date: record.createdAt || record.date, title: "Announcement published", detail: record.title, icon: "◌", color: "blue", href: "../announcements/index.html" })),
  ].filter((item) => item.date).sort((left, right) => String(right.date).localeCompare(String(left.date))).slice(0, 5);
  $("#activityFeed").innerHTML = activityItems.map((item) => {
    const date = new Date(item.date);
    const time = Number.isNaN(date.getTime()) ? "—" : date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    return `<div><time>${time}</time><span class="feed-icon feed-icon--${item.color}">${item.icon}</span><p><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.detail || "")}</small></p><a href="${item.href}" aria-label="Open ${escapeHtml(item.title)}">→</a></div>`;
  }).join("") || `<p class="dashboard-empty">School activity will appear here as records are added.</p>`;

  renderDashboardAudit(errors.auditLogs);
  if (errors.students) {
    $("#metricStudents").textContent = "—";
    $("#metricClasses").textContent = "Student totals unavailable";
  }
  if (errors.classes) $("#metricClasses").textContent = "Class totals unavailable";
  if (errors.attendance) {
    $("#metricAttendance").textContent = "—";
    $("#metricAttendanceNote").textContent = "Attendance data unavailable";
    $("#attendanceSummary").textContent = "—";
    $("#attendanceSummaryNote").textContent = "Attendance data unavailable";
    $("#classBreakdown").innerHTML =
      '<p class="dashboard-empty">Attendance details unavailable.</p>';
  }
  if (errors.teachers) $("#metricTeachers").textContent = "—";
  if (errors.fees) {
    $("#metricFees").textContent = "—";
    $("#metricFeesNote").textContent = "Fee data unavailable";
    $("#financeStats").innerHTML =
      '<p class="dashboard-empty">Finance totals unavailable.</p>';
    $("#paymentList").innerHTML =
      '<p class="dashboard-empty">Recent payments unavailable.</p>';
  }
  if (errors.exams) {
    $("#performanceSummary").textContent = "—";
    $("#performanceList").innerHTML =
      '<p class="dashboard-empty">Academic performance data unavailable.</p>';
  }
  if (errors.events) {
    $(".event-list").innerHTML =
      '<p class="dashboard-empty">Upcoming events are unavailable.</p>';
  }
  if (errors.attendance || errors.fees || errors.exams || errors.students) {
    $("#metricAlerts").textContent = "—";
    $("#attentionCount").textContent = "Partial";
    $("#attentionList").innerHTML =
      '<p class="dashboard-empty">Some alert sources are unavailable; displayed items may be incomplete.</p>' +
      $("#attentionList").innerHTML;
    $("#notificationCount").textContent = "—";
  }

  const attendanceByDate = new Map();
  attendance.forEach((record) => {
    if (!attendanceByDate.has(record.date)) attendanceByDate.set(record.date, []);
    attendanceByDate.get(record.date).push(record);
  });
  dashboardData.attendanceSeries = [...attendanceByDate.entries()].sort(([left], [right]) => left.localeCompare(right)).slice(-6).map(([date, records]) => ({
    label: new Date(`${date}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short" }),
    rate: Math.round((records.filter((record) => record.status === "present" || record.status === "late").length / records.length) * 100),
  }));
  const paidByMonth = new Map();
  fees.filter((record) => record.status === "paid").forEach((record) => {
    const date = record.updatedAt || record.createdAt;
    if (!date) return;
    const month = String(date).slice(0, 7);
    paidByMonth.set(month, (paidByMonth.get(month) || 0) + Number(record.amount || 0));
  });
  dashboardData.financeSeries = [...paidByMonth.entries()].sort(([left], [right]) => left.localeCompare(right)).slice(-5);
  renderCharts();
}

function exportDashboardReport() {
  const rows = [
    ["Section", "Metric", "Value"],
    ["People", "Students", dashboardData.students.length],
    ["People", "Teachers", dashboardData.teachers.length],
    ["Academics", "Classes", dashboardData.classes.length],
    ["Academics", "Exam records", dashboardData.exams.length],
    ["Operations", "Attendance records", dashboardData.attendance.length],
    ["Finance", "Expected fees", dashboardData.fees.reduce((sum, record) => sum + Number(record.amount || 0), 0)],
    ["Finance", "Paid fees", dashboardData.fees.filter((record) => record.status === "paid").reduce((sum, record) => sum + Number(record.amount || 0), 0)],
  ];
  const csv = rows.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `school-overview-${localDateString()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  showToast("School overview report downloaded");
}

const setupState = { step: 1 };
const setupColors = ["#237c78", "#3b6f9c", "#a64f45", "#587a3c"];

function applySchoolProfile(school) {
  if (!school) return;
  $("#schoolNameLabel").textContent = school.name || "School";
  document.title = `${school.name || "School"} | Dashboard`;
  const accent = school.settings?.accentColor;
  if (accent) document.documentElement.style.setProperty("--accent", accent);
}

async function setupSchoolProfile() {
  const user = SmsAuth.getUser();
  if (!["admin", "school_admin"].includes(user?.role)) return;

  try {
    const response = await SmsAuth.apiFetch("/schools/me");
    const school = response.school;
    applySchoolProfile(school);
    if (school.onboardingCompleted) return;
    setupState.name = school.name || "";
    setupState.schoolType = school.settings?.schoolType || "Primary";
    setupState.phone = school.settings?.phone || "";
    setupState.email = school.settings?.email || "";
    setupState.address = school.settings?.address || "";
    setupState.academicYear = school.settings?.academicYear || "";
    setupState.accentColor = school.settings?.accentColor || setupColors[0];
    renderSchoolSetup();
  } catch (error) {
    showToast(`Couldn't load school setup: ${error.message}`);
  }
}

function renderSchoolSetup(errorMessage = "") {
  let overlay = $("#schoolSetupOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "schoolSetupOverlay";
    overlay.className = "setup-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    document.body.appendChild(overlay);
  }

  const stepContent = setupState.step === 1
    ? `<label>School name<input name="name" required maxlength="100" value="${escapeHtml(setupState.name)}" autocomplete="organization"></label><label>School type<select name="schoolType"><option ${setupState.schoolType === "Primary" ? "selected" : ""}>Primary</option><option ${setupState.schoolType === "Secondary" ? "selected" : ""}>Secondary</option><option ${setupState.schoolType === "Combined" ? "selected" : ""}>Combined</option><option ${setupState.schoolType === "Other" ? "selected" : ""}>Other</option></select></label>`
    : setupState.step === 2
      ? `<label>School address<input name="address" maxlength="180" value="${escapeHtml(setupState.address)}" autocomplete="street-address"></label><div class="setup-row"><label>Contact phone<input name="phone" type="tel" maxlength="40" value="${escapeHtml(setupState.phone)}" autocomplete="tel"></label><label>Contact email<input name="email" type="email" maxlength="120" value="${escapeHtml(setupState.email)}" autocomplete="email"></label></div><label>Academic year<input name="academicYear" maxlength="40" placeholder="e.g. 2026–2027" value="${escapeHtml(setupState.academicYear)}"></label>`
      : `<fieldset class="setup-swatches"><legend>Choose your school accent</legend>${setupColors.map((color) => `<label title="${color}"><input type="radio" name="accentColor" value="${color}" ${setupState.accentColor === color ? "checked" : ""}><span style="--swatch:${color}"></span></label>`).join("")}</fieldset><p class="setup-preview"><span style="background:${setupState.accentColor}"></span>${escapeHtml(setupState.name || "Your school")} portal</p>`;

  const headings = ["Name your school", "Add school details", "Choose your look"];
  overlay.innerHTML = `<section class="setup-dialog"><div class="setup-step">Step ${setupState.step} of 3</div><h2>${headings[setupState.step - 1]}</h2><div class="setup-progress" aria-label="Step ${setupState.step} of 3"><i style="width:${setupState.step * 33.333}%"></i></div><form id="schoolSetupForm">${stepContent}<p class="setup-error" role="alert">${escapeHtml(errorMessage)}</p><div class="setup-actions">${setupState.step > 1 ? '<button type="button" class="setup-back">Back</button>' : ""}<button type="submit">${setupState.step === 3 ? "Finish setup" : "Continue"}</button></div></form></section>`;

  const form = $("#schoolSetupForm");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const fields = new FormData(form);
    if (setupState.step === 1) {
      setupState.name = String(fields.get("name") || "").trim();
      setupState.schoolType = String(fields.get("schoolType") || "Primary");
      if (!setupState.name) return;
      setupState.step = 2;
      renderSchoolSetup();
      return;
    }
    if (setupState.step === 2) {
      setupState.address = String(fields.get("address") || "").trim();
      setupState.phone = String(fields.get("phone") || "").trim();
      setupState.email = String(fields.get("email") || "").trim();
      setupState.academicYear = String(fields.get("academicYear") || "").trim();
      setupState.step = 3;
      renderSchoolSetup();
      return;
    }

    setupState.accentColor = String(fields.get("accentColor") || setupColors[0]);
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.textContent = "Saving…";
    try {
      const result = await SmsAuth.apiFetch("/schools/me", {
        method: "PATCH",
        body: {
          name: setupState.name,
          schoolType: setupState.schoolType,
          address: setupState.address,
          phone: setupState.phone,
          email: setupState.email,
          academicYear: setupState.academicYear,
          accentColor: setupState.accentColor,
          onboardingCompleted: true,
        },
      });
      applySchoolProfile(result.school);
      overlay.remove();
      showToast("School setup saved");
    } catch (error) {
      renderSchoolSetup(error.message);
    }
  });
  overlay.querySelector(".setup-back")?.addEventListener("click", () => {
    setupState.step -= 1;
    renderSchoolSetup();
  });
}

function chartDefaults() {
  Chart.defaults.font.family = "DM Sans, sans-serif";
  Chart.defaults.font.size = 10;
  Chart.defaults.color = "#71808f";
  Chart.defaults.animation.duration = 500;
}

function renderCharts() {
  chartDefaults();
  const grid = "rgba(113,128,143,.12)";
  const attendanceSeries = dashboardData.attendanceSeries || [];
  const subjectAverages = (dashboardData.subjectAverages || []).slice(0, 4);
  const financeSeries = dashboardData.financeSeries || [];
  const attendanceChart = new Chart($("#attendanceTrendChart"), {
    type: "line",
    data: {
      labels: attendanceSeries.length ? attendanceSeries.map((item) => item.label) : ["No records"],
      datasets: [
        {
          data: attendanceSeries.length ? attendanceSeries.map((item) => item.rate) : [0],
          borderColor: "#237c78",
          backgroundColor: "rgba(35,124,120,.10)",
          fill: true,
          tension: 0.38,
          pointRadius: 2.5,
          pointBackgroundColor: "#237c78",
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          displayColors: false,
          callbacks: { label: (context) => `${context.parsed.y}% attendance` },
        },
      },
      scales: {
        x: { grid: { display: false }, border: { display: false } },
        y: {
          min: 0,
          max: 100,
          ticks: { callback: (value) => `${value}%`, maxTicksLimit: 4 },
          grid: { color: grid },
          border: { display: false },
        },
      },
    },
  });
  const performanceChart = new Chart($("#performanceChart"), {
    type: "bar",
    data: {
      labels: subjectAverages.length ? subjectAverages.map((item) => item.subject) : ["No results"],
      datasets: [
        {
          data: subjectAverages.length ? subjectAverages.map((item) => item.average) : [0],
          backgroundColor: ["#237c78", "#5d9b98", "#8eb5b2", "#bfd5d2"],
          borderRadius: 3,
          barThickness: 14,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          displayColors: false,
          callbacks: { label: (context) => `${context.parsed.y}% average` },
        },
      },
      scales: {
        x: { grid: { display: false }, border: { display: false } },
        y: {
          min: 0,
          max: 100,
          ticks: { callback: (value) => `${value}%`, maxTicksLimit: 3 },
          grid: { color: grid },
          border: { display: false },
        },
      },
    },
  });
  const financeChart = new Chart($("#financeChart"), {
    type: "line",
    data: {
      labels: financeSeries.length ? financeSeries.map(([month]) => new Date(`${month}-15T12:00:00`).toLocaleDateString("en-GB", { month: "short" })) : ["No payments"],
      datasets: [
        {
          data: financeSeries.length ? financeSeries.map(([, amount]) => amount) : [0],
          borderColor: "#c98227",
          backgroundColor: "rgba(201,130,39,.10)",
          fill: true,
          tension: 0.35,
          pointRadius: 2,
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          displayColors: false,
          callbacks: { label: (context) => `${money(context.parsed.y)} collected` },
        },
      },
      scales: {
        x: { grid: { display: false }, border: { display: false } },
        y: {
          min: 0,
          ticks: { callback: (value) => money(value), maxTicksLimit: 3 },
          grid: { color: grid },
          border: { display: false },
        },
      },
    },
  });

  const charts = [attendanceChart, performanceChart, financeChart];
  let resizeTimeout = 0;
  window.addEventListener(
    "resize",
    () => {
      window.clearTimeout(resizeTimeout);
      resizeTimeout = window.setTimeout(() => {
        charts.forEach((chart) => chart.resize());
        resizeTimeout = 0;
      }, 250);
    },
    { passive: true },
  );
}

async function init() {
  if (SmsAuth.getUser()?.role === "super_admin") {
    window.location.replace(SmsAuth.homeUrlForRole("super_admin"));
    return;
  }
  setUserProfile();
  setupActions();
  setupMenus();
  setupSearch();
  $("#dashboardDate").textContent = new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  await loadDashboardData();
  renderDashboardData();
  await setupSchoolProfile();
}

document.addEventListener("DOMContentLoaded", init);
