const form = document.getElementById("forgotPasswordForm");
const status = document.getElementById("requestStatus");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  status.hidden = true;
  try {
    const response = await SmsAuth.request("/auth/forgot-password", {
      method: "POST",
      body: { email: document.getElementById("email").value.trim() },
    });
    status.replaceChildren(document.createTextNode(response.message));
    if (response.token) {
      const link = document.createElement("a");
      link.href = `../reset-password/index.html?token=${encodeURIComponent(response.token)}`;
      link.textContent = "Open password reset";
      status.append(document.createElement("br"), link);
    }
    status.hidden = false;
  } catch (error) {
    status.textContent = error.message;
    status.hidden = false;
  } finally {
    submit.disabled = false;
  }
});
