const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const script = fs.readFileSync(path.join(__dirname, "auth-client.js"), "utf8");

function initializeAuthClient(reduceMotionPreference) {
  const classes = new Set();
  const values = new Map();
  if (reduceMotionPreference !== null) {
    values.set("sms:reduce-motion", reduceMotionPreference);
  }

  vm.runInNewContext(script, {
    document: {
      documentElement: {
        classList: {
          add: (className) => classes.add(className),
        },
      },
    },
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
    },
    window: {
      location: { hostname: "localhost" },
    },
  });

  return classes;
}

test("applies the saved reduced-motion preference during auth client initialization", () => {
  assert.equal(initializeAuthClient("true").has("reduce-motion"), true);
  assert.equal(initializeAuthClient("false").has("reduce-motion"), false);
  assert.equal(initializeAuthClient(null).has("reduce-motion"), false);
});
