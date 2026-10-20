const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const dashboardData = { errors: {} };
let dashboardLayout = null;
let analyticsPreset = "30";
let analyticsRange = null;
let dashboardCharts = [];
let dashboardResizeTimeout = 0;
let dashboardResizeHandlerBound = false;
let dashboardInitStarted = false;
let searchTimer = 0;
let searchSequence = 0;

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

function dashboardLayoutStorageKey() {
  const user = SmsAuth.getUser() || {};
  return `sms:dashboard-layout:v1:${user.id || "unknown"}:${user.schoolId || "none"}`;
}

function persistDashboardLayout() {
  try {
    dashboardLayout = DashboardState.saveLayout(
      localStorage,
      dashboardLayoutStorageKey(),
      dashboardLayout,
    );
    applyDashboardLayout();
    renderWidgetPreferences();
    return true;
  } catch (error) {
    console.error("[dashboard] layout could not be saved:", error);
    showToast("Dashboard layout could not be saved on this device.");
    return false;
  }
}

function applyDashboardLayout() {
  if (!dashboardLayout) return;
  const containers = {
    workspace: $(".workspace"),
    priority: $('[data-widget-container="priority"]'),
    analytics: $('[data-widget-container="analytics"]'),
    lower: $('[data-widget-container="lower"]'),
  };
  for (const [group, container] of Object.entries(containers)) {
    if (!container) continue;
    const widgets = new Map(
      [...container.querySelectorAll(":scope > [data-dashboard-widget]")].map(
        (widget) => [widget.dataset.dashboardWidget, widget],
      ),
    );
    for (const id of dashboardLayout.order[group] || []) {
      const widget = widgets.get(id);
      if (widget) container.append(widget);
    }
  }
  for (const widget of $$("[data-dashboard-widget]")) {
    widget.hidden = dashboardLayout.hidden.includes(widget.dataset.dashboardWidget);
  }
  requestAnimationFrame(() =>
    dashboardCharts.forEach((chart) => chart.resize()),
  );
}

function moveWidget(id, direction) {
  const definition = DashboardState.WIDGETS.find((widget) => widget.id === id);
  const order = dashboardLayout?.order[definition?.group];
  if (!definition || !order) return;
  const index = order.indexOf(id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= order.length) return;
  [order[index], order[target]] = [order[target], order[index]];
  persistDashboardLayout();
}

function renderWidgetPreferences() {
  const list = $("#dashboardWidgetList");
  if (!list || !dashboardLayout) return;
  list.replaceChildren();
  for (const definition of DashboardState.WIDGETS) {
    const row = document.createElement("div");
    row.className = "dashboard-widget-row";
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = !dashboardLayout.hidden.includes(definition.id);
    checkbox.setAttribute("aria-label", `Show ${definition.label}`);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        dashboardLayout.hidden = dashboardLayout.hidden.filter(
          (id) => id !== definition.id,
        );
      } else {
        dashboardLayout.hidden.push(definition.id);
      }
      persistDashboardLayout();
    });
    const name = document.createElement("span");
    name.textContent = definition.label;
    label.append(checkbox, name);

    const controls = document.createElement("div");
    controls.className = "dashboard-widget-row-controls";
    const order = dashboardLayout.order[definition.group];
    const index = order.indexOf(definition.id);
    for (const [direction, text] of [[-1, "Move up"], [1, "Move down"]]) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = direction < 0 ? "↑" : "↓";
      button.disabled =
        direction < 0 ? index === 0 : index === order.length - 1;
      button.setAttribute(
        "aria-label",
        `${text} ${definition.label}`,
      );
      button.addEventListener("click", () => moveWidget(definition.id, direction));
      controls.append(button);
    }
    row.append(label, controls);
    list.append(row);
  }
}

function setupWidgetCustomization() {
  const dialog = $("#dashboardWidgetDialog");
  const customize = $("#customizeDashboard");
  const close = () => dialog.close();
  try {
    const saved = DashboardState.loadLayout(
      localStorage,
      dashboardLayoutStorageKey(),
    );
    dashboardLayout = saved.layout;
    if (saved.error) {
      console.warn("[dashboard] saved layout was ignored:", saved.error.message);
      showToast("Saved dashboard layout was invalid; defaults were loaded.");
    }
  } catch (error) {
    console.error("[dashboard] layout preferences are unavailable:", error);
    dashboardLayout = DashboardState.defaultLayout();
    showToast("Dashboard customization is unavailable in this browser.");
  }
  applyDashboardLayout();
  renderWidgetPreferences();

  for (const widget of $$("[data-dashboard-widget]")) {
    const heading = widget.querySelector(".section-heading");
    if (!heading) continue;
    const handle = document.createElement("button");
    handle.className = "dashboard-widget-handle";
    handle.type = "button";
    handle.textContent = "↕ Arrange";
    handle.draggable = true;
    handle.setAttribute("aria-label", `Drag to arrange ${widget.getAttribute("aria-labelledby") ? document.getElementById(widget.getAttribute("aria-labelledby"))?.textContent : "dashboard widget"}`);
    handle.addEventListener("dragstart", (event) => {
      widget.classList.add("is-dragging");
      event.dataTransfer?.setData("text/plain", widget.dataset.dashboardWidget);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    });
    handle.addEventListener("dragend", () => {
      widget.classList.remove("is-dragging");
      $$("[data-dashboard-widget]").forEach((item) =>
        item.classList.remove("is-drop-target"),
      );
    });
    heading.append(handle);
  }

  document.addEventListener("dragover", (event) => {
    const dragged = $("[data-dashboard-widget].is-dragging");
    const target = event.target.closest("[data-dashboard-widget]");
    if (
      !dragged ||
      !target ||
      dragged === target ||
      dragged.parentElement !== target.parentElement
    ) {
      return;
    }
    event.preventDefault();
    target.classList.add("is-drop-target");
  });
  document.addEventListener("dragleave", (event) => {
    event.target.closest("[data-dashboard-widget]")?.classList.remove("is-drop-target");
  });
  document.addEventListener("drop", (event) => {
    const draggedId = event.dataTransfer?.getData("text/plain");
    const dragged = draggedId
      ? $(`[data-dashboard-widget="${CSS.escape(draggedId)}"]`)
      : null;
    const target = event.target.closest("[data-dashboard-widget]");
    if (
      !dragged ||
      !target ||
      dragged === target ||
      dragged.parentElement !== target.parentElement
    ) {
      return;
    }
    event.preventDefault();
    const bounds = target.getBoundingClientRect();
    const before =
      event.clientY < bounds.top + bounds.height / 2 ||
      event.clientX < bounds.left + bounds.width / 2;
    target.parentElement.insertBefore(dragged, before ? target : target.nextSibling);
    const group = dragged.dataset.widgetGroup;
    dashboardLayout.order[group] = [
      ...target.parentElement.querySelectorAll(":scope > [data-dashboard-widget]"),
    ].map((widget) => widget.dataset.dashboardWidget);
    persistDashboardLayout();
  });

  customize.addEventListener("click", () => {
    renderWidgetPreferences();
    dialog.showModal();
    $("#closeWidgetDialog").focus();
  });
  $("#closeWidgetDialog").addEventListener("click", close);
  $("#doneWidgetLayout").addEventListener("click", close);
  $("#resetWidgetLayout").addEventListener("click", async () => {
    const confirmed = await SmsUI.confirm(
      "Restore the default dashboard layout and show every widget?",
      { title: "Reset dashboard layout", confirmLabel: "Reset layout" },
    );
    if (!confirmed) return;
    dashboardLayout = DashboardState.defaultLayout();
    if (persistDashboardLayout()) {
      showToast("Dashboard layout reset to default.");
    }
  });
}

function setupAnalyticsFilters() {
  const select = $("#analyticsRange");
  const customDates = $("#customAnalyticsDates");
  const today = localDateString();
  const initialRange = DashboardState.getAnalyticsRange(
    select.value,
    "",
    "",
    new Date(),
  );
  $("#analyticsStart").value = initialRange.from;
  $("#analyticsEnd").value = initialRange.to;
  analyticsPreset = select.value;
  analyticsRange = initialRange;

  select.addEventListener("change", () => {
    analyticsPreset = select.value;
    customDates.hidden = analyticsPreset !== "custom";
    if (analyticsPreset !== "custom") {
      analyticsRange = DashboardState.getAnalyticsRange(
        analyticsPreset,
        "",
        "",
        new Date(),
      );
      renderDashboardData();
    } else {
      $("#analyticsRangeStatus").textContent =
        "Choose a valid custom range and apply it. The currently applied range remains active until then.";
    }
  });

  $("#applyAnalyticsRange").addEventListener("click", () => {
    const nextRange = DashboardState.getAnalyticsRange(
      analyticsPreset,
      $("#analyticsStart").value,
      $("#analyticsEnd").value,
      new Date(),
    );
    const status = $("#analyticsRangeStatus");
    if (nextRange.error) {
      status.textContent = nextRange.error;
      $("#analyticsStart").setAttribute("aria-invalid", "true");
      $("#analyticsEnd").setAttribute("aria-invalid", "true");
      return;
    }
    analyticsRange = nextRange;
    $("#analyticsStart").removeAttribute("aria-invalid");
    $("#analyticsEnd").removeAttribute("aria-invalid");
    renderDashboardData();
  });

  customDates.hidden = analyticsPreset !== "custom";
  if (!analyticsRange.from || !analyticsRange.to) {
    $("#analyticsRangeStatus").textContent = `Choose dates on or before ${today}.`;
  }
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
    clearTimeout(searchTimer);
    searchSequence += 1;
    layer.classList.remove("is-open");
    layer.setAttribute("aria-hidden", "true");
    $("#searchButton").focus();
  };
  $("#searchButton").addEventListener("click", () => {
    layer.classList.add("is-open");
    layer.setAttribute("aria-hidden", "false");
    input.value = "";
    results.textContent = "Search students, teachers, classes, subjects, attendance, fees, and results.";
    input.focus();
  });
  $("#searchClose").addEventListener("click", close);
  layer.addEventListener("click", (event) => {
    if (event.target === layer) close();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      const firstResult = results.querySelector("button[data-href]");
      if (firstResult) {
        event.preventDefault();
        firstResult.focus();
      }
    }
  });
  results.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const items = [...results.querySelectorAll("button[data-href]")];
    const index = items.indexOf(document.activeElement);
    const target = event.key === "ArrowDown" ? index + 1 : index - 1;
    if (target >= 0 && target < items.length) {
      event.preventDefault();
      items[target].focus();
    } else if (event.key === "ArrowUp" && index === 0) {
      event.preventDefault();
      input.focus();
    }
  });
  input.addEventListener("input", () => {
    clearTimeout(searchTimer);
    const sequence = ++searchSequence;
    const term = input.value.trim().toLocaleLowerCase();
    if (!term) {
      results.textContent = "Search students, teachers, classes, subjects, attendance, fees, and results.";
      return;
    }
    if ($(".workspace")?.getAttribute("aria-busy") === "true") {
      results.textContent = "Dashboard records are still loading. Try your search again shortly.";
      return;
    }
    results.textContent = "Searching records you are allowed to view…";
    searchTimer = setTimeout(() => {
      if (sequence !== searchSequence) return;
      const searchIndex = [
        ...(dashboardData.students || []).map((record) => ({
          label: record.name || "Student",
          terms: [record.name, record.class],
          type: "Student",
          href: "../students/index.html",
        })),
        ...(dashboardData.teachers || []).map((record) => ({
          label: record.name || "Teacher",
          terms: [record.name, record.subjects],
          type: "Teacher",
          href: "../teachers/index.html",
        })),
        ...(dashboardData.classes || []).map((record) => ({
          label: record.name || "Class",
          terms: [record.name, record.grade],
          type: "Class",
          href: "../classes-subjects/index.html",
        })),
        ...(dashboardData.subjects || []).map((record) => ({
          label: record.name || "Subject",
          terms: [record.name, record.code],
          type: "Subject",
          href: "../classes-subjects/index.html",
        })),
        ...(dashboardData.attendance || []).map((record) => ({
          label: `${record.className || "Attendance"} · ${record.status || "status not recorded"}`,
          terms: [record.className, record.status, record.date],
          type: "Attendance",
          href: "../attendance/index.html",
        })),
        ...(dashboardData.fees || []).map((record) => ({
          label: record.studentName || `Fee ${money(record.amount)}`,
          terms: [record.studentName, record.class, record.status, record.amount],
          type: "Fee record",
          href: "../fees/index.html",
        })),
        ...(dashboardData.exams || []).map((record) => ({
          label: `${record.studentName || "Result"} ${record.subject || ""}`.trim(),
          terms: [record.studentName, record.subject, record.examName, record.term],
          type: "Result",
          href: "../exams/index.html",
        })),
        ...(dashboardData.announcements || []).map((record) => ({
          label: record.title || "Announcement",
          terms: [record.title, record.body],
          type: "Announcement",
          href: "../announcements/index.html",
        })),
      ];
      const matches = searchIndex.filter((item) =>
        [item.label, item.type, ...item.terms]
          .filter((value) => value !== null && value !== undefined)
          .join(" ")
          .toLocaleLowerCase()
          .includes(term),
      );
      results.replaceChildren();
      const unavailableSources = [
        "students",
        "teachers",
        "classes",
        "subjects",
        "attendance",
        "fees",
        "exams",
        "announcements",
      ].filter((key) => dashboardData.errors?.[key]);
      if (!matches.length) {
        results.textContent = unavailableSources.length
          ? `No match in the loaded records. Some sources are unavailable: ${unavailableSources.join(", ")}.`
          : "No matching records found in the records available to your account.";
        return;
      }
      for (const item of matches.slice(0, 20)) {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.href = item.href;
        const title = document.createElement("strong");
        title.textContent = item.label;
        const type = document.createElement("small");
        type.textContent = ` · ${item.type}`;
        button.append(title, type);
        results.append(button);
      }
      if (unavailableSources.length) {
        const notice = document.createElement("p");
        notice.textContent = `Some search sources are unavailable: ${unavailableSources.join(", ")}.`;
        results.append(notice);
      }
    }, 160);
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
  const range = analyticsRange || DashboardState.getAnalyticsRange("30", "", "");
  const attendanceWindow = DashboardState.filterRecordsByRange(
    attendance,
    range,
    ["date"],
  );
  const feeWindow = DashboardState.filterRecordsByRange(
    fees,
    range,
    ["updatedAt", "createdAt"],
  );
  const examWindow = DashboardState.filterRecordsByRange(
    exams,
    range,
    ["createdAt", "updatedAt"],
  );
  const analyticsAttendance = attendanceWindow.records;
  const analyticsFees = feeWindow.records;
  const analyticsExams = examWindow.records;
  const scoredExams = analyticsExams.filter((record) => {
    if (record.score === null || record.score === undefined) return false;
    if (record.maxScore === null || record.maxScore === undefined) return false;
    const score = Number(record.score);
    const maxScore = Number(record.maxScore);
    return Number.isFinite(score) && Number.isFinite(maxScore) && maxScore > 0 && score >= 0;
  });
  const missingDates =
    attendanceWindow.missingDateCount +
    feeWindow.missingDateCount +
    examWindow.missingDateCount;
  const unavailableAnalytics = ["attendance", "fees", "exams"]
    .filter((key) => errors[key])
    .map((key) => key);
  $("#analyticsRangeStatus").textContent =
    `Analytics: ${range.from} through ${range.to}. ` +
    `${missingDates ? `${missingDates} records without usable dates are excluded. ` : ""}` +
    `${unavailableAnalytics.length ? `Unavailable data sources: ${unavailableAnalytics.join(", ")}. ` : ""}` +
    "Fee totals use fee-record status and dates, not a separate payment ledger.";
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
  const amountOnNotFullyPaidFees = Math.max(0, totalFees - collectedFees);
  const feeRate = totalFees ? Math.round((collectedFees / totalFees) * 100) : 0;
  const classCount = dashboardData.classes.length || new Set(students.map((student) => student.class).filter(Boolean)).size;

  $("#metricStudents").textContent = students.length.toLocaleString();
  $("#metricClasses").textContent = `Across ${classCount} active classes`;
  $("#metricAttendance").textContent = attendanceRate === null ? "—" : `${attendanceRate}%`;
  $("#metricAttendanceNote").textContent = todayAttendance.length
    ? `${todayAttendance.length} of ${students.length} students marked`
    : "No register submitted today";
  $("#metricFees").textContent = `${feeRate}%`;
  $("#metricFeesNote").textContent = `${money(collectedFees)} of fee-record amounts marked paid`;
  $("#metricTeachers").textContent = teachers.length.toLocaleString();

  const periodPresent = analyticsAttendance.filter(
    (record) => record.status === "present" || record.status === "late",
  ).length;
  const periodAttendanceRate = analyticsAttendance.length
    ? Math.round((periodPresent / analyticsAttendance.length) * 100)
    : null;
  $("#attendanceSummary").textContent =
    periodAttendanceRate === null ? "—" : `${periodAttendanceRate}%`;
  $("#attendanceSummaryNote").textContent = analyticsAttendance.length
    ? `${periodPresent} present or late of ${analyticsAttendance.length} records`
    : "No attendance records in the selected period";

  const studentsById = new Map(students.map((student) => [student.id, student]));
  const classGroups = new Map();
  students.forEach((student) => {
    const className = student.class || "Unassigned";
    if (!classGroups.has(className)) classGroups.set(className, []);
    classGroups.get(className).push(student);
  });
  $("#classBreakdown").innerHTML = [...classGroups.entries()].slice(0, 6).map(([className, records]) => {
    const recordIds = new Set(records.map((student) => student.id));
    const marked = analyticsAttendance.filter((record) => recordIds.has(record.studentId));
    const count = marked.filter((record) => record.status === "present" || record.status === "late").length;
    const rate = marked.length ? Math.round((count / marked.length) * 100) : 0;
    return `<div><span>${escapeHtml(className)}</span><b>${marked.length ? `${rate}%` : "—"}</b><small>${marked.length} marked of ${records.length} students</small><i><em style="width:${rate}%"></em></i></div>`;
  }).join("") || `<p class="dashboard-empty">No classes or student groups yet.</p>`;

  const subjectScores = new Map();
  scoredExams.forEach((record) => {
    const subject = record.subject || "Other";
    const percentage = (Number(record.score) / Number(record.maxScore)) * 100;
    const group = subjectScores.get(subject) || { total: 0, count: 0 };
    group.total += percentage;
    group.count += 1;
    subjectScores.set(subject, group);
  });
  dashboardData.subjectAverages = [...subjectScores.entries()].map(([subject, group]) => ({
    subject,
    average: Math.round(group.total / group.count),
  }));
  const overallAverage = scoredExams.length
    ? Math.round(scoredExams.reduce((total, record) => total + (Number(record.score) / Number(record.maxScore)) * 100, 0) / scoredExams.length)
    : null;
  $("#performanceSummary").textContent = overallAverage === null ? "—" : `${overallAverage}%`;
  $('[data-dashboard-widget="performance"] .chart-summary small').textContent = analyticsExams.length
    ? `${scoredExams.length} scored of ${analyticsExams.length} assessment records in the selected period`
    : "No assessment records in the selected period";
  $("#performanceList").innerHTML = dashboardData.subjectAverages.slice(0, 5).map(({ subject, average }) =>
    `<div><span>${escapeHtml(subject)}</span><b>${average}%</b><i><em style="width:${Math.min(100, average)}%"></em></i></div>`,
  ).join("") || `<p class="dashboard-empty">No exam results recorded yet.</p>`;

  const periodTotalFees = analyticsFees.reduce(
    (total, record) => total + Number(record.amount || 0),
    0,
  );
  const periodPaidFees = analyticsFees
    .filter((record) => record.status === "paid")
    .reduce((total, record) => total + Number(record.amount || 0), 0);
  const periodNotFullyPaidFees = Math.max(0, periodTotalFees - periodPaidFees);
  const periodFeeRate = periodTotalFees
    ? Math.round((periodPaidFees / periodTotalFees) * 100)
    : 0;
  $("#financeStats").innerHTML = [
    ["Expected in period", money(periodTotalFees)],
    ["Marked paid", money(periodPaidFees)],
    ["Amount on not-fully-paid records", money(periodNotFullyPaidFees)],
    ["Paid amount share", `${periodFeeRate}%`],
  ].map(([label, value]) => `<div><small>${label}</small><strong>${value}</strong></div>`).join("");

  const recentPayments = analyticsFees
    .filter((record) => record.status === "paid")
    .sort((left, right) => String(right.updatedAt || right.createdAt || "").localeCompare(String(left.updatedAt || left.createdAt || "")))
    .slice(0, 3);
  $("#paymentList").innerHTML = `<h3>Recent fee records marked paid</h3>${recentPayments.map((record) => {
    const student = studentsById.get(record.studentId);
    const initials = (record.studentName || student?.name || "?").split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase();
    const paidDate = record.updatedAt || record.createdAt;
    const dateText = paidDate ? new Date(paidDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "Date not recorded";
    return `<div><span class="payment-avatar">${escapeHtml(initials)}</span><p><strong>${escapeHtml(record.studentName || student?.name || "Student")}</strong><small>${escapeHtml(record.class || student?.class || "")}${record.class || student?.class ? " · " : ""}${dateText}</small></p><b>${money(record.amount)}</b></div>`;
  }).join("") || `<p class="dashboard-empty">No paid fee records yet.</p>`}`;

  const attentionItems = [];
  const unpaidCount = fees.filter((record) => record.status !== "paid").length;
  if (unpaidCount) attentionItems.push({ type: "warning", icon: "!", title: `${unpaidCount} fee records are not fully marked paid`, detail: `${money(amountOnNotFullyPaidFees)} in original fee amounts; exact partial balances are unavailable`, href: "../fees/index.html" });
  const unmarkedCount = Math.max(0, students.length - new Set(todayAttendance.map((record) => record.studentId)).size);
  if (students.length && unmarkedCount) attentionItems.push({ type: "warning", icon: "!", title: `${unmarkedCount} students have no attendance entry today`, detail: "Attendance · Today's register", href: "../attendance/index.html" });
  const lowScores = scoredExams.filter((record) => Number(record.score) / Number(record.maxScore) < 0.4).length;
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
    ...fees.filter((record) => record.status === "paid").map((record) => ({ date: record.updatedAt || record.createdAt, title: "Fee record marked paid", detail: `${record.studentName || studentsById.get(record.studentId)?.name || "Student"} · ${money(record.amount)}`, icon: "₵", color: "green", href: "../fees/index.html" })),
    ...attendance.map((record) => ({ date: record.createdAt || record.date, title: "Attendance submitted", detail: `${record.className || "Class"} · ${record.status}`, icon: "✓", color: "yellow", href: "../attendance/index.html" })),
    ...dashboardData.announcements.map((record) => ({ date: record.createdAt || record.date, title: "Announcement published", detail: record.title, icon: "◌", color: "blue", href: "../announcements/index.html" })),
  ].filter((item) => item.date).sort((left, right) => String(right.date).localeCompare(String(left.date))).slice(0, 5);
  const actorCanReadAudit = ["admin", "school_admin"].includes(
    SmsAuth.getUser()?.role,
  );
  const auditActivity = actorCanReadAudit
    ? (dashboardData.auditLogs || []).map((record) => ({
        date: record.timestamp,
        title: String(record.action || "Administrative activity").replace(/_/g, " "),
        detail: `${record.entityType || "Record"} · ${record.actorUserId ? "Actor recorded" : "Actor not recorded"}`,
        icon: "≋",
        color: "blue",
        href: null,
      }))
    : [];
  const visibleActivity = auditActivity.length
    ? auditActivity
    : activityItems;
  $("#activityFeed").innerHTML = visibleActivity.map((item) => {
    const date = item.date ? new Date(item.date) : null;
    const time =
      date && !Number.isNaN(date.getTime())
        ? date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
        : "Time not recorded";
    const link = item.href
      ? `<a href="${item.href}" aria-label="Open ${escapeHtml(item.title)}">→</a>`
      : "";
    return `<div><time>${escapeHtml(time)}</time><span class="feed-icon feed-icon--${item.color}">${item.icon}</span><p><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.detail || "")}</small></p>${link}</div>`;
  }).join("") || `<p class="dashboard-empty">No school activity is available yet.</p>`;

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
      '<p class="dashboard-empty">Recent fee records unavailable.</p>';
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
  analyticsAttendance.forEach((record) => {
    if (!attendanceByDate.has(record.date)) attendanceByDate.set(record.date, []);
    attendanceByDate.get(record.date).push(record);
  });
  dashboardData.attendanceSeries = [...attendanceByDate.entries()].sort(([left], [right]) => left.localeCompare(right)).slice(-6).map(([date, records]) => ({
    label: new Date(`${date}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short" }),
    rate: Math.round((records.filter((record) => record.status === "present" || record.status === "late").length / records.length) * 100),
  }));
  const paidByMonth = new Map();
  analyticsFees.filter((record) => record.status === "paid").forEach((record) => {
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
  const reduceMotion =
    document.documentElement.classList.contains("reduce-motion") ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  Chart.defaults.animation.duration = reduceMotion ? 0 : 500;
}

function makeChartNavigable(canvas, url, hasData, description) {
  canvas.setAttribute("aria-label", description);
  canvas.setAttribute("role", hasData ? "link" : "img");
  canvas.tabIndex = hasData ? 0 : -1;
  canvas.style.cursor = hasData ? "pointer" : "default";
  canvas.dataset.navigationUrl = hasData ? url : "";
  if (canvas.dataset.navigationKeyBound === "true") return;
  canvas.dataset.navigationKeyBound = "true";
  canvas.addEventListener("keydown", (event) => {
    if (
      (event.key === "Enter" || event.key === " ") &&
      canvas.dataset.navigationUrl
    ) {
      event.preventDefault();
      window.location.href = canvas.dataset.navigationUrl;
    }
  });
}

function renderCharts() {
  dashboardCharts.forEach((chart) => chart.destroy());
  dashboardCharts = [];
  chartDefaults();
  const grid = "rgba(113,128,143,.12)";
  const attendanceSeries = dashboardData.attendanceSeries || [];
  const subjectAverages = (dashboardData.subjectAverages || []).slice(0, 4);
  const financeSeries = dashboardData.financeSeries || [];
  const attendanceCanvas = $("#attendanceTrendChart");
  const performanceCanvas = $("#performanceChart");
  const financeCanvas = $("#financeChart");
  makeChartNavigable(
    attendanceCanvas,
    "../attendance/index.html",
    attendanceSeries.length > 0,
    attendanceSeries.length
      ? "Attendance trend chart. Press Enter to open attendance."
      : "No attendance data for the selected period.",
  );
  makeChartNavigable(
    performanceCanvas,
    "../exams/index.html",
    subjectAverages.length > 0,
    subjectAverages.length
      ? "Subject performance chart. Press Enter to open results."
      : "No scored assessment data for the selected period.",
  );
  makeChartNavigable(
    financeCanvas,
    "../fees/index.html",
    financeSeries.length > 0,
    financeSeries.length
      ? "Fee records marked paid by month. Press Enter to open fees."
      : "No fee records marked paid for the selected period.",
  );
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
      onClick: (_event, elements) => {
        if (elements.length && attendanceSeries.length) {
          window.location.href = "../attendance/index.html";
        }
      },
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
      onClick: (_event, elements) => {
        if (elements.length && subjectAverages.length) {
          window.location.href = "../exams/index.html";
        }
      },
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
      onClick: (_event, elements) => {
        if (elements.length && financeSeries.length) {
          window.location.href = "../fees/index.html";
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          displayColors: false,
          callbacks: { label: (context) => `${money(context.parsed.y)} in fee records marked paid` },
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

  dashboardCharts = [attendanceChart, performanceChart, financeChart];
  if (!dashboardResizeHandlerBound) {
    dashboardResizeHandlerBound = true;
    window.addEventListener(
      "resize",
      () => {
        window.clearTimeout(dashboardResizeTimeout);
        dashboardResizeTimeout = window.setTimeout(() => {
          dashboardCharts.forEach((chart) => chart.resize());
          dashboardResizeTimeout = 0;
        }, 250);
      },
      { passive: true },
    );
  }
}

async function init() {
  if (dashboardInitStarted) return;
  if (SmsAuth.getUser()?.role === "super_admin") {
    window.location.replace(SmsAuth.homeUrlForRole("super_admin"));
    return;
  }
  dashboardInitStarted = true;
  try {
    setUserProfile();
    setupActions();
    setupMenus();
    setupSearch();
    setupWidgetCustomization();
    setupAnalyticsFilters();
    $("#dashboardDate").textContent = new Date().toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    await loadDashboardData();
    renderDashboardData();
    await setupSchoolProfile();
  } catch (error) {
    console.error("[dashboard] initialization failed:", error);
    SmsUI.toast("Dashboard could not finish loading. Refresh the page to try again.", "error");
  } finally {
    $(".workspace").setAttribute("aria-busy", "false");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  $(".workspace").setAttribute("aria-busy", "true");
  init();
});
