/* Shared Mandela SMS navigation for authenticated module pages. */
(function () {
  const NAV_GROUPS = [
    {
      label: 'Overview',
      items: [
        { key: 'dashboard', label: 'Dashboard', icon: '⌂', href: '../dashboard/index.html', roles: ['admin', 'teacher'] },
        { key: 'student-portal', label: 'My Portal', icon: '◈', href: '../student-portal/index.html', roles: ['student'] },
        { key: 'parent-portal', label: 'My Portal', icon: '◈', href: '../parent-portal/index.html', roles: ['parent'] },
      ],
    },
    {
      label: 'People',
      items: [
        { key: 'students', label: 'Students', icon: '◉', href: '../students/index.html', roles: ['admin', 'teacher'] },
        { key: 'teachers', label: 'Teachers', icon: '♙', href: '../teachers/index.html', roles: ['admin'] },
        { key: 'manage-logins', label: 'Users & Roles', icon: '⚿', href: '../manage-logins/index.html', roles: ['admin'] },
      ],
    },
    {
      label: 'Academics',
      items: [
        { key: 'classes-subjects', label: 'Classes & Subjects', icon: '▤', href: '../classes-subjects/index.html', roles: ['admin'] },
        { key: 'assignments', label: 'Assignments', icon: '☷', href: '../assignments/index.html', roles: ['admin', 'teacher'] },
        { key: 'exams', label: 'Exams & Results', icon: '◇', href: '../exams/index.html', roles: ['admin', 'teacher'] },
        { key: 'timetable', label: 'Timetable', icon: '▦', href: '../timetable/index.html', roles: ['admin', 'teacher'] },
        { key: 'teacher-portal', label: 'My Classes', icon: '♧', href: '../teacher-portal/index.html', roles: ['teacher'] },
      ],
    },
    {
      label: 'Operations',
      items: [
        { key: 'attendance', label: 'Attendance', icon: '✓', href: '../attendance/index.html', roles: ['admin', 'teacher'] },
        { key: 'fees', label: 'Fees & Finance', icon: '₵', href: '../fees/index.html', roles: ['admin', 'teacher'] },
        { key: 'library', label: 'Library', icon: '▥', href: '../library/index.html', roles: ['admin'] },
      ],
    },
    {
      label: 'Communication',
      items: [
        { key: 'announcements', label: 'Announcements', icon: '◌', href: '../announcements/index.html', roles: ['admin'] },
        { key: 'chats', label: 'Messages', icon: '◍', href: '../chats/index.html', roles: ['admin', 'teacher', 'parent', 'student'] },
      ],
    },
  ];

  function currentModuleKey() {
    const segments = window.location.pathname.split('/').filter(Boolean);
    return segments.length >= 2 ? segments[segments.length - 2] : '';
  }

  function getInitials(name) {
    return (name || 'Admin').split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase();
  }

  function renderSidebar() {
    const slot = document.getElementById('sidebarSlot');
    if (!slot) return;
    const activeKey = currentModuleKey();
    const user = SmsAuth.getUser() || {};
    const groups = NAV_GROUPS.map(group => {
      const items = group.items.filter(item => !item.roles || item.roles.includes(user.role));
      if (!items.length) return '';
      return `<div class="sidebar-group"><span class="sidebar-group-label">${group.label}</span>${items.map(item => `
        <a class="sidebar-link ${item.key === activeKey ? 'is-active' : ''}" href="${item.href}" title="${item.label}">
          <span class="sidebar-link-icon">${item.icon}</span><span class="sidebar-link-label">${item.label}</span>
        </a>`).join('')}</div>`;
    }).join('');

    slot.innerHTML = `
      <div class="sidebar-brand">
        <span class="sidebar-brand-icon">M</span>
        <span class="sidebar-brand-text">Mandela</span>
        <button class="sidebar-collapse" id="sharedSidebarCollapse" type="button" aria-label="Collapse sidebar" aria-expanded="true">←</button>
      </div>
      <nav class="sidebar-nav">${groups}</nav>
      <div class="sidebar-profile">
        <span class="profile-avatar">${getInitials(user.name)}</span>
        <span class="profile-copy"><strong>${user.name || 'Admin'}</strong><small>${user.role || 'Administrator'}</small></span>
        <button class="profile-more" type="button" aria-label="Account menu">•••</button>
      </div>`;

    const collapseButton = document.getElementById('sharedSidebarCollapse');
    const saved = localStorage.getItem('sms_sidebar_collapsed') === 'true';
    if (saved) slot.classList.add('is-collapsed');
    collapseButton.addEventListener('click', () => {
      const collapsed = slot.classList.toggle('is-collapsed');
      localStorage.setItem('sms_sidebar_collapsed', String(collapsed));
      collapseButton.textContent = collapsed ? '→' : '←';
      collapseButton.setAttribute('aria-expanded', String(!collapsed));
    });
  }

  document.addEventListener('DOMContentLoaded', renderSidebar);
})();
