const assert = require("assert");
const searchTestCases = require("./test-case-search");
const priorityForTestCase = searchTestCases.priorityForTestCase;

const testCases = [
  {
    id: "AUTH-001",
    suite: "Authentication and sessions",
    title: "Log in with valid credentials",
    prerequisites: "User is logged out.",
    steps: ["Open the login page."],
    expected: "The dashboard appears.",
  },
  {
    id: "FEE-002",
    suite: "Fees and finance",
    title: "Search the fee ledger",
    prerequisites: "Several fees exist.",
    steps: ["Enter a student name in the ledger search."],
    expected: "Matching fee rows appear.",
  },
];

assert.deepEqual(searchTestCases(testCases, "auth-001"), [testCases[0]]);
assert.deepEqual(searchTestCases(testCases, "Authentication"), [testCases[0]]);
assert.deepEqual(searchTestCases(testCases, "FEES AND FINANCE"), [testCases[1]]);
assert.deepEqual(searchTestCases(testCases, "finance"), [testCases[1]]);
assert.deepEqual(searchTestCases(testCases, "student name"), [testCases[1]]);
assert.deepEqual(searchTestCases(testCases, "matching fee rows"), [testCases[1]]);
assert.deepEqual(searchTestCases(testCases, "critical"), [testCases[0], testCases[1]]);
assert.equal(priorityForTestCase(testCases[0]), "critical");
assert.equal(priorityForTestCase({ id: "MOB-002", suite: "Mobile and accessibility" }), "cosmetics");
assert.equal(priorityForTestCase({ id: "QA-003", suite: "QA Lab access and reporting" }), "critical");
assert.equal(priorityForTestCase({ suite: "Unknown suite" }), "minor");
assert.equal(priorityForTestCase({ priority: "cosmetics" }), "cosmetics");
assert.deepEqual(searchTestCases(testCases, "  "), []);
assert.deepEqual(searchTestCases(null, "anything"), []);

console.log("QA test-case search tests passed");
