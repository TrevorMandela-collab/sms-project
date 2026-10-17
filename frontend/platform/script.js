const platformState = {
  schools: [],
  page: 1,
  pageSize: 10,
  selectedSchool: null,
};

const platformElement = (id) => document.getElementById(id);
const platformDetails = platformElement("schoolDetails");
const platformRows = platformElement("schoolRows");

if (SmsAuth.getUser()?.role !== "super_admin") {
  window.location.replace(SmsAuth.homeUrlForRole(SmsAuth.getUser()?.role));
} else {
  initializePlatformPage();
}

function showPlatformError(message) {
  const error = platformElement("platformError");
  error.textContent = message;
  error.hidden = false;
}

function clearPlatformError() {
  const error = platformElement("platformError");
  error.textContent = "";
  error.hidden = true;
}

function showPlatformToast(message) {
  const toast = platformElement("platformToast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(showPlatformToast.timeout);
  showPlatformToast.timeout = setTimeout(
    () => toast.classList.remove("is-visible"),
    2800,
  );
}

function formatCreatedAt(value) {
  if (!value || Number.isNaN(Date.parse(value))) return "—";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(new Date(value));
}

function formatAuditTime(value) {
  if (!value || Number.isNaN(Date.parse(value))) return "Time unavailable";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function renderPlatformAudit(events) {
  const rows = platformElement("platformAuditRows");
  rows.replaceChildren();
  for (const event of events) {
    const row = document.createElement("tr");
    row.append(
      createCell(event.action || "Unknown action"),
      createCell(
        [event.entityType, event.entityId].filter(Boolean).join(" · ") ||
          "Record unavailable",
      ),
      createCell(event.schoolId || "Platform"),
      createCell(formatAuditTime(event.timestamp)),
    );
    rows.append(row);
  }
  platformElement("platformAuditState").textContent = events.length
    ? ""
    : "No platform audit events have been recorded yet.";
}

async function loadPlatformAudit() {
  const state = platformElement("platformAuditState");
  state.textContent = "Loading platform activity…";
  const result = await SmsAuth.apiFetch("/audit-logs/platform?limit=10");
  if (!Array.isArray(result.data)) {
    throw new Error("The platform audit feed returned an unexpected response.");
  }
  renderPlatformAudit(result.data);
}

function filteredSchools() {
  const search = platformElement("schoolSearch").value.trim().toLocaleLowerCase();
  return platformState.schools.filter((school) =>
    school.name.toLocaleLowerCase().includes(search),
  );
}

function renderPlatformSummary() {
  platformElement("schoolCount").textContent =
    platformState.schools.length.toLocaleString();
  platformElement("setupCount").textContent = platformState.schools
    .filter((school) => !school.onboardingCompleted)
    .length.toLocaleString();
}

function createCell(text, className = "") {
  const cell = document.createElement("td");
  cell.textContent = text;
  if (className) cell.className = className;
  return cell;
}

function renderSchoolDirectory() {
  const schools = filteredSchools();
  const pageCount = Math.max(
    1,
    Math.ceil(schools.length / platformState.pageSize),
  );
  platformState.page = Math.min(platformState.page, pageCount);
  const start = (platformState.page - 1) * platformState.pageSize;
  const visibleSchools = schools.slice(start, start + platformState.pageSize);
  platformRows.replaceChildren();

  for (const school of visibleSchools) {
    const row = document.createElement("tr");
    const nameCell = createCell("");
    const name = document.createElement("strong");
    name.textContent = school.name;
    const id = document.createElement("small");
    id.className = "platform-school-id";
    id.textContent = school.id;
    nameCell.append(name, id);
    row.append(nameCell);
    const schoolStatus =
      selectedSettings(school).status === "suspended" ? "Suspended" : "Active";
    const setupStatus = school.onboardingCompleted
      ? "Onboarded"
      : "Setup in progress";
    row.append(
      createCell(
        `${schoolStatus} · ${setupStatus}`,
        schoolStatus === "Suspended"
          ? "platform-status platform-status--suspended"
          : school.onboardingCompleted
            ? "platform-status platform-status--ready"
            : "platform-status platform-status--pending",
      ),
    );
    row.append(createCell(formatCreatedAt(school.createdAt)));

    const actionCell = document.createElement("td");
    actionCell.className = "platform-row-action";
    const detailsButton = document.createElement("button");
    detailsButton.className = "platform-button platform-button--quiet";
    detailsButton.type = "button";
    detailsButton.dataset.schoolId = school.id;
    detailsButton.textContent = "Manage";
    detailsButton.setAttribute("aria-label", `Manage ${school.name}`);
    actionCell.append(detailsButton);
    row.append(actionCell);
    platformRows.append(row);
  }

  platformElement("schoolEmpty").hidden =
    schools.length > 0 || platformState.schools.length === 0;
  if (!schools.length) {
    const row = document.createElement("tr");
    row.append(
      createCell(
        platformState.schools.length
          ? "No schools match this search."
          : "No schools have been created yet.",
        "platform-table-state",
      ),
    );
    row.firstElementChild.colSpan = 4;
    platformRows.append(row);
  }
  renderPagination(schools.length, pageCount);
}

function renderPagination(total, pageCount) {
  const pagination = platformElement("schoolPagination");
  pagination.replaceChildren();
  const summary = document.createElement("span");
  const first = total ? (platformState.page - 1) * platformState.pageSize + 1 : 0;
  const last = Math.min(platformState.page * platformState.pageSize, total);
  summary.textContent = `${first}–${last} of ${total} schools`;
  pagination.append(summary);

  const previous = document.createElement("button");
  previous.type = "button";
  previous.className = "platform-button platform-button--quiet";
  previous.textContent = "Previous";
  previous.disabled = platformState.page <= 1;
  previous.addEventListener("click", () => {
    platformState.page -= 1;
    renderSchoolDirectory();
  });
  const next = document.createElement("button");
  next.type = "button";
  next.className = "platform-button platform-button--quiet";
  next.textContent = "Next";
  next.disabled = platformState.page >= pageCount;
  next.addEventListener("click", () => {
    platformState.page += 1;
    renderSchoolDirectory();
  });
  pagination.append(previous, next);
}

async function loadSchools() {
  clearPlatformError();
  platformRows.replaceChildren();
  const loadingRow = document.createElement("tr");
  const loadingCell = createCell("Loading school directory…", "platform-table-state");
  loadingCell.colSpan = 4;
  loadingRow.append(loadingCell);
  platformRows.append(loadingRow);
  const result = await SmsAuth.apiFetch("/schools/platform");
  if (!Array.isArray(result.schools)) {
    throw new Error("The platform directory returned an unexpected response.");
  }
  platformState.schools = result.schools;
  platformState.page = 1;
  renderPlatformSummary();
  renderSchoolDirectory();
}

function selectedSettings(school) {
  return school.settings && typeof school.settings === "object"
    ? school.settings
    : {};
}

function openSchoolDetails(school) {
  platformState.selectedSchool = school;
  const settings = selectedSettings(school);
  platformElement("schoolDetailsTitle").textContent = school.name;
  platformElement("selectedSchoolId").value = school.id;
  platformElement("schoolName").value = school.name || "";
  platformElement("schoolType").value = settings.schoolType || "";
  platformElement("schoolEmail").value = settings.email || "";
  platformElement("schoolPhone").value = settings.phone || "";
  platformElement("schoolAddress").value = settings.address || "";
  platformElement("schoolAcademicYear").value = settings.academicYear || "";
  platformElement("schoolAccentColor").value = /^#[\da-f]{6}$/i.test(
    settings.accentColor || "",
  )
    ? settings.accentColor
    : "#237c78";
  platformElement("schoolLifecycleStatus").value =
    settings.status === "suspended" ? "suspended" : "active";
  platformElement("createSchoolAdminForm").reset();
  platformDetails.hidden = false;
  platformDetails.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function createSchool(event) {
  event.preventDefault();
  clearPlatformError();
  const form = event.currentTarget;
  const button = form.querySelector("button[type='submit']");
  button.disabled = true;
  try {
    const body = { name: platformElement("newSchoolName").value.trim() };
    const result = await SmsAuth.apiFetch("/schools/platform", {
      method: "POST",
      body,
    });
    platformState.schools.push(result.school);
    platformElement("newSchoolName").value = "";
    renderPlatformSummary();
    renderSchoolDirectory();
    showPlatformToast("School created.");
    openSchoolDetails(result.school);
  } catch (error) {
    showPlatformError(error.message || "Could not create the school.");
  } finally {
    button.disabled = false;
  }
}

async function saveSchoolSettings(event) {
  event.preventDefault();
  clearPlatformError();
  const schoolId = platformElement("selectedSchoolId").value;
  const form = event.currentTarget;
  const button = form.querySelector("button[type='submit']");
  const settings = Object.fromEntries(new FormData(form));
  delete settings.schoolId;
  button.disabled = true;
  try {
    const result = await SmsAuth.apiFetch(
      `/schools/platform/${encodeURIComponent(schoolId)}`,
      {
        method: "PATCH",
        body: settings,
      },
    );
    platformState.schools = platformState.schools.map((school) =>
      school.id === schoolId ? result.school : school,
    );
    renderSchoolDirectory();
    openSchoolDetails(result.school);
    showPlatformToast("School settings saved.");
  } catch (error) {
    showPlatformError(error.message || "Could not save school settings.");
  } finally {
    button.disabled = false;
  }
}

async function createSchoolAdmin(event) {
  event.preventDefault();
  clearPlatformError();
  const schoolId = platformElement("selectedSchoolId").value;
  if (!schoolId) return;
  const form = event.currentTarget;
  const button = form.querySelector("button[type='submit']");
  const passwordInput = platformElement("adminPassword");
  const body = {
    name: platformElement("adminName").value.trim(),
    email: platformElement("adminEmail").value.trim(),
    password: passwordInput.value,
  };
  button.disabled = true;
  try {
    await SmsAuth.apiFetch(
      `/schools/platform/${encodeURIComponent(schoolId)}/admins`,
      { method: "POST", body },
    );
    form.reset();
    showPlatformToast("School Admin account created for this school.");
  } catch (error) {
    showPlatformError(error.message || "Could not create the School Admin.");
  } finally {
    passwordInput.value = "";
    button.disabled = false;
  }
}

function csvCell(value) {
  let safeValue = String(value ?? "");
  if (/^[=+\-@]/.test(safeValue)) safeValue = `'${safeValue}`;
  return `"${safeValue.replace(/"/g, '""')}"`;
}

function exportSchoolDirectory() {
  const rows = [
    ["School name", "School ID", "School status", "Setup status", "Created"],
    ...filteredSchools().map((school) => [
      school.name,
      school.id,
      selectedSettings(school).status === "suspended" ? "Suspended" : "Active",
      school.onboardingCompleted ? "Onboarded" : "Setup in progress",
      school.createdAt || "",
    ]),
  ];
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "mandela-school-directory.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function initializePlatformPage() {
  platformElement("createSchoolForm").addEventListener("submit", createSchool);
  platformElement("schoolSettingsForm").addEventListener("submit", saveSchoolSettings);
  platformElement("createSchoolAdminForm").addEventListener("submit", createSchoolAdmin);
  platformElement("schoolSearch").addEventListener("input", () => {
    platformState.page = 1;
    renderSchoolDirectory();
  });
  platformElement("schoolRows").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-school-id]");
    if (!button) return;
    const school = platformState.schools.find(
      (item) => item.id === button.dataset.schoolId,
    );
    if (school) openSchoolDetails(school);
  });
  platformElement("closeSchoolDetails").addEventListener("click", () => {
    platformDetails.hidden = true;
    platformState.selectedSchool = null;
  });
  platformElement("exportSchools").addEventListener("click", exportSchoolDirectory);
  loadSchools().catch((error) => {
    showPlatformError(error.message || "Could not load the school directory.");
    platformRows.replaceChildren();
    const row = document.createElement("tr");
    const cell = createCell(
      "The directory could not be loaded. Retry by refreshing this page.",
      "platform-table-state",
    );
    cell.colSpan = 4;
    row.append(cell);
    platformRows.append(row);
  });
  loadPlatformAudit().catch((error) => {
    platformElement("platformAuditState").textContent =
      error.message || "Could not load platform activity.";
    platformElement("platformAuditRows").replaceChildren();
  });
}
