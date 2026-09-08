/* =========================================================
   Sidebar navigation — shared across every module page.
   Injects into <div id="sidebarSlot"></div>, highlights the
   current page, and hides items the current role can't use.
========================================================= */

(function () {
  // `roles` restricts a nav item to specific roles; omit it for
  // items every role should see. Admin/teacher keep the full
  // management nav; parent/student get a single link to their
  // own read-only portal (which itself contains all their views).
  const NAV_ITEMS = [
    { key: 'dashboard', label: 'Dashboard', icon: '🏠', href: '../dashboard/index.html', roles: ['admin', 'teacher'] },
    { key: 'student-portal', label: 'My Portal', icon: '🎒', href: '../student-portal/index.html', roles: ['student'] },
    { key: 'parent-portal', label: 'My Portal', icon: '🎒', href: '../parent-portal/index.html', roles: ['parent'] },
    { key: 'students', label: 'Students', icon: '🎓', href: '../students/index.html', roles: ['admin', 'teacher'] },
    { key: 'teachers', label: 'Teachers', icon: '🍎', href: '../teachers/index.html', roles: ['admin', 'teacher'] },
    { key: 'manage-logins', label: 'Manage Logins', icon: '🔑', href: '../manage-logins/index.html', roles: ['admin'] },
    { key: 'chats', label: 'Chats', icon: '💬', href: '../chats/index.html', roles: ['admin', 'teacher', 'parent', 'student'] },
    { key: 'classes-subjects', label: 'Classes & Subjects', icon: '📚', href: '../classes-subjects/index.html', roles: ['admin', 'teacher'] },
    { key: 'assignments', label: 'Assignments', icon: '📋', href: '../assignments/index.html', roles: ['admin', 'teacher'] },
    { key: 'attendance', label: 'Attendance', icon: '📅', href: '../attendance/index.html', roles: ['admin', 'teacher'] },
    { key: 'exams', label: 'Exams & Results', icon: '📝', href: '../exams/index.html', roles: ['admin', 'teacher'] },
    { key: 'fees', label: 'Fees & Payments', icon: '💰', href: '../fees/index.html', roles: ['admin', 'teacher'] },
    { key: 'timetable', label: 'Timetable', icon: '🗓️', href: '../timetable/index.html', roles: ['admin', 'teacher'] },
    { key: 'library', label: 'Library', icon: '📖', href: '../library/index.html', roles: ['admin', 'teacher'] },
    { key: 'announcements', label: 'Announcements', icon: '📢', href: '../announcements/index.html', roles: ['admin', 'teacher'] },
  ];

  function currentModuleKey() {
    const segments = window.location.pathname.split('/').filter(Boolean);
    return segments.length >= 2 ? segments[segments.length - 2] : '';
  }

  function renderSidebar() {
    const slot = document.getElementById('sidebarSlot');
    if (!slot) return;

    const activeKey = currentModuleKey();
    const user = SmsAuth.getUser();
    const items = NAV_ITEMS.filter(item => !item.roles || (user && item.roles.includes(user.role)));

    slot.innerHTML = `
      <div class="sidebar-brand">
        <span class="sidebar-brand-icon">🏫</span>
        <span class="sidebar-brand-text">SMS</span>
      </div>
      <nav class="sidebar-nav">
        ${items.map(item => `
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
