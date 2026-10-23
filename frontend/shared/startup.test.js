const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const script = fs.readFileSync(path.join(__dirname, "startup.js"), "utf8");
const styles = fs.readFileSync(path.join(__dirname, "startup.css"), "utf8");

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

  removeEventListener(type, callback) {
    if (this.listeners.get(type) === callback) this.listeners.delete(type);
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
      [".nexus-startup__opening-video", new FakeElement("video")],
      [".nexus-startup__notice", new FakeElement("p")],
      [".nexus-startup__actions", new FakeElement("div")],
      [".nexus-startup__continue", new FakeElement("button")],
    ]);
    const openingVideo = this.elements.get(".nexus-startup__opening-video");
    openingVideo.paused = true;
    openingVideo.play = () => {
      openingVideo.paused = false;
      return Promise.resolve();
    };
    openingVideo.pause = () => {
      openingVideo.paused = true;
    };
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
  startupAlreadyPlayed = false,
  navigationType = "navigate",
} = {}) {
  let now = 0;
  let nextTimer = 1;
  const timers = new Map();
  const windowListeners = new Map();
  const documentListeners = new Map();
  const values = new Map();
  const sessionValues = new Map();
  if (startupAlreadyPlayed) {
    sessionValues.set("mandela-nexus-startup-played", "true");
  }
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
    currentScript: { src: "http://localhost/shared/startup.js" },
    documentElement,
    readyState: "loading",
    createElement: (name) => new FakeElement(name),
    addEventListener(type, callback) {
      documentListeners.set(type, callback);
    },
    removeEventListener(type, callback) {
      if (documentListeners.get(type) === callback) {
        documentListeners.delete(type);
      }
    },
  };

  const window = {
    location,
    matchMedia: () => ({ matches: reducedMotion }),
    addEventListener(type, callback, options = {}) {
      const listeners = windowListeners.get(type) || [];
      listeners.push({ callback, once: options.once === true });
      windowListeners.set(type, listeners);
    },
    removeEventListener(type, callback) {
      const listeners = windowListeners.get(type) || [];
      windowListeners.set(
        type,
        listeners.filter((listener) => listener.callback !== callback),
      );
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
      sessionStorage: {
        getItem(key) {
          return sessionValues.has(key) ? sessionValues.get(key) : null;
        },
        setItem(key, value) {
          sessionValues.set(key, String(value));
        },
      },
      performance: {
        now: () => now,
        getEntriesByType: () => [{ type: navigationType }],
      },
      window,
      console,
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
    fireDocumentEvent(type) {
      if (type === "DOMContentLoaded") document.readyState = "interactive";
      documentListeners.get(type)?.();
    },
    fireWindowEvent(type) {
      if (type === "load") document.readyState = "complete";
      const listeners = windowListeners.get(type) || [];
      listeners.slice().forEach((listener) => {
        listener.callback();
        if (listener.once) {
          windowListeners.set(
            type,
            (windowListeners.get(type) || []).filter(
              (current) => current !== listener,
            ),
          );
        }
      });
    },
    start: () => window.MandelaNexusStartup.start(),
    startupWasPlayed: () =>
      sessionValues.get("mandela-nexus-startup-played") === "true",
    visibilityListenerActive: () =>
      documentListeners.has("visibilitychange"),
    startupOverlay: () =>
      body.children.find((element) => element.id === "nexus-startup") || null,
    navigationType,
  };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

test("keeps the explicit authentication overlay reusable", () => {
  const page = createPage();

  assert.equal(page.startupOverlay(), null);
  assert.equal(page.documentElement.classList.contains("nexus-startup-booting"), true);

  const startup = page.start();

  assert.ok(page.startupOverlay());
  assert.equal(page.documentElement.classList.contains("nexus-startup-booting"), false);
  assert.equal(page.startupOverlay().classList.contains("is-spotlight"), false);
  assert.equal(page.appContent.getAttribute("inert"), "");
  assert.equal(page.appContent.getAttribute("aria-hidden"), "true");
  assert.equal(page.start(), startup);
});

test("automatically plays once on a cold page load and reveals the app after load", async () => {
  const page = createPage();

  page.fireDocumentEvent("DOMContentLoaded");
  const overlay = page.startupOverlay();
  assert.ok(overlay);
  assert.equal(page.appContent.getAttribute("inert"), "");
  assert.equal(page.startupWasPlayed(), true);

  page.advance(2999);
  await flushPromises();
  assert.equal(overlay.classList.contains("is-spotlight"), false);

  page.advance(1);
  await flushPromises();
  assert.equal(overlay.classList.contains("is-spotlight"), true);

  page.advance(2999);
  await flushPromises();
  assert.equal(overlay.classList.contains("is-exiting"), false);

  page.advance(1);
  await flushPromises();
  assert.equal(overlay.classList.contains("is-exiting"), true);

  page.advance(480);
  await flushPromises();

  assert.equal(page.startupOverlay(), null);
  assert.equal(page.appContent.getAttribute("inert"), null);
  assert.equal(
    page.documentElement.classList.contains("nexus-startup-pending"),
    false,
  );
});

test("does not replay the page-load animation during in-app navigation", () => {
  const page = createPage({ startupAlreadyPlayed: true });

  assert.equal(page.documentElement.classList.contains("nexus-startup-booting"), false);
  page.fireDocumentEvent("DOMContentLoaded");
  assert.equal(page.startupOverlay(), null);
});

test("replays the page-load animation after a hard refresh", () => {
  const page = createPage({
    startupAlreadyPlayed: true,
    navigationType: "reload",
  });

  assert.equal(page.documentElement.classList.contains("nexus-startup-booting"), true);
  page.fireDocumentEvent("DOMContentLoaded");
  assert.ok(page.startupOverlay());
});

test("defines a three-second opening and a three-second spotlight climax", () => {
  assert.match(script, /OPENING_DURATION_MS = 3000/);
  assert.match(script, /SPOTLIGHT_REVEAL_DURATION_MS = 3000/);
  assert.match(styles, /nexus-beams-focus 2600ms/);
  assert.match(styles, /nexus-mark-reveal 3000ms/);
  assert.match(styles, /nexus-opening-out 720ms/);
  assert.match(styles, /clip-path: circle\(0 at 50% 50%\)/);
  assert.match(styles, /box-shadow: 0 0 23px 4px/);
  assert.match(styles, /transition: opacity 480ms/);
});

test("uses the local reference clip and the existing Mandela M brand mark", () => {
  const page = createPage();
  page.start();
  const markup = page.startupOverlay().markup;

  assert.match(markup, /assets\/nexus-opening\.mp4/);
  assert.match(markup, /assets\/nexus-opening-poster\.jpg/);
  assert.match(markup, /nexus-startup__mark[^>]*>M<\/span>/);
  assert.doesNotMatch(markup, /Replaceable logo placeholder/);
  assert.ok(
    fs.statSync(path.join(__dirname, "assets", "nexus-opening.mp4")).size > 0,
  );
  assert.ok(
    fs.statSync(path.join(__dirname, "assets", "nexus-opening-poster.jpg")).size >
      0,
  );
});

test("plays the loader, then the reveal, and navigates after the fade", async () => {
  const page = createPage({ originalAriaHidden: "false" });
  const startup = page.start();
  const navigation = startup.complete("../dashboard/index.html");

  page.advance(2999);
  await flushPromises();
  assert.equal(page.startupOverlay().classList.contains("is-spotlight"), false);

  page.advance(1);
  await flushPromises();
  assert.equal(page.startupOverlay().classList.contains("is-spotlight"), true);

  page.advance(2999);
  await flushPromises();
  assert.equal(page.startupOverlay().classList.contains("is-exiting"), false);

  page.advance(1);
  await flushPromises();
  assert.equal(page.startupOverlay().classList.contains("is-exiting"), true);

  page.advance(480);
  await navigation;

  assert.equal(page.location.href, "/dashboard/index.html");
  assert.ok(page.startupOverlay());
  assert.equal(page.appContent.getAttribute("inert"), "");
});

test("removes the loader and restores the form after failed login", async () => {
  const page = createPage({ originalAriaHidden: "false" });
  const startup = page.start();
  const overlay = page.startupOverlay();
  const failure = startup.fail();

  page.advance(480);
  await failure;

  assert.equal(page.startupOverlay(), null);
  assert.equal(page.appContent.getAttribute("inert"), null);
  assert.equal(page.appContent.getAttribute("aria-hidden"), "false");
  assert.equal(
    overlay.querySelector(".nexus-startup__opening-video").paused,
    true,
  );
  assert.equal(page.visibilityListenerActive(), false);
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
  page.advance(480);
  await failure;
  assert.equal(page.startupOverlay(), null);
});

test("skips the animated sequence for the reduced-motion preference", async () => {
  const page = createPage({ reducedMotion: true });
  const startup = page.start();
  const navigation = startup.complete("../dashboard/index.html");

  page.advance(0);
  await flushPromises();
  assert.equal(page.startupOverlay().classList.contains("is-spotlight"), true);

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
  assert.equal(page.startupOverlay().classList.contains("is-spotlight"), true);
  page.advance(0);
  await flushPromises();
  page.advance(0);
  assert.equal(await navigation, true);
});
