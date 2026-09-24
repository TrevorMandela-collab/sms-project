/* =========================================================
   Students module — School Management System
   Full CRUD against the backend API. Requires auth-client.js
   + auth-guard.js loaded first.
========================================================= */

const PAGE_SIZE = 8;

let studentsState = [];
let currentPage = 1;
let searchTerm = "";
let classFilter = "all";
let isLoading = true;
let loadError = null;

/* ---------- Data loading ---------- */
async function loadStudents() {
  isLoading = true;
  loadError = null;
  renderTable();
  try {
    studentsState = await SmsAuth.apiFetch("/students");
  } catch (err) {
    loadError = err.message;
  } finally {
    isLoading = false;
    populateClassFilter();
    renderStats();
    renderTable();
  }
}

function populateClassFilter() {
  const select = document.getElementById("classFilter");
  const classes = [
    ...new Set(studentsState.map((s) => s.class).filter(Boolean)),
  ].sort();
  const currentValue = select.value;
  select.innerHTML =
    `<option value="all">All classes</option>` +
    classes.map((c) => `<option value="${c}">${c}</option>`).join("");
  select.value = classes.includes(currentValue) ? currentValue : "all";
}

function renderStats() {
  document.getElementById("statTotal").textContent = studentsState.length;
  document.getElementById("statClasses").textContent = new Set(
    studentsState.map((s) => s.class).filter(Boolean),
  ).size;
}

/* ---------- Derived views ---------- */
function getFiltered() {
  return studentsState
    .filter((s) => s.name.toLowerCase().includes(searchTerm.toLowerCase()))
    .filter((s) => classFilter === "all" || s.class === classFilter)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/* ---------- Rendering ---------- */
function renderTable() {
  const tbody = document.getElementById("studentsTableBody");
  const user = SmsAuth.getUser();
  const canManage = user && user.role === "admin";

  if (isLoading) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="loading-state">Loading students…</div></td></tr>`;
    document.getElementById("pagination").innerHTML = "";
    return;
  }

  if (loadError) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="error-state">Couldn't load students: ${loadError}</div></td></tr>`;
    document.getElementById("pagination").innerHTML = "";
    return;
  }

  const filtered = getFiltered();
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  currentPage = Math.min(currentPage, totalPages);
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);

  if (!pageItems.length) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state">No students match your filters.</div></td></tr>`;
  } else {
    tbody.innerHTML = pageItems
      .map(
        (s) => `
      <tr>
        <td>${s.name}</td>
        <td>${s.class || "—"}</td>
        <td>${s.dateOfBirth ? new Date(s.dateOfBirth).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—"}</td>
        <td>${s.guardianContact || "—"}</td>
        <td>
          ${
            canManage
              ? `
            <div class="row-actions">
              <button class="icon-btn" data-student-link="attendance" data-student-id="${s.id}">Attendance</button>
              <button class="icon-btn" data-student-link="fees" data-student-id="${s.id}">Fees</button>
              <button class="icon-btn" data-student-link="results" data-student-id="${s.id}">Results</button>
              <button class="icon-btn" data-invite="${s.id}">Login</button>
              <button class="icon-btn" data-edit="${s.id}">Edit</button>
              <button class="icon-btn danger" data-delete="${s.id}">Delete</button>
            </div>
          `
              : ""
          }
        </td>
      </tr>
    `,
      )
      .join("");
  }

  renderPagination(totalPages);

  tbody.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => openModal(btn.dataset.edit));
  });
  tbody.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", () => deleteStudent(btn.dataset.delete));
  });
  tbody.querySelectorAll("[data-invite]").forEach((btn) => {
    btn.addEventListener("click", () => openInviteModal(btn.dataset.invite));
  });
  tbody.querySelectorAll("[data-student-link]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const paths = {
        attendance: "../attendance/index.html",
        fees: "../fees/index.html",
        results: "../exams/index.html",
      };
      window.location.href = `${paths[btn.dataset.studentLink]}?studentId=${encodeURIComponent(btn.dataset.studentId)}`;
    });
  });
}

function renderPagination(totalPages) {
  const el = document.getElementById("pagination");
  let html = `<button id="prevPage" ${currentPage === 1 ? "disabled" : ""}>‹</button>`;
  for (let i = 1; i <= totalPages; i++) {
    html += `<button data-page="${i}" class="${i === currentPage ? "active-page" : ""}">${i}</button>`;
  }
  html += `<button id="nextPage" ${currentPage === totalPages ? "disabled" : ""}>›</button>`;
  el.innerHTML = html;

  el.querySelector("#prevPage").addEventListener("click", () => {
    currentPage--;
    renderTable();
  });
  el.querySelector("#nextPage").addEventListener("click", () => {
    currentPage++;
    renderTable();
  });
  el.querySelectorAll("[data-page]").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentPage = Number(btn.dataset.page);
      renderTable();
    });
  });
}

/* ---------- Modal / CRUD ---------- */
const overlay = document.getElementById("studentModalOverlay");
const form = document.getElementById("studentForm");

function openModal(id = null) {
  const record = id ? studentsState.find((s) => s.id === id) : null;
  document.getElementById("modalTitle").textContent = record
    ? "Edit Student"
    : "Add Student";
  document.getElementById("studentId").value = record?.id || "";
  document.getElementById("stuName").value = record?.name || "";
  document.getElementById("stuClass").value = record?.class || "";
  document.getElementById("stuDob").value = record?.dateOfBirth
    ? record.dateOfBirth.slice(0, 10)
    : "";
  document.getElementById("stuGuardianContact").value =
    record?.guardianContact || "";
  overlay.classList.add("is-open");
}

function closeModal() {
  overlay.classList.remove("is-open");
  form.reset();
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("studentId").value;
  const payload = {
    name: document.getElementById("stuName").value.trim(),
    class: document.getElementById("stuClass").value.trim(),
    dateOfBirth: document.getElementById("stuDob").value || null,
    guardianContact: document.getElementById("stuGuardianContact").value.trim(),
  };

  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = "Saving…";

  try {
    if (id) {
      await SmsAuth.apiFetch(`/students/${id}`, {
        method: "PATCH",
        body: payload,
      });
    } else {
      await SmsAuth.apiFetch("/students", { method: "POST", body: payload });
    }
    closeModal();
    await loadStudents();
  } catch (err) {
    SmsUI.toast(`Couldn't save student: ${err.message}`, "error");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Save";
  }
});

async function deleteStudent(id) {
  const student = studentsState.find((record) => record.id === id);
  const confirmed = await SmsUI.confirm(
    `This will permanently delete ${student?.name || "this student"} and remove the record from the roster. This cannot be undone.`,
    {
      title: "Delete student record?",
      confirmLabel: "Delete student",
      danger: true,
    },
  );
  if (!confirmed) return;
  try {
    await SmsAuth.apiFetch(`/students/${id}`, { method: "DELETE" });
    SmsUI.toast("Student record deleted.", "success");
    await loadStudents();
  } catch (err) {
    SmsUI.toast(`Couldn't delete student: ${err.message}`, "error");
  }
}

/* ---------- Invite code (student login) ---------- */
const inviteOverlay = document.getElementById("inviteModalOverlay");
let inviteStudentId = null;
let currentInvite = null; // { code, expiresAt } for whichever code is currently shown

function registerUrl() {
  return new URL("../register/index.html", window.location.href).href;
}

function inviteMessage(student) {
  const name = student ? student.name : "there";
  const expiry = currentInvite
    ? ` (valid until ${new Date(currentInvite.expiresAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })})`
    : "";
  return (
    `Hi ${name}, here's your student login code for the school portal: ${currentInvite?.code}${expiry}. ` +
    `Register at ${registerUrl()} using this code to set your own username and password.`
  );
}

function updateShareButtons() {
  const student = studentsState.find((s) => s.id === inviteStudentId);
  const emailBtn = document.getElementById("emailInviteBtn");
  const hasCode = !!currentInvite;

  document.getElementById("copyInviteBtn").disabled = !hasCode;
  document.getElementById("copyMessageBtn").disabled = !hasCode;

  const looksLikeEmail =
    student?.guardianContact && /\S+@\S+\.\S+/.test(student.guardianContact);
  if (hasCode && looksLikeEmail) {
    emailBtn.style.display = "";
    emailBtn.href =
      `mailto:${student.guardianContact}` +
      `?subject=${encodeURIComponent("Your student portal login code")}` +
      `&body=${encodeURIComponent(inviteMessage(student))}`;
  } else {
    emailBtn.style.display = "none";
  }
}

async function openInviteModal(studentId) {
  inviteStudentId = studentId;
  currentInvite = null;
  const student = studentsState.find((s) => s.id === studentId);
  document.getElementById("inviteModalSub").textContent = student
    ? student.name
    : "";
  document.getElementById("inviteCodeBox").textContent =
    "Checking for an existing code…";
  document.getElementById("inviteMeta").textContent = "";
  document.getElementById("generateInviteBtn").disabled = false;
  updateShareButtons();
  inviteOverlay.classList.add("is-open");

  try {
    const existing = await SmsAuth.apiFetch(
      `/invite-codes?studentId=${studentId}`,
    );
    const outstanding = existing.find(
      (c) => !c.used && new Date(c.expiresAt) > new Date(),
    );
    if (outstanding) {
      showInviteCode(outstanding);
    } else {
      document.getElementById("inviteCodeBox").textContent =
        "No active code yet.";
      document.getElementById("inviteMeta").textContent = "";
    }
  } catch (err) {
    document.getElementById("inviteCodeBox").textContent =
      "No active code yet.";
  }
}

function showInviteCode(invite) {
  currentInvite = invite;
  document.getElementById("inviteCodeBox").textContent = invite.code;
  document.getElementById("inviteMeta").textContent =
    `Expires ${new Date(invite.expiresAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} · single use`;
  updateShareButtons();
}

function closeInviteModal() {
  inviteOverlay.classList.remove("is-open");
  inviteStudentId = null;
  currentInvite = null;
}

document
  .getElementById("generateInviteBtn")
  .addEventListener("click", async () => {
    const btn = document.getElementById("generateInviteBtn");
    btn.disabled = true;
    btn.textContent = "Generating…";
    try {
      const invite = await SmsAuth.apiFetch("/invite-codes", {
        method: "POST",
        body: { role: "student", studentId: inviteStudentId },
      });
      showInviteCode(invite);
    } catch (err) {
      SmsUI.toast(`Couldn't generate a code: ${err.message}`, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Generate New Code";
    }
  });

document.getElementById("copyInviteBtn").addEventListener("click", () => {
  if (!currentInvite) return;
  navigator.clipboard?.writeText(currentInvite.code);
});

document.getElementById("copyMessageBtn").addEventListener("click", () => {
  if (!currentInvite) return;
  const student = studentsState.find((s) => s.id === inviteStudentId);
  navigator.clipboard?.writeText(inviteMessage(student));
});

document
  .getElementById("closeInviteModalBtn")
  .addEventListener("click", closeInviteModal);
inviteOverlay.addEventListener("click", (e) => {
  if (e.target === inviteOverlay) closeInviteModal();
});

/* ---------- Events ---------- */
document
  .getElementById("newStudentBtn")
  .addEventListener("click", () => openModal());
document.getElementById("cancelModalBtn").addEventListener("click", closeModal);
overlay.addEventListener("click", (e) => {
  if (e.target === overlay) closeModal();
});

document.getElementById("searchInput").addEventListener("input", (e) => {
  searchTerm = e.target.value;
  currentPage = 1;
  renderTable();
});

document.getElementById("classFilter").addEventListener("change", (e) => {
  classFilter = e.target.value;
  currentPage = 1;
  renderTable();
});

/* ---------- Init ---------- */
loadStudents().then(() => {
  if (new URLSearchParams(window.location.search).get("action") === "new") {
    openModal();
  }
});
