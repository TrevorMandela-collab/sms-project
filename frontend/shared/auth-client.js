/* =========================================================
   Shared auth client — include this on every page BEFORE
   auth-guard.js and your module's own script.js.

   Handles: talking to the backend, storing the JWT + user,
   and a fetch wrapper that attaches the Authorization header
   and surfaces API errors consistently.
========================================================= */

const DEFAULT_SMS_API_BASE = "https://sms-project-c8e2.onrender.com/api";
const TOKEN_KEY = "sms_token";
const USER_KEY = "sms_user";
const API_BASE_KEY = "sms_api_base";

class SmsApiError extends Error {
  constructor(
    message,
    { code = "REQUEST_FAILED", status = 0, retryable = false } = {},
  ) {
    super(message);
    this.name = "SmsApiError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

const SmsAuth = {
  getApiBase() {
    return localStorage.getItem(API_BASE_KEY) || DEFAULT_SMS_API_BASE;
  },

  setApiBase(url) {
    const normalized = String(url || "").replace(/\/$/, "");
    if (!normalized) localStorage.removeItem(API_BASE_KEY);
    else localStorage.setItem(API_BASE_KEY, normalized);
  },

  getToken() {
    return localStorage.getItem(TOKEN_KEY);
  },

  getUser() {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY));
    } catch {
      return null;
    }
  },

  isLoggedIn() {
    return !!this.getToken();
  },

  hasRole(...roles) {
    const user = this.getUser();
    return !!user && roles.includes(user.role);
  },

  /**
   * Where a given role should land after login (relative to any
   * module page, since every module folder sits one level deep).
   */
  homeUrlForRole(role) {
    if (role === "student") return "../student-portal/index.html";
    if (role === "parent") return "../parent-portal/index.html";
    return "../dashboard/index.html";
  },

  setSession(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },

  clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },

  async logout() {
    try {
      await this.apiFetch("/auth/logout", { method: "POST" });
    } catch (error) {
      SmsUI.toast(`Session ended locally: ${error.message}`, "warning");
    }
    this.clearSession();
    window.location.href = "../login/index.html";
  },

  async login(email, password) {
    const data = await this.request("/auth/login", {
      method: "POST",
      body: { email, password },
    });
    this.setSession(data.token, data.user);
    return data.user;
  },

  async register(payload) {
    const data = await this.request("/auth/register", {
      method: "POST",
      body: payload,
    });
    // Only auto-store the session if this was the bootstrap (first) admin
    if (data.isFirstAdmin) this.setSession(data.token, data.user);
    return data;
  },

  /**
   * Public student self-registration via an admin-issued invite code.
   * Logs the new student in immediately on success.
   */
  async registerWithCode({ code, name, email, password, role }) {
    const data = await this.request("/auth/register-with-code", {
      method: "POST",
      body: { code, name, email, password, role },
    });
    this.setSession(data.token, data.user);
    return data.user;
  },

  /**
   * Fetch wrapper for all authenticated API calls.
   * Usage: await SmsAuth.apiFetch('/students')
   *        await SmsAuth.apiFetch('/students', { method: 'POST', body: {...} })
   */
  async apiFetch(path, { method = "GET", body } = {}) {
    return this.request(path, { method, body, authenticated: true });
  },

  async request(path, { method = "GET", body, authenticated = false } = {}) {
    let res;
    try {
      res = await fetch(`${this.getApiBase()}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(authenticated || this.getToken()
            ? { Authorization: `Bearer ${this.getToken()}` }
            : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      window.dispatchEvent(new CustomEvent("sms:connection-lost"));
      throw new SmsApiError(
        "Couldn't connect to the server. Check your connection and try again.",
        {
          code: "NETWORK_ERROR",
          retryable: true,
        },
      );
    }

    window.dispatchEvent(new CustomEvent("sms:connection-restored"));
    if (res.status === 401 && authenticated) {
      this.clearSession();
      window.location.href = "../login/index.html?reason=session-expired";
      throw new SmsApiError("Your session expired. Please sign in again.", {
        code: "SESSION_EXPIRED",
        status: 401,
      });
    }
    if (res.status === 204) return null;

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const apiError =
        data.error && typeof data.error === "object"
          ? data.error
          : {
              code: `HTTP_${res.status}`,
              message: data.error || `Request failed (${res.status}).`,
            };
      throw new SmsApiError(apiError.message, {
        code: apiError.code,
        status: res.status,
        retryable: res.status >= 500,
      });
    }
    return data;
  },
};

const SmsUI = {
  toast(message, type = "info") {
    let host = document.getElementById("smsToastHost");
    if (!host) {
      host = document.createElement("div");
      host.id = "smsToastHost";
      host.className = "sms-toast-host";
      document.body.appendChild(host);
    }
    const toast = document.createElement("div");
    toast.className = `sms-toast sms-toast--${type}`;
    toast.setAttribute("role", "status");
    toast.textContent = message;
    host.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("is-visible"));
    setTimeout(() => {
      toast.classList.remove("is-visible");
      setTimeout(() => toast.remove(), 220);
    }, 3200);
  },

  confirm(
    message,
    {
      title = "Please confirm",
      confirmLabel = "Continue",
      danger = false,
    } = {},
  ) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "sms-confirm-overlay";
      overlay.innerHTML = `<div class="sms-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="smsConfirmTitle">
        <h2 id="smsConfirmTitle"></h2><p></p><div class="sms-confirm-actions">
          <button type="button" class="sms-confirm-cancel">Cancel</button>
          <button type="button" class="sms-confirm-submit"></button>
        </div></div>`;
      overlay.querySelector("h2").textContent = title;
      overlay.querySelector("p").textContent = message;
      const submit = overlay.querySelector(".sms-confirm-submit");
      submit.textContent = confirmLabel;
      if (danger) submit.classList.add("is-danger");
      const finish = (value) => {
        overlay.remove();
        resolve(value);
      };
      overlay
        .querySelector(".sms-confirm-cancel")
        .addEventListener("click", () => finish(false));
      submit.addEventListener("click", () => finish(true));
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) finish(false);
      });
      document.body.appendChild(overlay);
      requestAnimationFrame(() => overlay.classList.add("is-visible"));
      submit.focus();
    });
  },
};
