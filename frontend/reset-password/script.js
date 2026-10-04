const form = document.getElementById("resetPasswordForm");
const status = document.getElementById("resetStatus");
const resetToken = new URLSearchParams(window.location.search).get("token");

if (!resetToken) {
  status.textContent = "This password reset link is invalid or incomplete.";
  status.hidden = false;
  form.hidden = true;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  status.hidden = true;
  try {
    const response = await SmsAuth.request("/auth/reset-password", {
      method: "POST",
      body: {
        token: resetToken,
        password: document.getElementById("password").value,
      },
    });
    form.hidden = true;
    status.textContent = response.message;
    status.hidden = false;
  } catch (error) {
    status.textContent = error.message;
    status.hidden = false;
    submit.disabled = false;
  }
});
