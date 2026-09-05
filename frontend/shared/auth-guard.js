/* =========================================================
   Auth guard — include this on every protected page, AFTER
   auth-client.js and AFTER theme.css, but BEFORE your module's
   own script.js. It:
     1. Redirects to login if there's no valid session
     2. Injects a "Signed in as X (role)" badge + logout button
        into any element with id="userBadgeSlot"
     3. Hides any element with [data-requires-role] if the
        current user's role isn't in the allowed list
========================================================= */

(function () {
  if (!SmsAuth.isLoggedIn()) {
    window.location.href = '../login/index.html';
    return;
  }

  document.addEventListener('DOMContentLoaded', () => {
    const user = SmsAuth.getUser();
    const slot = document.getElementById('userBadgeSlot');

    if (slot && user) {
      slot.innerHTML = `
        <div class="user-badge">
          <span class="user-badge-name">${user.name}</span>
          <span class="user-badge-role">${user.role}</span>
          <button class="user-badge-logout" id="logoutBtn">Log out</button>
        </div>
      `;
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
