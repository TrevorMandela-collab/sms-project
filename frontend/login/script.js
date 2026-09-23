/* =========================================================
   Login page logic.
   - Normal sign-in posts to /api/auth/login.
   - If no accounts exist yet, the "Set up the admin account"
     link switches to a registration form that becomes the
     bootstrap admin (see backend/routes/auth.js).
========================================================= */

const loginForm = document.getElementById("loginForm");
const bootstrapForm = document.getElementById("bootstrapForm");
const errorBanner = document.getElementById("errorBanner");
const modeSubtitle = document.getElementById("modeSubtitle");
const loginFootnote = document.getElementById("loginFootnote");
const showBootstrapBtn = document.getElementById("showBootstrapBtn");

// If already logged in, skip straight to the right home page for the role.
if (SmsAuth.isLoggedIn()) {
  window.location.href = SmsAuth.homeUrlForRole(SmsAuth.getUser()?.role);
}

function showError(message) {
  errorBanner.textContent = message;
  errorBanner.style.display = "block";
}

function clearError() {
  errorBanner.style.display = "none";
}

showBootstrapBtn.addEventListener("click", () => {
  loginForm.style.display = "none";
  bootstrapForm.style.display = "block";
  loginFootnote.style.display = "none";
  modeSubtitle.textContent = "Create the first admin account";
  clearError();
});

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearError();
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;

  try {
    const user = await SmsAuth.login(email, password);
    window.location.href = SmsAuth.homeUrlForRole(user.role);
  } catch (err) {
    showError(err.message);
  }
});

bootstrapForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearError();
  const schoolName = document.getElementById("bootSchoolName").value.trim();
  const name = document.getElementById("bootName").value.trim();
  const email = document.getElementById("bootEmail").value.trim();
  const password = document.getElementById("bootPassword").value;

  try {
    const result = await SmsAuth.register({
      name,
      email,
      password,
      role: "admin",
      schoolName,
    });
    if (!result.isFirstAdmin) {
      showError("An admin account already exists. Please sign in instead.");
      return;
    }
    window.location.href = "../dashboard/index.html";
  } catch (err) {
    showError(err.message);
  }
});
