/* Shared Mandela SMS navigation for authenticated module pages. */
(function () {
  const sidebarScriptUrl = document.currentScript && document.currentScript.src;
  const embeddedMode =
    new URLSearchParams(window.location.search).get("qaEmbed") === "1";
  if (embeddedMode) {
    document.documentElement.classList.add("qa-embedded-page");
  }
  const NAV_GROUPS = [
    {
      label: "Platform",
      items: [
        {
          key: "platform",
          label: "Platform overview",
          icon: "◈",
          href: "../platform/index.html",
          roles: ["super_admin"],
        },
      ],
    },
    {
      label: "Overview",
      items: [
        {
          key: "dashboard",
          label: "Dashboard",
          icon: "⌂",
          href: "../dashboard/index.html",
          roles: ["admin", "teacher", "school_admin"],
        },
        {
          key: "student-portal",
          label: "My Portal",
          icon: "◈",
          href: "../student-portal/index.html",
          roles: ["student"],
        },
        {
          key: "parent-portal",
          label: "My Portal",
          icon: "◈",
          href: "../parent-portal/index.html",
          roles: ["parent"],
        },
      ],
    },
    {
      label: "People",
      items: [
        {
          key: "students",
          label: "Students",
          icon: "◉",
          href: "../students/index.html",
          roles: ["admin", "teacher"],
        },
        {
          key: "teachers",
          label: "Teachers",
          icon: "♙",
          href: "../teachers/index.html",
          roles: ["admin"],
        },
        {
          key: "manage-logins",
          label: "Users & Roles",
          icon: "⚿",
          href: "../manage-logins/index.html",
          roles: ["admin"],
        },
        {
          key: "audit-logs",
          label: "Audit Logs",
          icon: "≋",
          href: "../audit-logs/index.html",
          roles: ["admin"],
        },
      ],
    },
    {
      label: "Academics",
      items: [
        {
          key: "classes-subjects",
          label: "Classes & Subjects",
          icon: "▤",
          href: "../classes-subjects/index.html",
          roles: ["admin"],
        },
        {
          key: "assignments",
          label: "Assignments",
          icon: "☷",
          href: "../assignments/index.html",
          roles: ["admin", "teacher"],
        },
        {
          key: "exams",
          label: "Exams & Results",
          icon: "◇",
          href: "../exams/index.html",
          roles: ["admin", "teacher"],
        },
        {
          key: "timetable",
          label: "Timetable",
          icon: "▦",
          href: "../timetable/index.html",
          roles: ["admin", "teacher"],
        },
        {
          key: "events",
          label: "Events",
          icon: "◷",
          href: "../events/index.html",
          roles: ["admin", "teacher"],
        },
        {
          key: "teacher-portal",
          label: "My Classes",
          icon: "♧",
          href: "../teacher-portal/index.html",
          roles: ["teacher"],
        },
      ],
    },
    {
      label: "Operations",
      items: [
        {
          key: "attendance",
          label: "Attendance",
          icon: "✓",
          href: "../attendance/index.html",
          roles: ["admin", "teacher"],
        },
        {
          key: "fees",
          label: "Fees & Finance",
          icon: "₵",
          href: "../fees/index.html",
          roles: ["admin", "teacher"],
        },
        {
          key: "library",
          label: "Library",
          icon: "▥",
          href: "../library/index.html",
          roles: ["admin"],
        },
      ],
    },
    {
      label: "Communication",
      items: [
        {
          key: "announcements",
          label: "Announcements",
          icon: "◌",
          href: "../announcements/index.html",
          roles: ["admin"],
        },
        {
          key: "chats",
          label: "Messages",
          icon: "◍",
          href: "../chats/index.html",
          roles: ["admin", "teacher", "parent", "student"],
        },
      ],
    },
  ];

  function currentModuleKey() {
    const segments = window.location.pathname.split("/").filter(Boolean);
    if (segments.at(-1) === "index.html") segments.pop();
    return segments.at(-1) || "";
  }

  function getInitials(name) {
    return (name || "Admin")
      .split(/\s+/)
      .map((part) => part[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();
  }

  function renderSidebar() {
    const slot = document.getElementById("sidebarSlot");
    if (!slot) return;
    const activeKey = currentModuleKey();
    const user = SmsAuth.getUser() || {};
    const name =
      typeof user.name === "string" && user.name.trim()
        ? user.name.trim()
        : "Admin";
    const role =
      typeof user.role === "string" && user.role.trim()
        ? user.role.trim()
        : "Administrator";
    const groups = NAV_GROUPS.map((group) => {
      const navRole = user.role === "school_admin" ? "admin" : user.role;
      const items = group.items.filter(
        (item) => !item.roles || item.roles.includes(navRole),
      );
      if (!items.length) return "";
      const hasActiveItem = items.some((item) => item.key === activeKey);
      return `<div class="sidebar-group${hasActiveItem ? " has-active" : ""}" role="group" aria-label="${group.label}"><span class="sidebar-group-label">${group.label}</span>${items
        .map(
          (item) => `
        <a class="sidebar-link ${item.key === activeKey ? "is-active" : ""}" href="${item.href}" title="${item.label}" aria-label="${item.label}"${item.key === activeKey ? ' aria-current="page"' : ""}>
          <span class="sidebar-link-icon" aria-hidden="true">${item.icon}</span><span class="sidebar-link-label">${item.label}</span>
        </a>`,
        )
        .join("")}</div>`;
    }).join("");

    slot.innerHTML = `
      <div class="sidebar-brand">
        <button class="sidebar-account-trigger" id="sidebarAccountTrigger" type="button" aria-haspopup="true" aria-expanded="false" aria-controls="sidebarAccountMenu"><span class="sidebar-brand-icon">M</span>
        <span class="sidebar-brand-text">Mandela</span></button><div class="sidebar-account-menu" id="sidebarAccountMenu" hidden><div class="sidebar-account-info"><strong id="sidebarAccountName"></strong><small id="sidebarAccountRole"></small></div><a class="sidebar-account-settings" href="../settings/index.html">Account settings</a><button type="button" class="sidebar-account-logout" id="sidebarLogoutBtn">Log out</button></div>
        <button class="sidebar-collapse" id="sharedSidebarCollapse" type="button" aria-label="Collapse navigation" aria-controls="sidebarSlot" aria-expanded="true" title="Collapse navigation">←</button>
      </div>
      <nav class="sidebar-nav" aria-label="Primary navigation">${groups}</nav>
      `;

    const collapseButton = document.getElementById("sharedSidebarCollapse");

    const accountTrigger = document.getElementById("sidebarAccountTrigger");
    const accountMenu = document.getElementById("sidebarAccountMenu");
    document.getElementById("sidebarAccountName").textContent = name;
    document.getElementById("sidebarAccountRole").textContent = role;
    function setAccountMenu(open) {
      accountMenu.hidden = !open;
      accountTrigger.setAttribute("aria-expanded", String(open));
    }
    accountTrigger.addEventListener("click", (event) => {
      event.stopPropagation();
      setAccountMenu(accountMenu.hidden);
    });
    document.addEventListener("click", (event) => {
      if (!accountMenu.hidden && !accountMenu.contains(event.target)) {
        setAccountMenu(false);
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !accountMenu.hidden) {
        setAccountMenu(false);
        accountTrigger.focus();
      }
    });
    document.getElementById("sidebarLogoutBtn").addEventListener("click", () => SmsAuth.logout());
    const mobileMenu =
      document.getElementById("mobileMenu") || createMobileMenu(slot);
    const backdrop = createBackdrop();
    const main = slot.parentElement.querySelector(".app-main, .dashboard-main");
    const mobileQuery = window.matchMedia("(max-width: 860px)");
    const saved = localStorage.getItem("sms_sidebar_collapsed") === "true";
    let collapsed = saved;

    function syncDesktopState() {
      if (mobileQuery.matches) {
        slot.classList.remove("is-collapsed");
        return;
      }
      slot.inert = false;
      slot.setAttribute("aria-hidden", "false");
      slot.classList.toggle("is-collapsed", collapsed);
      collapseButton.textContent = collapsed ? "→" : "←";
      collapseButton.setAttribute("aria-expanded", String(!collapsed));
      collapseButton.setAttribute(
        "aria-label",
        collapsed ? "Expand navigation" : "Collapse navigation",
      );
      collapseButton.title = collapsed
        ? "Expand navigation"
        : "Collapse navigation";
    }

    function closeMobileDrawer({ returnFocus = false } = {}) {
      slot.classList.remove("is-mobile-open");
      document.body.classList.remove("sidebar-drawer-open");
      slot.setAttribute("aria-hidden", "true");
      slot.inert = true;
      if (main) main.inert = false;
      mobileMenu.setAttribute("aria-expanded", "false");
      mobileMenu.setAttribute("aria-label", "Open navigation");
      collapseButton.setAttribute("aria-expanded", "false");
      collapseButton.setAttribute("aria-label", "Open navigation");
      collapseButton.title = "Open navigation";
      backdrop.hidden = true;
      if (returnFocus && mobileQuery.matches) mobileMenu.focus();
    }

    function openMobileDrawer() {
      if (!mobileQuery.matches) return;
      slot.classList.remove("is-collapsed");
      slot.classList.add("is-mobile-open");
      document.body.classList.add("sidebar-drawer-open");
      slot.setAttribute("aria-hidden", "false");
      slot.inert = false;
      if (main) main.inert = true;
      mobileMenu.setAttribute("aria-expanded", "true");
      mobileMenu.setAttribute("aria-label", "Close navigation");
      collapseButton.setAttribute("aria-expanded", "true");
      collapseButton.setAttribute("aria-label", "Close navigation");
      collapseButton.title = "Close navigation";
      backdrop.hidden = false;
      slot.getBoundingClientRect();
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (
            slot.classList.contains("is-mobile-open") &&
            getComputedStyle(collapseButton).visibility === "visible"
          ) {
            collapseButton.focus({ preventScroll: true });
          }
        });
      });
    }

    function handleViewportChange() {
      if (!mobileQuery.matches || !slot.classList.contains("is-mobile-open")) {
        closeMobileDrawer();
      }
      syncDesktopState();
    }

    collapseButton.addEventListener("click", () => {
      if (mobileQuery.matches) {
        closeMobileDrawer({ returnFocus: true });
        return;
      }
      collapsed = !collapsed;
      localStorage.setItem("sms_sidebar_collapsed", String(collapsed));
      syncDesktopState();
    });

    mobileMenu.setAttribute("aria-controls", "sidebarSlot");
    mobileMenu.setAttribute("aria-expanded", "false");
    mobileMenu.setAttribute("aria-label", "Open navigation");
    mobileMenu.addEventListener("click", openMobileDrawer);
    backdrop.addEventListener("click", () =>
      closeMobileDrawer({ returnFocus: true }),
    );
    slot.querySelectorAll(".sidebar-link").forEach((link) => {
      link.addEventListener("click", () => closeMobileDrawer());
    });

    document.addEventListener("keydown", (event) => {
      if (!mobileQuery.matches || !slot.classList.contains("is-mobile-open"))
        return;
      if (event.key === "Escape") {
        closeMobileDrawer({ returnFocus: true });
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = [
        ...slot.querySelectorAll(
          'a[href]:not([tabindex="-1"]), button:not([disabled]):not([tabindex="-1"])',
        ),
      ].filter((element) => element.getClientRects().length > 0);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });

    mobileQuery.addEventListener("change", handleViewportChange);
    window.addEventListener("resize", handleViewportChange);
    if (mobileQuery.matches) {
      closeMobileDrawer();
    } else {
      syncDesktopState();
    }
  }

  function createMobileMenu(slot) {
    const main = slot.parentElement.querySelector(".app-main");
    if (!main) return null;
    const button = document.createElement("button");
    button.className = "sidebar-mobile-toggle";
    button.id = "sharedSidebarMobileMenu";
    button.type = "button";
    button.textContent = "☰";
    button.setAttribute("aria-label", "Open navigation");
    main.insertBefore(button, main.firstChild);
    return button;
  }

  function createBackdrop() {
    let backdrop = document.getElementById("sidebarBackdrop");
    if (backdrop) return backdrop;
    backdrop = document.createElement("button");
    backdrop.className = "sidebar-backdrop";
    backdrop.id = "sidebarBackdrop";
    backdrop.type = "button";
    backdrop.setAttribute("aria-label", "Close navigation");
    backdrop.tabIndex = -1;
    backdrop.hidden = true;
    document.body.appendChild(backdrop);
    return backdrop;
  }

  function loadDevelopmentStrip() {
    if (!sidebarScriptUrl || document.getElementById("mandelaDevStripScript")) return;
    const script = document.createElement("script");
    script.id = "mandelaDevStripScript";
    script.src = new URL("./dev-strip.js", sidebarScriptUrl).href;
    document.head.appendChild(script);
  }

  function loadCommandPalette() {
    if (!sidebarScriptUrl || document.getElementById("mandelaCommandPaletteScript")) return;
    const button = document.createElement("button");
    button.className = "sidebar-command-trigger";
    button.id = "mandelaCommandTrigger";
    button.type = "button";
    button.setAttribute("aria-label", "Search and commands, Control K");
    button.innerHTML = '<span aria-hidden="true">⌕</span><span class="sidebar-command-label">Search</span><kbd>Ctrl K</kbd>';
    const brand = document.querySelector(".sidebar-brand");
    const collapse = document.getElementById("sharedSidebarCollapse");
    if (brand && collapse) brand.insertBefore(button, collapse);

    const script = document.createElement("script");
    script.id = "mandelaCommandPaletteScript";
    script.src = new URL("./command-palette.js", sidebarScriptUrl).href;
    document.head.appendChild(script);
  }

  function initializeSharedComponents() {
    if (embeddedMode) return;
    renderSidebar();
    loadDevelopmentStrip();
    loadCommandPalette();
  }

  document.addEventListener("DOMContentLoaded", initializeSharedComponents, {
    once: true,
  });
})();
