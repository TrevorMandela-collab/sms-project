const auditRows = document.getElementById("auditRows");
const auditMessage = document.getElementById("auditMessage");
const auditCount = document.getElementById("auditCount");
const pagination = document.getElementById("pagination");
const filters = document.getElementById("auditFilters");
const actionFilter = document.getElementById("actionFilter");
const activeFilters = document.getElementById("activeAuditFilters");
let requestSequence = 0;
let currentPage = 1;
let totalPages = 0;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) =>
    ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[character],
  );
}

function setMessage(message, state = "") {
  auditMessage.textContent = message;
  auditMessage.dataset.state = state;
  auditMessage.hidden = !message;
}

function renderRows(records) {
  if (!records.length) {
    auditRows.innerHTML = '<tr><td colspan="5">No activity matches these filters.</td></tr>';
    return;
  }
  auditRows.innerHTML = records
    .map((record) => {
      const timestamp = new Date(record.timestamp);
      const dateLabel = Number.isNaN(timestamp.getTime())
        ? "Unknown date"
        : timestamp.toLocaleString();
      return `<tr>
        <td><time datetime="${escapeHtml(record.timestamp || "")}">${escapeHtml(dateLabel)}</time></td>
        <td class="audit-action">${escapeHtml(record.action || "Unknown action")}</td>
        <td>${escapeHtml(record.entityType || "—")}</td>
        <td><span class="audit-id">${escapeHtml(record.entityId || "—")}</span></td>
        <td><span class="audit-id">${escapeHtml(record.actorUserId || "Not recorded")}</span></td>
      </tr>`;
    })
    .join("");
}

function renderPagination() {
  pagination.replaceChildren();
  if (totalPages < 2) return;

  const previous = document.createElement("button");
  previous.type = "button";
  previous.textContent = "Previous";
  previous.disabled = currentPage <= 1;
  previous.addEventListener("click", () => loadAuditLogs(currentPage - 1));
  pagination.append(previous);

  const next = document.createElement("button");
  next.type = "button";
  next.textContent = "Next";
  next.disabled = currentPage >= totalPages;
  next.addEventListener("click", () => loadAuditLogs(currentPage + 1));
  pagination.append(next);
}

async function loadAuditLogs(page = 1) {
  const sequence = ++requestSequence;
  auditRows.replaceChildren();
  setMessage("Loading audit activity…");
  auditCount.textContent = "";
  filters.setAttribute("aria-busy", "true");
  try {
    const parameters = new URLSearchParams({ page: String(page), limit: "25" });
    for (const [key, value] of new FormData(filters)) {
      if (typeof value === "string" && value.trim()) parameters.set(key, value.trim());
    }
    const response = await SmsAuth.apiFetch(`/audit-logs?${parameters}`);
    if (sequence !== requestSequence) return;
    currentPage = response.meta.page;
    totalPages = response.meta.pages;
    auditCount.textContent = `${response.meta.total} ${response.meta.total === 1 ? "event" : "events"}`;
    const selected = [...new FormData(filters)]
      .filter(([, value]) => typeof value === "string" && value.trim())
      .map(([key, value]) => `${key}: ${value.trim()}`);
    activeFilters.textContent = selected.length
      ? `Active filters: ${selected.join(" · ")}`
      : "Showing all available audit activity.";
    setMessage("");
    renderRows(response.data);
    renderPagination();
  } catch (error) {
    if (sequence !== requestSequence) return;
    auditRows.replaceChildren();
    pagination.replaceChildren();
    setMessage(error.message || "Audit activity could not be loaded.", "error");
  } finally {
    if (sequence === requestSequence) filters.removeAttribute("aria-busy");
  }
}

async function loadActionOptions() {
  const filterMessage = document.getElementById("auditFilterMessage");
  try {
    const response = await SmsAuth.apiFetch("/audit-logs/filters");
    if (!Array.isArray(response.actions)) {
      throw new Error("The audit service returned an unexpected filter response.");
    }
    for (const option of [...actionFilter.options].slice(1)) option.remove();
    for (const action of response.actions) {
      if (typeof action !== "string" || !action.trim()) continue;
      const option = document.createElement("option");
      option.value = action;
      option.textContent = action;
      actionFilter.append(option);
    }
    filterMessage.textContent = response.actions.length
      ? ""
      : "No audit actions have been recorded yet.";
  } catch (error) {
    filterMessage.textContent =
      error.message || "Recorded action options could not be loaded.";
    filterMessage.dataset.state = "error";
  }
}

filters.addEventListener("submit", (event) => {
  event.preventDefault();
  const from = filters.elements.namedItem("from").value;
  const to = filters.elements.namedItem("to").value;
  if (from && to && from > to) {
    setMessage("The start date must be on or before the end date.", "error");
    return;
  }
  loadAuditLogs(1);
});
document.getElementById("refreshButton").addEventListener("click", () => {
  loadAuditLogs(currentPage);
});
document.getElementById("resetFilters").addEventListener("click", () => {
  filters.reset();
  loadAuditLogs(1);
});

if (!SmsAuth.hasRole("admin", "school_admin")) {
  window.location.replace(SmsAuth.homeUrlForRole(SmsAuth.getUser()?.role));
} else {
  loadActionOptions();
  loadAuditLogs();
}
