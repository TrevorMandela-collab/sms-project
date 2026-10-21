const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const script = fs.readFileSync(path.join(__dirname, "script.js"), "utf8");

function createRegisterPage(registerWithCode, startup, location = { href: "" }) {
  const listeners = new Map();
  const elements = new Map();

  function element(id) {
    if (!elements.has(id)) {
      elements.set(id, {
        addEventListener(type, callback) {
          listeners.set(`${id}:${type}`, callback);
        },
        style: {},
        textContent: "",
        value: "",
      });
    }
    return elements.get(id);
  }

  const registerForm = element("registerForm");
  registerForm.querySelector = () => element("submitButton");

  vm.runInNewContext(
    script,
    {
      document: { getElementById: element },
      SmsAuth: {
        homeUrlForRole: () => "../student-portal/index.html",
        isLoggedIn: () => false,
        registerWithCode,
      },
      window: {
        location,
        MandelaNexusStartup: startup,
      },
    },
    { filename: "register/script.js" },
  );

  return {
    elements,
    location,
    submit() {
      return listeners.get("registerForm:submit")({ preventDefault() {} });
    },
  };
}

test("starts the loader before registration and reveals before role navigation", async () => {
  const events = [];
  const location = { href: "" };
  const page = createRegisterPage(
    async () => {
      events.push("register");
      return { role: "student" };
    },
    {
      start() {
        events.push("loader");
        return {
          async complete(destination) {
            events.push("reveal");
            location.href = destination;
            return true;
          },
          async fail() {
            events.push("dismiss");
          },
        };
      },
    },
    location,
  );

  await page.submit();

  assert.deepEqual(events, ["loader", "register", "reveal"]);
  assert.equal(page.location.href, "../student-portal/index.html");
  assert.equal(page.elements.get("submitButton").disabled, true);
});

test("removes the loader and restores the registration form after failure", async () => {
  const events = [];
  const page = createRegisterPage(
    async () => {
      throw new Error("Invite code is invalid.");
    },
    {
      start() {
        events.push("loader");
        return {
          async complete() {
            events.push("unexpected reveal");
            return true;
          },
          async fail() {
            events.push("dismiss");
          },
        };
      },
    },
  );

  await page.submit();

  assert.deepEqual(events, ["loader", "dismiss"]);
  assert.equal(
    page.elements.get("errorBanner").textContent,
    "Invite code is invalid.",
  );
  assert.equal(page.elements.get("submitButton").disabled, false);
});
