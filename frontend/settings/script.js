const settingsElement = (id) => document.getElementById(id);
const currentSettingsUser = SmsAuth.getUser() || {};

function reportSettingsError(error) {
  const errorBox = settingsElement("settingsError");
  errorBox.textContent = error.message || "Could not save your changes.";
  errorBox.hidden = false;
  settingsElement("settingsSuccess").hidden = true;
}

function reportSettingsSuccess(message) {
  const successBox = settingsElement("settingsSuccess");
  successBox.textContent = message;
  successBox.hidden = false;
  settingsElement("settingsError").hidden = true;
}

function clearSettingsFeedback() {
  settingsElement("settingsError").hidden = true;
  settingsElement("settingsSuccess").hidden = true;
}

async function loadSettings() {
  const { user } = await SmsAuth.apiFetch("/auth/me");
  if (!user) throw new Error("Your account details could not be loaded.");
  settingsElement("profileName").value = user.name || "";
  settingsElement("profileEmail").value = user.email || "";
  settingsElement("accountRole").textContent = String(user.role || "").replaceAll("_", " ");
  SmsAuth.setSession(SmsAuth.getToken(), user);

  if (user.role === "admin" || user.role === "school_admin") {
    settingsElement("schoolSettingsPanel").hidden = false;
    const result = await SmsAuth.apiFetch("/schools/me");
    const school = result.school;
    if (!school) throw new Error("Your school profile could not be loaded.");
    settingsElement("schoolName").value = school.name || "";
    const schoolSettings = school.settings || {};
    settingsElement("schoolType").value = schoolSettings.schoolType || "";
    settingsElement("schoolEmail").value = schoolSettings.email || "";
    settingsElement("schoolPhone").value = schoolSettings.phone || "";
    settingsElement("schoolAddress").value = schoolSettings.address || "";
    settingsElement("academicYear").value = schoolSettings.academicYear || "";
    settingsElement("accentColor").value = /^#[\da-f]{6}$/i.test(
      schoolSettings.accentColor || "",
    )
      ? schoolSettings.accentColor
      : "#237c78";
  }
}

async function saveProfile(event) {
  event.preventDefault();
  clearSettingsFeedback();
  const form = event.currentTarget;
  const button = form.querySelector("button[type='submit']");
  button.disabled = true;
  try {
    const result = await SmsAuth.apiFetch("/auth/me", {
      method: "PATCH",
      body: {
        name: settingsElement("profileName").value.trim(),
        email: settingsElement("profileEmail").value.trim(),
      },
    });
    SmsAuth.setSession(SmsAuth.getToken(), result.user);
    const updatedName = typeof result.user.name === "string" ? result.user.name : "";
    const updatedEmail = typeof result.user.email === "string" ? result.user.email : "";
    const accountName = document.getElementById("sidebarAccountName");
    const avatarName = document.getElementById("avatarName");
    const avatarEmail = document.getElementById("avatarEmail");
    if (accountName) accountName.textContent = updatedName;
    if (avatarName) avatarName.textContent = updatedName;
    if (avatarEmail) avatarEmail.textContent = updatedEmail;
    reportSettingsSuccess(result.message || "Profile updated.");
  } catch (error) {
    reportSettingsError(error);
  } finally {
    button.disabled = false;
  }
}

async function saveSchoolSettings(event) {
  event.preventDefault();
  clearSettingsFeedback();
  const form = event.currentTarget;
  const button = form.querySelector("button[type='submit']");
  const fields = Object.fromEntries(new FormData(form));
  button.disabled = true;
  try {
    await SmsAuth.apiFetch("/schools/me", { method: "PATCH", body: fields });
    reportSettingsSuccess("School settings saved.");
  } catch (error) {
    reportSettingsError(error);
  } finally {
    button.disabled = false;
  }
}

async function changePassword(event) {
  event.preventDefault();
  clearSettingsFeedback();
  const form = event.currentTarget;
  const button = form.querySelector("button[type='submit']");
  button.disabled = true;
  try {
    const result = await SmsAuth.apiFetch("/auth/password/change", {
      method: "POST",
      body: {
        currentPassword: settingsElement("currentPassword").value,
        newPassword: settingsElement("newPassword").value,
      },
    });
    form.reset();
    reportSettingsSuccess(result.message || "Password changed. Sign in again.");
    setTimeout(() => {
      SmsAuth.clearSession();
      window.location.replace("../login/index.html");
    }, 1600);
  } catch (error) {
    reportSettingsError(error);
    button.disabled = false;
  }
}

settingsElement("profileForm").addEventListener("submit", saveProfile);
settingsElement("schoolSettingsForm").addEventListener("submit", saveSchoolSettings);
settingsElement("passwordForm").addEventListener("submit", changePassword);
settingsElement("schoolSettingsPanel").hidden = ![
  "admin",
  "school_admin",
].includes(currentSettingsUser.role);
loadSettings().catch(reportSettingsError);
