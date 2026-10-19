const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const script = fs.readFileSync(path.join(__dirname, "script.js"), "utf8");

function createLoginPage(login) {
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

  const loginForm = element("loginForm");
  loginForm.querySelector = () => element("submitButton");

  const context = {
    document: {
      getElementById: element,
    },
    SmsAuth: {
      homeUrlForRole: () => "../dashboard/index.html",
      isLoggedIn: () => false,
      login,
    },
    window: {
      location: { href: "" },
    },
  };
  vm.runInNewContext(script, context);

  return {
    elements,
    submit() {
      return listeners.get("loginForm:submit")({ preventDefault() {} });
    },
  };
}

test("ignores duplicate submissions until the first login completes", async () => {
  let resolveLogin;
  let calls = 0;
  const page = createLoginPage(() => {
    calls += 1;
    return new Promise((resolve) => {
      resolveLogin = resolve;
    });
  });

  const firstSubmission = page.submit();
  await page.submit();

  assert.equal(calls, 1);
  assert.equal(page.elements.get("submitButton").disabled, true);

  resolveLogin({ role: "admin" });
  await firstSubmission;

  assert.equal(page.elements.get("submitButton").disabled, true);
  assert.equal(page.elements.get("errorBanner").style.display, "none");
});

test("allows another login attempt after an unsuccessful login", async () => {
  let calls = 0;
  const page = createLoginPage(async () => {
    calls += 1;
    throw new Error("Invalid email or password.");
  });

  await page.submit();

  assert.equal(calls, 1);
  assert.equal(page.elements.get("submitButton").disabled, false);
  assert.equal(page.elements.get("errorBanner").textContent, "Invalid email or password.");

  await page.submit();

  assert.equal(calls, 2);
});
