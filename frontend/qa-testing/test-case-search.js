(function (root) {
  const SUITE_LABELS = {
    "Authentication and sessions": "Authentication",
    "Super Admin platform": "Platform",
    "Roles and school isolation": "School access",
    "Student management": "Students",
    "Teachers, classes and subjects": "Staff",
    "Attendance": "Attendance",
    "Fees and finance": "Finance",
    "Academics, assignments and timetable": "Academics",
    "Communication, events and chat": "Communication",
    "Student, parent and teacher portals": "Portals",
    "Settings, profile and audit": "Settings",
    "Search, notifications and navigation": "Navigation",
    "Mobile and accessibility": "Accessibility",
    "QA Lab access and reporting": "QA Lab"
  };
  const SUITE_PRIORITIES = {
    "Authentication and sessions": "critical",
    "Super Admin platform": "critical",
    "Roles and school isolation": "critical",
    "Student management": "major",
    "Teachers, classes and subjects": "major",
    "Attendance": "major",
    "Fees and finance": "critical",
    "Academics, assignments and timetable": "major",
    "Communication, events and chat": "major",
    "Student, parent and teacher portals": "major",
    "Settings, profile and audit": "major",
    "Search, notifications and navigation": "minor",
    "Mobile and accessibility": "major",
    "QA Lab access and reporting": "major"
  };
  const VALID_PRIORITIES = new Set(["critical", "major", "minor", "cosmetics"]);

  function priorityForTestCase(testCase) {
    const explicitPriority = String(testCase && testCase.priority || "").toLowerCase();
    if (VALID_PRIORITIES.has(explicitPriority)) return explicitPriority;

    const testId = String(testCase && testCase.id || "").toUpperCase();
    if (/^MOB-00[1-5]$/.test(testId)) return "cosmetics";
    if (testId === "QA-003" || testId === "QA-004") return "critical";

    return SUITE_PRIORITIES[testCase && testCase.suite] || "minor";
  }

  function suiteSearchTerms(testCase) {
    const rawSuite = testCase && testCase.suite ? String(testCase.suite) : "";
    const friendlySuite = SUITE_LABELS[rawSuite] || rawSuite;
    return [rawSuite, friendlySuite];
  }

  function searchTestCases(testCases, query) {
    if (!Array.isArray(testCases)) return [];
    const term = String(query || "").trim().toLocaleLowerCase();
    if (!term) return [];

    return testCases.filter(function (testCase) {
      const fields = [
        testCase.id,
        ...suiteSearchTerms(testCase),
        priorityForTestCase(testCase),
        testCase.title,
        testCase.prerequisites,
        testCase.expected,
        ...(Array.isArray(testCase.steps) ? testCase.steps : []),
      ];
      return fields
        .filter((value) => typeof value === "string")
        .join(" ")
        .toLocaleLowerCase()
        .includes(term);
    });
  }

  if (typeof module === "object" && module.exports) {
    module.exports = searchTestCases;
    module.exports.priorityForTestCase = priorityForTestCase;
  } else {
    root.QATestCaseSearch = searchTestCases;
    root.QATestCasePriority = priorityForTestCase;
  }
})(globalThis);
