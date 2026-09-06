/* =========================================================
   Auth guard — include this on every protected page, AFTER
   auth-client.js and AFTER theme.css, but BEFORE your module's
   own script.js. It:
     1. Redirects to login if there's no valid session
     2. Injects an avatar + dropdown menu (name, email, role,
        logout) into any element with id="userBadgeSlot"
     3. Hides any element with [data-requires-role] if the
        current user's role isn't in the allowed list
========================================================= */

(function () {
  if (!SmsAuth.isLoggedIn()) {
    window.location.href = '../login/index.html';
    return;
  }

  function getInitials(name) {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    const first = parts[0]?.[0] || '';
    const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return (first + last).toUpperCase();
  }

  document.addEventListener('DOMContentLoaded', () => {
    const user = SmsAuth.getUser();
    const slot = document.getElementById('userBadgeSlot');

    if (slot && user) {
      slot.innerHTML = `
        <div class="avatar-menu">
          <button class="avatar-trigger" id="avatarTrigger" aria-haspopup="true" aria-expanded="false">
            <span class="avatar-circle">${getInitials(user.name)}</span>
          </button>
          <div class="avatar-dropdown" id="avatarDropdown">
            <div class="avatar-dropdown-header">
              <span class="avatar-circle avatar-circle--lg">${getInitials(user.name)}</span>
              <div>
                <div class="avatar-dropdown-name">${user.name}</div>
                <div class="avatar-dropdown-email">${user.email || ''}</div>
              </div>
            </div>
            <div class="avatar-dropdown-role">
              <span class="user-badge-role">${user.role}</span>
            </div>
            <button class="avatar-dropdown-logout" id="logoutBtn">Log out</button>
          </div>
        </div>
      `;

      const trigger = document.getElementById('avatarTrigger');
      const dropdown = document.getElementById('avatarDropdown');

      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = dropdown.classList.toggle('is-open');
        trigger.setAttribute('aria-expanded', String(isOpen));
      });

      document.addEventListener('click', (e) => {
        if (!slot.contains(e.target)) {
          dropdown.classList.remove('is-open');
          trigger.setAttribute('aria-expanded', 'false');
        }
      });

      document.getElementById('logoutBtn').addEventListener('click', () => SmsAuth.logout());
    }

    // Role-gated UI: hide anything the current role isn't allowed to see/use
    document.querySelectorAll('[data-requires-role]').forEach(el => {
      const allowed = el.dataset.requiresRole.split(',').map(r => r.trim());
      if (!allowed.includes(user.role)) {
        el.style.display = 'none';
      }
    });
  });
})();
