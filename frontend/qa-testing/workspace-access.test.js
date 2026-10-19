const assert = require("assert");
const modulesForRole = require("./workspace-access");

const modules = [
  { label: "Dashboard", roles: ["admin", "teacher"] },
  { label: "Teachers", roles: ["admin"] },
  { label: "Messages", roles: ["admin", "teacher", "parent", "student"] },
  { label: "Platform Overview", roles: ["super_admin"] },
];

assert.deepEqual(
  modulesForRole(modules, "school_admin").map((entry) => entry.label),
  ["Dashboard", "Teachers", "Messages"],
);
assert.deepEqual(
  modulesForRole(modules, "teacher").map((entry) => entry.label),
  ["Dashboard", "Messages"],
);
assert.deepEqual(modulesForRole(modules, "super_admin").map((entry) => entry.label), [
  "Platform Overview",
]);
assert.deepEqual(modulesForRole(modules, "unknown"), []);

console.log("QA workspace role access tests passed");
