const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const script = fs.readFileSync(path.join(__dirname, "startup.js"), "utf8");

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
  reducedMotion = false,
  savedReducedMotion = false,
  originalAriaHidden = null,
} = {}) {
  let now = 0;
  let nextTimer = 1;
  const timers = new Map();
  const windowListeners = new Map();
  const values = new Map();
  const location = {
    href: "http://localhost/login/index.html",
    origin: "http://localhost",
    reloadCount: 0,
    reload() {
      this.reloadCount += 1;
    },
  };

  if (savedReducedMotion) values.set("sms:reduce-motion", "true");

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
    createElement: (name) => new FakeElement(name),
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
      URL,
      document,
      localStorage: storage,
      performance: { now: () => now },
      window,
    },
    { filename: "startup.js" },
  );

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
    documentElement,
    location,
    start: () => window.MandelaNexusStartup.start(),
    startupOverlay: () =>
      body.children.find((element) => element.id === "nexus-startup") || null,
  };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

test("does not show until login or registration starts the flow", () => {
  const page = createPage();

  assert.equal(page.startupOverlay(), null);

  const startup = page.start();

  assert.ok(page.startupOverlay());
  assert.equal(page.startupOverlay().classList.contains("is-revealing"), false);
  assert.equal(page.appContent.getAttribute("inert"), "");
  assert.equal(page.appContent.getAttribute("aria-hidden"), "true");
  assert.equal(page.start(), startup);
});

test("plays the loader, then the reveal, and navigates after the fade", async () => {
  const page = createPage({ originalAriaHidden: "false" });
  const startup = page.start();
  const navigation = startup.complete("../dashboard/index.html");

  page.advance(899);
  await flushPromises();
  assert.equal(page.startupOverlay().classList.contains("is-revealing"), false);

  page.advance(1);
  await flushPromises();
  assert.equal(page.startupOverlay().classList.contains("is-revealing"), true);

  page.advance(1899);
  await flushPromises();
  assert.equal(page.startupOverlay().classList.contains("is-exiting"), false);

  page.advance(1);
  await flushPromises();
  assert.equal(page.startupOverlay().classList.contains("is-exiting"), true);

  page.advance(380);
  await navigation;

  assert.equal(page.location.href, "/dashboard/index.html");
  assert.ok(page.startupOverlay());
  assert.equal(page.appContent.getAttribute("inert"), "");
});

test("removes the loader and restores the form after failed login", async () => {
  const page = createPage({ originalAriaHidden: "false" });
  const startup = page.start();
  const failure = startup.fail();

  page.advance(380);
  await failure;

  assert.equal(page.startupOverlay(), null);
  assert.equal(page.appContent.getAttribute("inert"), null);
  assert.equal(page.appContent.getAttribute("aria-hidden"), "false");
  assert.equal(
    page.documentElement.classList.contains("nexus-startup-pending"),
    false,
  );
});

test("offers a way to continue without animation when login takes too long", async () => {
  const page = createPage();
  page.start();
  const overlay = page.startupOverlay();

  page.advance(12000);

  const notice = overlay.querySelector(".nexus-startup__notice");
  const actions = overlay.querySelector(".nexus-startup__actions");
  const continueButton = overlay.querySelector(".nexus-startup__continue");
  assert.equal(notice.hidden, false);
  assert.match(notice.textContent, /taking longer than expected/);
  assert.equal(actions.hidden, false);
  assert.equal(continueButton.focused, true);

  const failure = continueButton.listeners.get("click")();
  page.advance(380);
  await failure;
  assert.equal(page.startupOverlay(), null);
});

test("skips motion while keeping the same login flow for reduced-motion users", async () => {
  const page = createPage({ reducedMotion: true });
  const startup = page.start();
  const navigation = startup.complete("../dashboard/index.html");

  page.advance(0);
  await flushPromises();
  assert.equal(page.startupOverlay().classList.contains("is-revealing"), true);

  page.advance(0);
  await flushPromises();
  assert.equal(page.startupOverlay().classList.contains("is-exiting"), true);

  page.advance(0);
  assert.equal(await navigation, true);
  assert.equal(page.location.href, "/dashboard/index.html");
});

test("honors the saved reduced-motion preference", async () => {
  const page = createPage({ savedReducedMotion: true });
  const startup = page.start();
  const navigation = startup.complete("../dashboard/index.html");

  page.advance(0);
  await flushPromises();
  assert.equal(page.startupOverlay().classList.contains("is-revealing"), true);
  page.advance(0);
  await flushPromises();
  page.advance(0);
  assert.equal(await navigation, true);
});
