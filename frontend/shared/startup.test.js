const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const script = fs.readFileSync(path.join(__dirname, "startup.js"), "utf8");
const startupKey = "mandela-nexus-startup-seen";

class FakeElement {
  constructor(name) {
    this.name = name;
    this.attributes = new Map();
    this.children = [];
    this.listeners = new Map();
    this.classes = new Set();
    this.hidden = false;
    this.parentNode = null;
    this.classList = {
      add: (value) => this.classes.add(value),
      contains: (value) => this.classes.has(value),
      remove: (value) => this.classes.delete(value),
    };
  }

  set className(value) {
    this.classes = new Set(value.split(/\s+/).filter(Boolean));
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  addEventListener(type, callback) {
    this.listeners.set(type, callback);
  }

  appendChild(element) {
    element.parentNode = this;
    this.children.push(element);
    return element;
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter(
      (element) => element !== this,
    );
    this.parentNode = null;
  }

  focus() {
    this.focused = true;
  }

  set innerHTML(value) {
    this.markup = value;
    this.elements = new Map([
      [".nexus-startup__notice", new FakeElement("p")],
      [".nexus-startup__actions", new FakeElement("div")],
      [".nexus-startup__continue", new FakeElement("button")],
      [".nexus-startup__retry", new FakeElement("button")],
    ]);
    this.elements.get(".nexus-startup__notice").hidden = true;
    this.elements.get(".nexus-startup__actions").hidden = true;
    this.elements
      .get(".nexus-startup__actions")
      .querySelector = (selector) => this.elements.get(selector);
  }

  querySelector(selector) {
    return this.elements?.get(selector) || null;
  }
}

function createPage({
  pathname = "/login/index.html",
  token = null,
  seen = null,
  reducedMotion = false,
  readyState = "interactive",
  originalAriaHidden = null,
} = {}) {
  let now = 0;
  let nextTimer = 1;
  const timers = new Map();
  const windowListeners = new Map();
  const documentListeners = new Map();
  const values = new Map();
  const location = { pathname, reloadCount: 0, reload() { this.reloadCount += 1; } };

  if (token) values.set("sms_token", token);
  if (seen) values.set(startupKey, seen);

  const storage = {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };

  const documentElement = new FakeElement("html");
  const body = new FakeElement("body");
  const appContent = new FakeElement("main");
  if (originalAriaHidden !== null) {
    appContent.setAttribute("aria-hidden", originalAriaHidden);
  }
  body.appendChild(appContent);

  const document = {
    body,
    documentElement,
    readyState,
    createElement: (name) => new FakeElement(name),
    addEventListener(type, callback) {
      documentListeners.set(type, callback);
    },
  };

  const window = {
    location,
    matchMedia: () => ({ matches: reducedMotion }),
    addEventListener(type, callback, options = {}) {
      windowListeners.set(type, { callback, once: options.once === true });
    },
    removeEventListener(type, callback) {
      if (windowListeners.get(type)?.callback === callback) {
        windowListeners.delete(type);
      }
    },
    setTimeout(callback, delay = 0) {
      const id = nextTimer++;
      timers.set(id, { callback, dueAt: now + delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };

  class FakeMutationObserver {
    observe() {}
    disconnect() {}
  }

  vm.runInNewContext(
    script,
    {
      Boolean,
      Map,
      Math,
      MutationObserver: FakeMutationObserver,
      Array,
      document,
      localStorage: storage,
      performance: { now: () => now },
      sessionStorage: storage,
      window,
    },
    { filename: "startup.js" },
  );

  function dispatchWindowEvent(type) {
    const listener = windowListeners.get(type);
    if (!listener) return;
    listener.callback();
    if (listener.once) windowListeners.delete(type);
  }

  function advance(milliseconds) {
    const target = now + milliseconds;
    while (true) {
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.dueAt <= target)
        .sort((left, right) => left[1].dueAt - right[1].dueAt)[0];
      if (!due) break;
      const [id, timer] = due;
      timers.delete(id);
      now = timer.dueAt;
      timer.callback();
    }
    now = target;
  }

  return {
    appContent,
    advance,
    body,
    dispatchWindowEvent,
    documentElement,
    location,
    sessionStorage: storage,
    startupOverlay: () =>
      body.children.find((element) => element.id === "nexus-startup") || null,
  };
}

test("does not start on an unauthenticated protected page", () => {
  const page = createPage({ pathname: "/dashboard/index.html" });

  assert.equal(page.startupOverlay(), null);
  assert.equal(
    page.documentElement.classList.contains("nexus-startup-pending"),
    false,
  );
  assert.equal(page.sessionStorage.getItem(startupKey), null);
});

test("does not interrupt a signed-in redirect from the login page", () => {
  const page = createPage({ token: "existing-token" });

  assert.equal(page.startupOverlay(), null);
  assert.equal(page.sessionStorage.getItem(startupKey), null);
});

test("waits for page load and the minimum duration before restoring content", () => {
  const page = createPage({ originalAriaHidden: "false" });
  const overlay = page.startupOverlay();

  assert.ok(overlay);
  assert.equal(page.appContent.getAttribute("inert"), "");
  assert.equal(page.appContent.getAttribute("aria-hidden"), "true");

  page.dispatchWindowEvent("load");
  page.advance(3649);
  assert.ok(page.startupOverlay());

  page.advance(1);
  assert.ok(page.startupOverlay());
  page.advance(380);

  assert.equal(page.startupOverlay(), null);
  assert.equal(
    page.documentElement.classList.contains("nexus-startup-pending"),
    false,
  );
  assert.equal(page.appContent.getAttribute("inert"), null);
  assert.equal(page.appContent.getAttribute("aria-hidden"), "false");
});

test("offers a working continue action when initialization times out", () => {
  const page = createPage();
  const overlay = page.startupOverlay();

  page.advance(12000);

  const notice = overlay.querySelector(".nexus-startup__notice");
  const actions = overlay.querySelector(".nexus-startup__actions");
  const continueButton = overlay.querySelector(".nexus-startup__continue");
  assert.equal(notice.hidden, false);
  assert.match(notice.textContent, /taking longer than expected/);
  assert.equal(actions.hidden, false);
  assert.equal(continueButton.focused, true);

  continueButton.listeners.get("click")();
  page.advance(380);

  assert.equal(page.startupOverlay(), null);
  assert.equal(
    page.documentElement.classList.contains("nexus-startup-pending"),
    false,
  );
});

test("uses the short static reveal for reduced motion", () => {
  const page = createPage({ reducedMotion: true });
  const overlay = page.startupOverlay();

  assert.equal(overlay.classList.contains("is-reduced-motion"), true);
  page.dispatchWindowEvent("load");
  page.advance(799);
  assert.ok(page.startupOverlay());
  page.advance(1);

  assert.equal(page.startupOverlay(), null);
});
