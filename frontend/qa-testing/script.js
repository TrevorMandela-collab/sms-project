(function () {
  const content = document.getElementById("qaContent");
  const denied = document.getElementById("qaDenied");
  const checking = document.getElementById("qaChecking");
  const errorBox = document.getElementById("qaError");
  const errorText = document.getElementById("qaErrorText");

  const ENVIRONMENTS = [
    { key: "development", label: "Development" },
    { key: "production", label: "Production" }
  ];
  const STATUS_LABELS = { pass: "Pass", fail: "Fail", blocked: "Blocked", notrun: "Not Run" };
  const TEST_CATEGORY_LABELS = {
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
  const SAVE_DELAY_MS = 1000;
  const SAVE_FLUSH_TIMEOUT_MS = 15000;
  const APPLICATION_MODULES = [
    { label: "Platform Overview", path: "../platform/index.html", roles: ["super_admin"] },
    { label: "Dashboard", path: "../dashboard/index.html", roles: ["admin", "teacher"] },
    { label: "Students", path: "../students/index.html", roles: ["admin", "teacher"] },
    { label: "Teachers", path: "../teachers/index.html", roles: ["admin"] },
    { label: "Users & Roles", path: "../manage-logins/index.html", roles: ["admin"] },
    { label: "Audit Logs", path: "../audit-logs/index.html", roles: ["admin"] },
    { label: "Classes & Subjects", path: "../classes-subjects/index.html", roles: ["admin"] },
    { label: "Assignments", path: "../assignments/index.html", roles: ["admin", "teacher"] },
    { label: "Exams & Results", path: "../exams/index.html", roles: ["admin", "teacher"] },
    { label: "Timetable", path: "../timetable/index.html", roles: ["admin", "teacher"] },
    { label: "Events", path: "../events/index.html", roles: ["admin", "teacher"] },
    { label: "Attendance", path: "../attendance/index.html", roles: ["admin", "teacher"] },
    { label: "Fees & Finance", path: "../fees/index.html", roles: ["admin", "teacher"] },
    { label: "Library", path: "../library/index.html", roles: ["admin"] },
    { label: "Announcements", path: "../announcements/index.html", roles: ["admin"] },
    { label: "Messages", path: "../chats/index.html", roles: ["admin", "teacher", "parent", "student"] },
    { label: "My Classes", path: "../teacher-portal/index.html", roles: ["teacher"] },
    { label: "Student Portal", path: "../student-portal/index.html", roles: ["student"] },
    { label: "Parent Portal", path: "../parent-portal/index.html", roles: ["parent"] }
  ];

  let tests = [];
  let index = 0;
  let priorityFilter = "all";
  const DEV_BASE = "http://localhost:4000/api";
  const PROD_BASE = ""; // empty = Production not available yet
  let currentEnv = SmsAuth.getApiBase().replace(/\/$/, "") === DEV_BASE ? "development" : "other";
  const results = { development: {}, production: {}, other: {} };

  let canSave = true;
  let loadFailed = false;
  const saveStates = new Map();
  let lastSaveFailure = null;

  let card, counterEl, envTag, badge, idEl, titleEl, suiteEl, bodyEl, saveEl;
  let actualInput, notesInput, prevBtn, nextBtn;
  const statusButtons = {};
  const bugForm = document.getElementById("qaBugForm");
  const bugList = document.getElementById("qaBugList");
  const bugSaveEl = document.getElementById("qaBugSaveState");
  const linkedTestInput = document.getElementById("qaBugLinkedTest");
  let reportBugBtn;
  let canSaveBugs = true;
  let bugLoadError = "";
  let bugsLoaded = false;
  let bugs = [];
  const envButtons = {};
  const moduleSelect = document.getElementById("qaModuleSelect");
  const refreshModuleButton = document.getElementById("qaRefreshModule");
  const openModuleLink = document.getElementById("qaOpenModule");
  const workspaceStatus = document.getElementById("qaWorkspaceStatus");
  const workspaceAuth = document.getElementById("qaWorkspaceAuth");
  const applicationFrame = document.getElementById("qaAppFrame");
  let activeWorkspaceUrl = "";

  function loadSelectedModule() {
    const module = APPLICATION_MODULES.find(function (entry) {
      return entry.path === moduleSelect.value;
    });
    if (!module) return;

    const pageUrl = new URL(module.path, window.location.href);
    const embeddedUrl = new URL(pageUrl.href);
    embeddedUrl.searchParams.set("qaEmbed", "1");
    activeWorkspaceUrl = embeddedUrl.href;
    applicationFrame.title = module.label + " — Mandela SMS workspace";
    applicationFrame.hidden = false;
    workspaceAuth.hidden = true;
    workspaceStatus.textContent = "Loading " + module.label + "...";
    openModuleLink.href = pageUrl.href;
    applicationFrame.src = activeWorkspaceUrl;
  }

  function setupWorkspace() {
    const user = SmsAuth.getUser() || {};
    const modules = window.QAWorkspaceAccess(APPLICATION_MODULES, user.role);
    moduleSelect.textContent = "";

    for (const module of modules) {
      const option = el("option", "", module.label);
      option.value = module.path;
      moduleSelect.appendChild(option);
    }

    if (modules.length === 0) {
      moduleSelect.disabled = true;
      refreshModuleButton.disabled = true;
      workspaceStatus.textContent = "No application modules are available for this account role.";
      return;
    }

    moduleSelect.addEventListener("change", loadSelectedModule);
    refreshModuleButton.addEventListener("click", loadSelectedModule);
    applicationFrame.addEventListener("load", function () {
      let frameUrl;
      let frameTitle;
      try {
        frameUrl = new URL(applicationFrame.contentWindow.location.href);
        if (frameUrl.origin !== window.location.origin) {
          throw new Error("The embedded page is not same-origin.");
        }
        frameTitle = applicationFrame.contentDocument.title;
      } catch (error) {
        applicationFrame.hidden = true;
        workspaceStatus.textContent =
          "This page could not be inspected from QA Lab. It may be unavailable or blocked from embedding; use Open in new tab to continue.";
        return;
      }

      if (/\/login\/index\.html$/i.test(frameUrl.pathname)) {
        applicationFrame.hidden = true;
        workspaceAuth.hidden = false;
        workspaceStatus.textContent = "Authentication is required to use this application page.";
        return;
      }
      if (frameUrl.href !== activeWorkspaceUrl) {
        applicationFrame.hidden = true;
        workspaceStatus.textContent =
          "The application redirected to a different page. It may be unavailable or require access; use Open in new tab to inspect it.";
        return;
      }
      if (/\b(404|not found|page unavailable)\b/i.test(frameTitle)) {
        applicationFrame.hidden = true;
        workspaceStatus.textContent =
          "This application page is unavailable. Use Open in new tab to check its address.";
        return;
      }

      workspaceAuth.hidden = true;
      workspaceStatus.textContent =
        moduleSelect.options[moduleSelect.selectedIndex].text +
        " page loaded. Verify its behavior and record a result separately.";
    });
    applicationFrame.addEventListener("error", function () {
      applicationFrame.hidden = true;
      workspaceStatus.textContent =
        "The application page could not be loaded. Use Open in new tab to check whether it is available.";
    });
    loadSelectedModule();
  }

  function show(section) {
    for (const element of [content, denied, checking, errorBox]) {
      element.hidden = element !== section;
    }
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function envLabel() {
    const found = ENVIRONMENTS.filter(function (e) { return e.key === currentEnv; })[0];
    return found ? found.label : "Other backend";
  }

  function getResult(id) {
    const store = results[currentEnv];
    if (!store[id]) store[id] = { status: "notrun", actual: "", notes: "" };
    return store[id];
  }

  function currentCounts() {
    let passed = 0, failed = 0, blocked = 0;
    for (const t of tests) {
      const r = results[currentEnv][t.id];
      if (!r) continue;
      if (r.status === "pass") passed++;
      else if (r.status === "fail") failed++;
      else if (r.status === "blocked") blocked++;
    }
    return {
      total: tests.length,
      passed: passed,
      failed: failed,
      blocked: blocked,
      notRun: tests.length - passed - failed - blocked
    };
  }

  function renderSummary(counts) {
    const total = counts.total;
    const tested = counts.passed + counts.failed + counts.blocked;
    const percent = total === 0 ? 0 : Math.round((tested / total) * 100);

    document.getElementById("statTotal").textContent = total;
    document.getElementById("statPassed").textContent = counts.passed;
    document.getElementById("statFailed").textContent = counts.failed;
    document.getElementById("statBlocked").textContent = counts.blocked;
    document.getElementById("statNotRun").textContent = counts.notRun;
    document.getElementById("progressText").textContent = percent + "%";
    document.getElementById("progressFill").style.width = percent + "%";
    document.getElementById("progressBar").setAttribute("aria-valuenow", String(percent));
  }

  function friendlySuiteLabel(suite) {
    return TEST_CATEGORY_LABELS[suite] || suite || "General";
  }

  function setSaveMessage(text) {
    if (saveEl) saveEl.textContent = text;
  }

  function saveStateFor(environment, testId) {
    const key = resultSaveKey(environment, testId);
    let state = saveStates.get(key);
    if (!state) {
      state = {
        environment: environment,
        testId: testId,
        timer: null,
        revision: 0,
        savedRevision: 0,
        inFlight: null,
        message: ""
      };
      saveStates.set(key, state);
    }
    return state;
  }

  function resultSaveKey(environment, testId) {
    return environment + "\u0000" + testId;
  }

  function updateSaveMessage(state, message) {
    state.message = message;
    if (state.environment === currentEnv && tests[index] && tests[index].id === state.testId) {
      setSaveMessage(message);
    } else if (lastSaveFailure) {
      setSaveMessage(lastSaveFailure.message);
    }
  }

  async function saveResult(environment, testId) {
    if (!canSave) return;
    const state = saveStateFor(environment, testId);
    if (state.savedRevision >= state.revision) return true;
    if (state.inFlight) {
      await state.inFlight;
      if (state.savedRevision >= state.revision) return true;
      return saveResult(environment, testId);
    }

    const result = results[environment][testId];
    if (!result) return false;
    const revision = state.revision;
    const payload = {
      environment: environment,
      status: result.status,
      actual: result.actual,
      notes: result.notes
    };
    updateSaveMessage(state, "Saving...");
    const request = (async function () {
      try {
        await SmsAuth.apiFetch("/qa/results/" + encodeURIComponent(testId), {
          method: "PUT",
          body: payload
        });
        state.savedRevision = revision;
        if (state.revision === revision) {
          if (lastSaveFailure &&
              lastSaveFailure.key === resultSaveKey(environment, testId)) {
            lastSaveFailure = null;
          }
          updateSaveMessage(state, "Saved");
        }
        return true;
      } catch (error) {
        if (state.revision === revision) {
          const message = "Could not save: " + (error && error.message ? error.message : "unknown error");
          state.message = message;
          lastSaveFailure = {
            key: resultSaveKey(environment, testId),
            message: "Could not save " + testId + ": " +
              (error && error.message ? error.message : "unknown error")
          };
          updateSaveMessage(state, message);
        }
        return false;
      }
    })();
    state.inFlight = request;
    const succeeded = await request;
    if (state.inFlight === request) state.inFlight = null;
    if (state.revision > revision) return saveResult(environment, testId);
    return succeeded;
  }

  function scheduleSave(testId) {
    if (!canSave) return;
    const environment = currentEnv;
    const state = saveStateFor(environment, testId);
    state.revision += 1;
    updateSaveMessage(state, "Unsaved changes...");
    clearTimeout(state.timer);
    state.timer = setTimeout(function () {
      state.timer = null;
      saveResult(environment, testId);
    }, SAVE_DELAY_MS);
  }

  async function flushPending() {
    const states = Array.from(saveStates.values());
    for (const state of states) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    const flushed = await Promise.all(states.map(async function (state) {
      if (state.savedRevision >= state.revision) return true;
      let timer;
      const saved = await Promise.race([
        saveResult(state.environment, state.testId),
        new Promise(function (resolve) {
          timer = setTimeout(function () { resolve(false); }, SAVE_FLUSH_TIMEOUT_MS);
        })
      ]);
      clearTimeout(timer);
      return saved;
    }));
    const allSaved = flushed.every(Boolean) &&
      Array.from(saveStates.values()).every(function (state) {
        return state.savedRevision >= state.revision;
      });
    if (!allSaved) {
      setSaveMessage("Could not save all pending results. Your edits are still here; click the environment switch again to retry.");
    }
    return allSaved;
  }

  async function loadSavedResults() {
    if (currentEnv === "other") {
      canSave = false;
      return;
    }
    try {
      const data = await SmsAuth.apiFetch("/qa/results?environment=" + encodeURIComponent(currentEnv));
      const store = results[currentEnv];
      for (const row of (data && data.results) || []) {
        store[row.testId] = { status: row.status, actual: row.actual || "", notes: row.notes || "" };
      }
    } catch (error) {
      canSave = false;
      loadFailed = true;
    }
  }

  async function loadSavedBugs() {
    if (currentEnv === "other") {
      canSaveBugs = false;
      bugLoadError = "Bug reports are not available for this backend.";
      return;
    }
    try {
      const data = await SmsAuth.apiFetch("/qa/bugs?environment=" + encodeURIComponent(currentEnv));
      if (!data || !Array.isArray(data.bugs)) throw new Error("The bug report response was not valid.");
      bugs = data.bugs;
      bugsLoaded = true;
      bugLoadError = "";
    } catch (error) {
      canSaveBugs = false;
      bugLoadError = "Could not load bug reports. Reload the page to try again.";
      bugSaveEl.textContent = "Could not load bug reports, so bug saving is turned off. Reload the page to try again.";
    }
  }

  function setBugSavingEnabled(enabled) {
    for (const field of bugForm.querySelectorAll("input, textarea, select, button")) {
      field.disabled = !enabled;
    }
  }

  function renderBugs() {
    bugList.textContent = "";
    if (bugLoadError) {
      const error = el("p", "qa-muted", bugLoadError);
      error.setAttribute("role", "alert");
      bugList.appendChild(error);
      if (!bugsLoaded) return;
    }
    if (bugsLoaded && bugs.length === 0) {
      bugList.appendChild(el("p", "qa-muted", "No bug reports for this environment yet."));
      return;
    }

    for (const bug of bugs) {
      const item = el("article", "qa-bug-card");
      const top = el("div", "qa-bug-card-top");
      top.appendChild(el("h3", "", bug.title));
      top.appendChild(el("span", "qa-bug-meta", bug.severity + " · " + bug.status));
      item.appendChild(top);

      const details = [
        ["Linked test", bug.linkedTestId || "None"],
        ["Steps", bug.steps || "Not provided"],
        ["Expected", bug.expected || "Not provided"],
        ["Actual", bug.actual || "Not provided"],
        ["Evidence", bug.evidence || "Not provided"]
      ];
      const detailList = el("div", "qa-bug-details");
      for (const detail of details) {
        const paragraph = el("p");
        paragraph.appendChild(el("strong", "", detail[0] + ": "));
        paragraph.appendChild(document.createTextNode(detail[1]));
        detailList.appendChild(paragraph);
      }
      item.appendChild(detailList);

      const action = el("button", "qa-nav-btn", bug.status === "open" ? "Close bug" : "Reopen bug");
      action.type = "button";
      action.disabled = !canSaveBugs;
      action.addEventListener("click", async function () {
        if (!canSaveBugs) return;
        action.disabled = true;
        bugSaveEl.textContent = "Saving...";
        try {
          const updated = await SmsAuth.apiFetch("/qa/bugs/" + encodeURIComponent(bug.id), {
            method: "PATCH",
            body: { status: bug.status === "open" ? "closed" : "open" }
          });
          bugs = bugs.map(function (entry) { return entry.id === updated.id ? updated : entry; });
          bugSaveEl.textContent = "Saved";
          renderBugs();
        } catch (error) {
          action.disabled = false;
          bugSaveEl.textContent = "Could not save: " + (error && error.message ? error.message : "unknown error");
        }
      });
      item.appendChild(action);
      bugList.appendChild(item);
    }
  }

  function setupBugReporting() {
    for (const test of tests) {
      const option = el("option", "", test.id + " — " + test.title);
      option.value = test.id;
      linkedTestInput.appendChild(option);
    }

    bugForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      if (!canSaveBugs) return;

      const payload = {
        environment: currentEnv,
        title: document.getElementById("qaBugTitle").value,
        severity: document.getElementById("qaBugSeverity").value,
        steps: document.getElementById("qaBugSteps").value,
        expected: document.getElementById("qaBugExpected").value,
        actual: document.getElementById("qaBugActual").value,
        evidence: document.getElementById("qaBugEvidence").value,
        linkedTestId: linkedTestInput.value || null
      };

      setBugSavingEnabled(false);
      bugSaveEl.textContent = "Saving...";
      try {
        const saved = await SmsAuth.apiFetch("/qa/bugs", { method: "POST", body: payload });
        bugs.unshift(saved);
        bugForm.reset();
        bugSaveEl.textContent = "Saved";
        renderBugs();
      } catch (error) {
        bugSaveEl.textContent = "Could not save: " + (error && error.message ? error.message : "unknown error");
      } finally {
        setBugSavingEnabled(canSaveBugs);
      }
    });

    renderBugs();
    if (!canSaveBugs) {
      setBugSavingEnabled(false);
      if (!bugSaveEl.textContent) {
        bugSaveEl.textContent = "This backend is not the Development address, so bug reports are not saved.";
      }
    }
  }
  function applyStatus(status) {
    card.className = "qa-slide qa-slide--" + status;
    badge.textContent = STATUS_LABELS[status];
    badge.className = "qa-badge qa-badge--" + status;
    if (reportBugBtn) reportBugBtn.hidden = status !== "fail";
    for (const key of Object.keys(statusButtons)) {
      statusButtons[key].setAttribute("aria-pressed", String(key === status));
    }
    renderSummary(currentCounts());
  }

  function renderCase() {
    const t = tests[index];
    const r = getResult(t.id);

    counterEl.textContent = "Test " + (index + 1) + " of " + tests.length;
    envTag.textContent = envLabel();
    idEl.textContent = t.id;
    titleEl.textContent = t.title;
    suiteEl.textContent = friendlySuiteLabel(t.suite);

    bodyEl.textContent = "";
    const pre = el("p");
    pre.appendChild(el("strong", "", "Before you start: "));
    pre.appendChild(document.createTextNode(t.prerequisites));
    bodyEl.appendChild(pre);

    bodyEl.appendChild(el("p", "qa-case-label", "Steps"));
    const ol = el("ol");
    for (const step of t.steps) ol.appendChild(el("li", "", step));
    bodyEl.appendChild(ol);

    const exp = el("p");
    exp.appendChild(el("strong", "", "Expected result: "));
    exp.appendChild(document.createTextNode(t.expected));
    bodyEl.appendChild(exp);

    actualInput.value = r.actual;
    notesInput.value = r.notes;
    const state = saveStates.get(resultSaveKey(currentEnv, t.id));
    setSaveMessage(
      state && state.message
        ? state.message
        : lastSaveFailure
          ? lastSaveFailure.message
          : ""
    );
    prevBtn.disabled = index === 0;
    nextBtn.disabled = index === tests.length - 1;
    for (const e of ENVIRONMENTS) {
      envButtons[e.key].setAttribute("aria-pressed", String(e.key === currentEnv));
    }
    applyStatus(r.status);
  }

  function setStatus(status) {
    const environment = currentEnv;
    const id = tests[index].id;
    const r = getResult(id);
    if (r.status === status) return;
    r.status = status;
    applyStatus(r.status);
    const state = saveStateFor(environment, id);
    state.revision += 1;
    state.message = "Unsaved changes...";
    clearTimeout(state.timer);
    state.timer = null;
    updateSaveMessage(state, state.message);
    saveResult(environment, id);
  }

  function go(step) {
    const next = index + step;
    if (next < 0 || next >= tests.length) return;
    flushPending();
    index = next;
    renderCase();
  }

  function labelledTextarea(id, labelText) {
    const wrap = el("div", "qa-field");
    const label = el("label", "qa-case-label", labelText);
    label.htmlFor = id;
    const area = el("textarea", "qa-textarea");
    area.id = id;
    area.rows = 3;
    area.maxLength = 2000;
    wrap.appendChild(label);
    wrap.appendChild(area);
    return { wrap: wrap, area: area };
  }

  async function switchEnvironment(key) {
    if (key === currentEnv) return;
    const target = key === "development" ? DEV_BASE : PROD_BASE;
    if (!target) return;
    const label = key === "development" ? "Development" : "Production";
    const ok = await SmsUI.confirm(
      "Switching to " + label + " logs you out. You will log in again on that backend, then reopen the QA page.",
      { title: "Switch environment", confirmLabel: "Switch and log out" }
    );
    if (!ok) return;
    if (!(await flushPending())) return;
    try { await SmsAuth.apiFetch("/auth/logout", { method: "POST" }); } catch (error) { /* continue anyway */ }
    SmsAuth.clearSession();
    SmsAuth.setApiBase(target);
    window.location.href = "../login/index.html";
  }

  function buildSuites() {
    const list = document.getElementById("qaSuitesList");
    const placeholder = list.nextElementSibling;
    list.textContent = "";

    tests = Array.isArray(window.QA_TEST_CASES) ? window.QA_TEST_CASES : [];
    const gaps = Array.isArray(window.QA_GAPS) ? window.QA_GAPS : [];

    if (tests.length === 0) {
      if (placeholder) placeholder.textContent = "No test cases found.";
      return;
    }
    if (placeholder) placeholder.hidden = true;

    const searchInput = document.getElementById("qaTestSearch");
    const searchStatus = document.getElementById("qaTestSearchStatus");
    const searchResults = document.getElementById("qaTestSearchResults");
    const priorityFilters = document.getElementById("qaPriorityFilters");
    const filterOptions = [
      { key: "all", label: "All" },
      { key: "critical", label: "Critical" },
      { key: "major", label: "Major" },
      { key: "minor", label: "Minor" },
      { key: "cosmetics", label: "Cosmetics" }
    ];

    function renderPriorityFilters() {
      priorityFilters.textContent = "";
      for (const filter of filterOptions) {
        const count = filter.key === "all"
          ? tests.length
          : tests.filter((test) => window.QATestCasePriority(test) === filter.key).length;
        const button = el(
          "button",
          "qa-priority-filter qa-priority-filter--" + filter.key,
          filter.label + " (" + count + ")"
        );
        button.type = "button";
        button.setAttribute("aria-pressed", String(priorityFilter === filter.key));
        button.addEventListener("click", function () {
          priorityFilter = filter.key;
          renderPriorityFilters();
          renderSearchResults();
        });
        priorityFilters.appendChild(button);
      }
    }

    function renderSearchResults() {
      searchResults.textContent = "";
      const query = searchInput.value.trim();
      if (!query && priorityFilter === "all") {
        searchResults.hidden = true;
        searchStatus.textContent = "Type to search or choose a priority category.";
        return;
      }

      const matches = (query
        ? window.QATestCaseSearch(tests, query)
        : tests
      ).filter((test) =>
        priorityFilter === "all" || window.QATestCasePriority(test) === priorityFilter
      );
      searchStatus.textContent = matches.length
        ? matches.length + (matches.length === 1 ? " test case shown." : " test cases shown.")
        : "No test cases match this search and priority category.";
      searchResults.hidden = matches.length === 0;
      for (const test of matches) {
        const item = el("li");
        const itemLabel = test.id + " — " + test.title + " (" + friendlySuiteLabel(test.suite) + ")";
        const button = el(
          "button",
          "qa-search-result",
          itemLabel,
        );
        button.type = "button";
        button.addEventListener("click", async function () {
          if (!(await flushPending())) return;
          const selectedIndex = tests.findIndex((entry) => entry.id === test.id);
          if (selectedIndex < 0) return;
          index = selectedIndex;
          renderCase();
          card.scrollIntoView({ behavior: "smooth", block: "start" });
          idEl.focus({ preventScroll: true });
        });
        item.appendChild(button);
        searchResults.appendChild(item);
      }
    }
    searchInput.addEventListener("input", renderSearchResults);
    renderPriorityFilters();
    renderSearchResults();

    const envBar = el("div", "qa-envbar");
    envBar.appendChild(el("span", "qa-case-label", "Environment:"));
    for (const e of ENVIRONMENTS) {
      const prodOff = e.key === "production" && !PROD_BASE;
      const b = el("button", "qa-env-btn", prodOff ? "Production (not available yet)" : e.label);
      if (prodOff) b.disabled = true;
      b.type = "button";
      b.addEventListener("click", function () { switchEnvironment(e.key); });
      envButtons[e.key] = b;
      envBar.appendChild(b);
    }
    list.appendChild(envBar);
    list.appendChild(el("p", "qa-muted", "Each environment keeps its own results. Results are saved automatically."));

    card = el("article", "qa-slide qa-slide--notrun");
    const top = el("div", "qa-slide-top");
    counterEl = el("span", "qa-slide-counter");
    envTag = el("span", "qa-env-tag");
    badge = el("span", "qa-badge qa-badge--notrun");
    top.appendChild(counterEl);
    top.appendChild(envTag);
    top.appendChild(badge);
    card.appendChild(top);

    idEl = el("p", "qa-slide-id");
    titleEl = el("h3", "qa-slide-title");
    suiteEl = el("p", "qa-muted");
    bodyEl = el("div", "qa-slide-body");
    card.appendChild(idEl);
    card.appendChild(titleEl);
    card.appendChild(suiteEl);
    card.appendChild(bodyEl);

    const actual = labelledTextarea("qaActual", "Actual result");
    const notes = labelledTextarea("qaNotes", "Notes (optional)");
    actualInput = actual.area;
    notesInput = notes.area;
    actualInput.addEventListener("input", function () {
      const id = tests[index].id;
      getResult(id).actual = actualInput.value;
      scheduleSave(id);
    });
    notesInput.addEventListener("input", function () {
      const id = tests[index].id;
      getResult(id).notes = notesInput.value;
      scheduleSave(id);
    });
    card.appendChild(actual.wrap);
    card.appendChild(notes.wrap);

    const statusBar = el("div", "qa-statusbar");
    const defs = [["pass", "Pass"], ["blocked", "Blocked"], ["fail", "Fail"]];
    for (const d of defs) {
      const b = el("button", "qa-status-btn qa-status-btn--" + d[0], d[1]);
      b.type = "button";
      b.addEventListener("click", function () { setStatus(d[0]); });
      statusButtons[d[0]] = b;
      statusBar.appendChild(b);
    }
    card.appendChild(statusBar);
    reportBugBtn = el("button", "qa-nav-btn qa-bug-shortcut", "Report a bug for this failed test");
    reportBugBtn.type = "button";
    reportBugBtn.addEventListener("click", function () {
      linkedTestInput.value = tests[index].id;
      document.getElementById("qaBugTitle").focus();
    });
    card.appendChild(reportBugBtn);

    saveEl = el("p", "qa-muted qa-save-state", "");
    saveEl.setAttribute("aria-live", "polite");
    card.appendChild(saveEl);
    list.appendChild(card);

    if (!canSave) {
      for (const key of Object.keys(statusButtons)) statusButtons[key].disabled = true;
      actualInput.readOnly = true;
      notesInput.readOnly = true;
      setSaveMessage(
        loadFailed
          ? "Could not load saved results, so saving is turned off. Reload the page to try again."
          : "This backend is not the Development address, so results are not saved."
      );
    }

    const nav = el("div", "qa-nav");
    prevBtn = el("button", "qa-nav-btn", "\u2190 Previous");
    nextBtn = el("button", "qa-nav-btn", "Next \u2192");
    prevBtn.type = "button";
    nextBtn.type = "button";
    prevBtn.addEventListener("click", function () { go(-1); });
    nextBtn.addEventListener("click", function () { go(1); });
    nav.appendChild(prevBtn);
    nav.appendChild(nextBtn);
    list.appendChild(nav);

    if (gaps.length > 0) {
      list.appendChild(el("p", "qa-case-label", "Gaps and things not yet tested"));
      const ul = el("ul", "qa-gaps");
      for (const g of gaps) ul.appendChild(el("li", "", g.item));
      list.appendChild(ul);
    }

    renderCase();
  }

  async function start() {
    show(checking);
    try {
      // The backend decides. Only the owner listed in QA_OWNER_EMAILS gets a 200.
      await SmsAuth.apiFetch("/qa/access");
    } catch (error) {
      if (error && error.status === 403) {
        show(denied);
        return;
      }
      errorText.textContent =
        error && error.message
          ? error.message
          : "Something went wrong while checking access.";
      show(errorBox);
      return;
    }
    await loadSavedResults();
    await loadSavedBugs();
    show(content);
    setupWorkspace();
    buildSuites();
    setupBugReporting();
    renderSummary(currentCounts());
  }

  start();
})();