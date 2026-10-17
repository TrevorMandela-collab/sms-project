(function () {
  if (document.getElementById("mandelaCommandPalette")) return;

  const style = document.createElement("link");
  style.rel = "stylesheet";
  style.href = new URL("./command-palette.css", document.currentScript.src).href;
  document.head.appendChild(style);

  const dialog = document.createElement("div");
  dialog.className = "mandela-command-backdrop";
  dialog.id = "mandelaCommandPalette";
  dialog.hidden = true;
  dialog.innerHTML = `
    <section class="mandela-command-dialog" role="dialog" aria-modal="true" aria-labelledby="mandelaCommandTitle">
      <div class="mandela-command-heading">
        <div>
          <p>MANDELA SMS · SEARCH</p>
          <h2 id="mandelaCommandTitle">Find a page or record</h2>
        </div>
        <button class="mandela-command-close" type="button" aria-label="Close search">Esc</button>
      </div>
      <label class="mandela-command-label" for="mandelaCommandInput">Search accessible school records</label>
      <input id="mandelaCommandInput" type="search" autocomplete="off" placeholder="Type a name, class, or fee status…" />
      <div class="mandela-command-help"><span>↑ ↓ navigate</span><span>Enter open</span><span>Esc close</span></div>
      <div class="mandela-command-results" id="mandelaCommandResults" role="listbox" aria-label="Search results"></div>
      <p class="mandela-command-error" id="mandelaCommandError" role="status" hidden></p>
    </section>`;
  document.body.appendChild(dialog);

  const input = dialog.querySelector("#mandelaCommandInput");
  const results = dialog.querySelector("#mandelaCommandResults");
  const errorMessage = dialog.querySelector("#mandelaCommandError");
  const closeButton = dialog.querySelector(".mandela-command-close");
  let previousFocus = null;
  let resultButtons = [];
  let activeIndex = -1;
  let searchTimer = null;
  let searchSequence = 0;

  function userAllowedRoutes() {
    const role = SmsAuth.getUser()?.role;
    const routes = [{ path: "/students", label: "Students", type: "Student", url: "../students/index.html" }];
    if (role === "admin" || role === "school_admin" || role === "teacher") {
      routes.push({ path: "/teachers", label: "Teachers", type: "Teacher", url: "../teachers/index.html" });
    }
    if (role === "admin" || role === "school_admin") {
      routes.push({ path: "/fees", label: "Fees", type: "Fee", url: "../fees/index.html" });
    }
    if (role === "super_admin") {
      routes.push({
        path: "/schools/platform",
        label: "Schools",
        type: "School",
        url: "../platform/index.html",
      });
    }
    return routes;
  }

  function activeNavigationItems() {
    return [...document.querySelectorAll("#sidebarSlot .sidebar-link")].map((link) => ({
      label: link.textContent.trim(),
      type: "Page",
      url: link.href,
    }));
  }

  function appendResult(item, index) {
    const button = document.createElement("button");
    button.className = "mandela-command-result";
    button.type = "button";
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", "false");
    button.dataset.index = String(index);
    button.dataset.url = item.url;
    const title = document.createElement("strong");
    title.textContent = item.label;
    const type = document.createElement("small");
    type.textContent = item.type;
    button.append(title, type);
    button.addEventListener("click", () => {
      window.location.href = item.url;
    });
    results.appendChild(button);
    resultButtons.push(button);
  }

  function renderResults(items) {
    results.replaceChildren();
    resultButtons = [];
    activeIndex = -1;
    for (const [index, item] of items.entries()) appendResult(item, index);
    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "mandela-command-empty";
      empty.textContent = "No matching pages or records.";
      results.appendChild(empty);
    }
  }

  function setActive(index) {
    if (!resultButtons.length) return;
    activeIndex = (index + resultButtons.length) % resultButtons.length;
    resultButtons.forEach((button, buttonIndex) => {
      const selected = buttonIndex === activeIndex;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-selected", String(selected));
    });
    resultButtons[activeIndex].scrollIntoView({ block: "nearest" });
  }

  async function searchRecords(query, sequence) {
    const routes = userAllowedRoutes();
    const responses = await Promise.allSettled(
      routes.map(async (route) => {
        const url = `${route.path}?search=${encodeURIComponent(query)}&page=1&limit=8`;
        const response = await SmsAuth.apiFetch(url);
        const records = Array.isArray(response)
          ? response
          : Array.isArray(response?.data)
            ? response.data
            : Array.isArray(response?.schools)
              ? response.schools
              : [];
        if (!Array.isArray(records)) return [];
        const searchableRecords =
          route.path === "/schools/platform"
            ? records.filter((record) =>
                String(record.name || "")
                  .toLocaleLowerCase()
                  .includes(query.toLocaleLowerCase()),
              )
            : records;
        return searchableRecords.map((record) => ({
          label: record.name || record.studentName || record.title || record.status || route.label,
          type: route.type,
          url: route.url,
        }));
      }),
    );
    if (sequence !== searchSequence) return;
    const matches = responses.flatMap((response) =>
      response.status === "fulfilled" ? response.value : [],
    );
    const failureCount = responses.filter((response) => response.status === "rejected").length;
    errorMessage.hidden = false;
    if (failureCount === responses.length) {
      errorMessage.textContent = "Search is unavailable right now. Check your connection and try again.";
      return;
    }
    errorMessage.hidden = true;
    const pages = activeNavigationItems()
      .filter((item) => item.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
      .map((item) => ({ ...item }));
    const uniqueRecords = new Map();
    for (const record of matches) {
      const key = `${record.type}:${record.label}:${record.url}`;
      if (!uniqueRecords.has(key)) uniqueRecords.set(key, record);
    }
    renderResults([...pages, ...uniqueRecords.values()].slice(0, 20));
  }

  function showQuickLinks() {
    const links = activeNavigationItems().map((item) => ({ ...item }));
    errorMessage.hidden = true;
    renderResults(links.slice(0, 12));
  }

  function openPalette() {
    previousFocus = document.activeElement;
    dialog.hidden = false;
    document.body.classList.add("mandela-command-open");
    input.value = "";
    showQuickLinks();
    input.focus();
  }

  function closePalette() {
    dialog.hidden = true;
    document.body.classList.remove("mandela-command-open");
    if (previousFocus instanceof HTMLElement) previousFocus.focus();
  }

  input.addEventListener("input", () => {
    clearTimeout(searchTimer);
    const query = input.value.trim();
    if (!query) {
      showQuickLinks();
      return;
    }
    const sequence = ++searchSequence;
    results.replaceChildren();
    const loading = document.createElement("p");
    loading.className = "mandela-command-empty";
    loading.textContent = "Searching school records…";
    results.appendChild(loading);
    searchTimer = setTimeout(() => {
      searchRecords(query, sequence).catch(() => {
        if (sequence !== searchSequence) return;
        errorMessage.textContent = "Search failed. Check your connection and try again.";
        errorMessage.hidden = false;
        renderResults([]);
      });
    }, 180);
  });

  closeButton.addEventListener("click", closePalette);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closePalette();
  });
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openPalette();
      return;
    }
    if (dialog.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closePalette();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive(activeIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive(activeIndex < 0 ? resultButtons.length - 1 : activeIndex - 1);
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      resultButtons[activeIndex].click();
    } else if (event.key === "Tab") {
      const focusables = [...dialog.querySelectorAll("button, input")].filter(
        (element) => !element.disabled,
      );
      if (event.shiftKey && document.activeElement === focusables[0]) {
        event.preventDefault();
        focusables.at(-1).focus();
      } else if (!event.shiftKey && document.activeElement === focusables.at(-1)) {
        event.preventDefault();
        focusables[0].focus();
      }
    }
  });

  document.getElementById("mandelaCommandTrigger")?.addEventListener(
    "click",
    openPalette,
  );
})();
