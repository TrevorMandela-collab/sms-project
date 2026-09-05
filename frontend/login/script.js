/* =========================================================
   Login page logic.
   - Normal sign-in posts to /api/auth/login.
   - If no accounts exist yet, the "Set up the admin account"
     link switches to a registration form that becomes the
     bootstrap admin (see backend/routes/auth.js).
========================================================= */

const loginForm = document.getElementById('loginForm');
const bootstrapForm = document.getElementById('bootstrapForm');
const errorBanner = document.getElementById('errorBanner');
const modeSubtitle = document.getElementById('modeSubtitle');
const loginFootnote = document.getElementById('loginFootnote');
const showBootstrapBtn = document.getElementById('showBootstrapBtn');

// If already logged in, skip straight to the dashboard.
if (SmsAuth.isLoggedIn()) {
  window.location.href = '../dashboard/index.html';
}

function showError(message) {
  errorBanner.textContent = message;
  errorBanner.style.display = 'block';
}

function clearError() {
  errorBanner.style.display = 'none';
}

showBootstrapBtn.addEventListener('click', () => {
  loginForm.style.display = 'none';
  bootstrapForm.style.display = 'block';
  loginFootnote.style.display = 'none';
  modeSubtitle.textContent = 'Create the first admin account';
  clearError();
});

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError();
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;

  try {
    await SmsAuth.login(email, password);
    window.location.href = '../dashboard/index.html';
  } catch (err) {
    showError(err.message);
  }
});

bootstrapForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError();
  const name = document.getElementById('bootName').value.trim();
  const email = document.getElementById('bootEmail').value.trim();
  const password = document.getElementById('bootPassword').value;

  try {
    const result = await SmsAuth.register({ name, email, password, role: 'admin' });
    if (!result.isFirstAdmin) {
      showError('An admin account already exists. Please sign in instead.');
      return;
    }
    window.location.href = '../dashboard/index.html';
  } catch (err) {
    showError(err.message);
  }
});
