/* =========================================================
   Sidebar navigation — shared across every module page.
   Injects into <div id="sidebarSlot"></div>, highlights the
   current page, and hides items the current role can't use.
========================================================= */

(function () {
  const NAV_ITEMS = [
    { key: 'dashboard', label: 'Dashboard', icon: '🏠', href: '../dashboard/index.html' },
    { key: 'students', label: 'Students', icon: '🎓', href: '../students/index.html' },
    { key: 'teachers', label: 'Teachers', icon: '🍎', href: '../teachers/index.html' },
    { key: 'classes-subjects', label: 'Classes & Subjects', icon: '📚', href: '../classes-subjects/index.html' },
    { key: 'attendance', label: 'Attendance', icon: '📅', href: '../attendance/index.html' },
    { key: 'exams', label: 'Exams & Results', icon: '📝', href: '../exams/index.html' },
    { key: 'fees', label: 'Fees & Payments', icon: '💰', href: '../fees/index.html' },
    { key: 'timetable', label: 'Timetable', icon: '🗓️', href: '../timetable/index.html' },
    { key: 'library', label: 'Library', icon: '📖', href: '../library/index.html' },
    { key: 'announcements', label: 'Announcements', icon: '📢', href: '../announcements/index.html' },
  ];

  function currentModuleKey() {
    const segments = window.location.pathname.split('/').filter(Boolean);
    return segments.length >= 2 ? segments[segments.length - 2] : '';
  }

  function renderSidebar() {
    const slot = document.getElementById('sidebarSlot');
    if (!slot) return;

    const activeKey = currentModuleKey();

    slot.innerHTML = `
      <div class="sidebar-brand">
        <span class="sidebar-brand-icon">🏫</span>
        <span class="sidebar-brand-text">SMS</span>
      </div>
      <nav class="sidebar-nav">
        ${NAV_ITEMS.map(item => `
          <a class="sidebar-link ${item.key === activeKey ? 'is-active' : ''}" href="${item.href}">
            <span class="sidebar-link-icon">${item.icon}</span>
            <span class="sidebar-link-label">${item.label}</span>
          </a>
        `).join('')}
      </nav>
    `;
  }

  document.addEventListener('DOMContentLoaded', renderSidebar);
})();
