const auditRows = document.getElementById("auditRows");
const auditMessage = document.getElementById("auditMessage");
const auditCount = document.getElementById("auditCount");
const pagination = document.getElementById("pagination");
const filters = document.getElementById("auditFilters");
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
        <td><time datetime="${escapeHtml(record.timestamp)}">${escapeHtml(dateLabel)}</time></td>
        <td class="audit-action">${escapeHtml(record.action)}</td>
        <td>${escapeHtml(record.entityType)}</td>
        <td><span class="audit-id">${escapeHtml(record.entityId || "—")}</span></td>
        <td><span class="audit-id">${escapeHtml(record.actorUserId)}</span></td>
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
  auditRows.replaceChildren();
  setMessage("Loading audit activity…");
  auditCount.textContent = "";
  try {
    const parameters = new URLSearchParams({ page: String(page), limit: "25" });
    for (const [key, value] of new FormData(filters)) {
      if (typeof value === "string" && value.trim()) parameters.set(key, value.trim());
    }
    const response = await SmsAuth.apiFetch(`/audit-logs?${parameters}`);
    currentPage = response.meta.page;
    totalPages = response.meta.pages;
    auditCount.textContent = `${response.meta.total} ${response.meta.total === 1 ? "event" : "events"}`;
    setMessage("");
    renderRows(response.data);
    renderPagination();
  } catch (error) {
    auditRows.replaceChildren();
    pagination.replaceChildren();
    setMessage(error.message || "Audit activity could not be loaded.", "error");
  }
}

filters.addEventListener("submit", (event) => {
  event.preventDefault();
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
  loadAuditLogs();
}
