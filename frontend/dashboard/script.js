const searchIndex = [
  { label: "Brian Kamau", type: "Student", href: "../students/index.html" },
  { label: "Aisha Mwangi", type: "Student", href: "../students/index.html" },
  { label: "Mr. Otieno", type: "Teacher", href: "../teachers/index.html" },
  { label: "Outstanding fees", type: "Finance", href: "../fees/index.html" },
  {
    label: "Mathematics results",
    type: "Results",
    href: "../exams/index.html",
  },
  {
    label: "Sports Day Schedule",
    type: "Announcement",
    href: "../announcements/index.html",
  },
];

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

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
  const initials = name
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  ["#greetingName", "#topName", "#sidebarName"].forEach((selector) => {
    const element = $(selector);
    if (element)
      element.textContent = selector === "#greetingName" ? firstName : name;
  });
  ["#topAvatar", "#sidebarAvatar"].forEach((selector) => {
    const element = $(selector);
    if (element) element.textContent = initials || "AD";
  });
}

function setupSidebar() {
  const sidebar = $("#commandSidebar");
  $("#sidebarCollapse").addEventListener("click", () => {
    const collapsed = sidebar.classList.toggle("is-collapsed");
    $("#sidebarCollapse").textContent = collapsed ? "→" : "←";
    $("#sidebarCollapse").setAttribute("aria-expanded", String(!collapsed));
  });
  $("#mobileMenu").addEventListener("click", () =>
    sidebar.classList.add("is-mobile-open"),
  );
  document.addEventListener("click", (event) => {
    if (
      window.innerWidth <= 860 &&
      sidebar.classList.contains("is-mobile-open") &&
      !sidebar.contains(event.target) &&
      event.target.id !== "mobileMenu"
    ) {
      sidebar.classList.remove("is-mobile-open");
    }
  });
}

function setupActions() {
  $$("[data-href], [data-toast]").forEach((button) =>
    button.addEventListener("click", () => navigate(button)),
  );
  $$("[data-notification]").forEach((item) =>
    item.addEventListener("click", () => item.classList.add("is-read")),
  );
  $("#markRead").addEventListener("click", () => {
    $$("[data-notification]").forEach((item) => item.classList.add("is-read"));
    showToast("All notifications marked as read");
  });
}

function setupMenus() {
  const profileMenu = $("#profileMenu");
  $("#topProfile").addEventListener("click", (event) => {
    event.stopPropagation();
    profileMenu.classList.toggle("is-open");
    $("#notificationPanel").classList.remove("is-open");
  });
  $("#sidebarProfileButton").addEventListener("click", () =>
    profileMenu.classList.toggle("is-open"),
  );
  $("#topLogout").addEventListener("click", () => {
    if (typeof SmsAuth !== "undefined") SmsAuth.logout();
  });
  document.addEventListener("click", (event) => {
    if (
      !profileMenu.contains(event.target) &&
      event.target.id !== "topProfile" &&
      event.target.id !== "sidebarProfileButton"
    )
      profileMenu.classList.remove("is-open");
  });
  $("#notificationButton").addEventListener("click", (event) => {
    event.stopPropagation();
    $("#notificationPanel").classList.toggle("is-open");
    profileMenu.classList.remove("is-open");
  });
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
    const matches = searchIndex.filter((item) =>
      `${item.label} ${item.type}`.toLowerCase().includes(term),
    );
    results.innerHTML = matches.length
      ? matches
          .map(
            (item) =>
              `<button type="button" data-search-href="${item.href}"><strong>${item.label}</strong><small> · ${item.type}</small></button>`,
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

function chartDefaults() {
  Chart.defaults.font.family = "DM Sans, sans-serif";
  Chart.defaults.font.size = 10;
  Chart.defaults.color = "#71808f";
  Chart.defaults.animation.duration = 500;
}

function renderCharts() {
  chartDefaults();
  const grid = "rgba(113,128,143,.12)";
  new Chart($("#attendanceTrendChart"), {
    type: "line",
    data: {
      labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Today"],
      datasets: [
        {
          data: [91, 94, 92, 95, 93, 94],
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
          min: 86,
          max: 100,
          ticks: { callback: (value) => `${value}%`, maxTicksLimit: 4 },
          grid: { color: grid },
          border: { display: false },
        },
      },
    },
  });
  new Chart($("#performanceChart"), {
    type: "bar",
    data: {
      labels: ["Math", "English", "Science", "Social"],
      datasets: [
        {
          data: [74, 71, 69, 66],
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
          min: 50,
          max: 80,
          ticks: { callback: (value) => `${value}%`, maxTicksLimit: 3 },
          grid: { color: grid },
          border: { display: false },
        },
      },
    },
  });
  new Chart($("#financeChart"), {
    type: "line",
    data: {
      labels: ["May", "Jun", "Jul", "Aug", "Sep"],
      datasets: [
        {
          data: [42, 54, 61, 70, 78],
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
          callbacks: { label: (context) => `${context.parsed.y}% collected` },
        },
      },
      scales: {
        x: { grid: { display: false }, border: { display: false } },
        y: {
          min: 30,
          max: 90,
          ticks: { callback: (value) => `${value}%`, maxTicksLimit: 3 },
          grid: { color: grid },
          border: { display: false },
        },
      },
    },
  });
}

function init() {
  setUserProfile();
  setupSidebar();
  setupActions();
  setupMenus();
  setupSearch();
  renderCharts();
}

document.addEventListener("DOMContentLoaded", init);
