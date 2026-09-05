/* =========================================================
   Shared auth client — include this on every page BEFORE
   auth-guard.js and your module's own script.js.

   Handles: talking to the backend, storing the JWT + user,
   and a fetch wrapper that attaches the Authorization header
   and surfaces API errors consistently.
========================================================= */

const SMS_API_BASE = 'http://localhost:4000/api';
const TOKEN_KEY = 'sms_token';
const USER_KEY = 'sms_user';

const SmsAuth = {
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

  setSession(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },

  clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },

  logout() {
    this.clearSession();
    window.location.href = '../login/index.html';
  },

  async login(email, password) {
    const res = await fetch(`${SMS_API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed.');
    this.setSession(data.token, data.user);
    return data.user;
  },

  async register(payload) {
    const res = await fetch(`${SMS_API_BASE}/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.getToken() ? { Authorization: `Bearer ${this.getToken()}` } : {}),
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Registration failed.');
    // Only auto-store the session if this was the bootstrap (first) admin
    if (data.isFirstAdmin) this.setSession(data.token, data.user);
    return data;
  },

  /**
   * Fetch wrapper for all authenticated API calls.
   * Usage: await SmsAuth.apiFetch('/students')
   *        await SmsAuth.apiFetch('/students', { method: 'POST', body: {...} })
   */
  async apiFetch(path, { method = 'GET', body } = {}) {
    const res = await fetch(`${SMS_API_BASE}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(this.getToken() ? { Authorization: `Bearer ${this.getToken()}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (res.status === 401) {
      // Token missing/expired — send back to login
      this.clearSession();
      window.location.href = '../login/index.html';
      throw new Error('Session expired. Please log in again.');
    }

    if (res.status === 204) return null;

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
    return data;
  },
};
