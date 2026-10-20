(function (root) {
  const WIDGETS = Object.freeze([
    { id: "pulse", label: "School pulse", group: "workspace" },
    { id: "attention", label: "Needs your attention", group: "priority" },
    { id: "actions", label: "Quick actions", group: "priority" },
    { id: "attendance", label: "Attendance", group: "analytics" },
    { id: "performance", label: "Academic performance", group: "analytics" },
    { id: "finance", label: "Finance overview", group: "analytics" },
    { id: "activity", label: "Recent activity", group: "lower" },
    { id: "events", label: "Upcoming", group: "lower" },
    { id: "audit", label: "System activity", group: "lower" },
  ]);

  function defaultLayout(widgets = WIDGETS) {
    const order = {};
    for (const widget of widgets) {
      (order[widget.group] ||= []).push(widget.id);
    }
    return { version: 1, order, hidden: [] };
  }

  function normalizeLayout(value, widgets = WIDGETS) {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      value.version !== 1 ||
      !value.order ||
      typeof value.order !== "object" ||
      Array.isArray(value.order) ||
      !Array.isArray(value.hidden)
    ) {
      return null;
    }

    const definitions = new Map(widgets.map((widget) => [widget.id, widget]));
    const order = {};
    for (const widget of widgets) {
      const groupOrder = order[widget.group] || (order[widget.group] = []);
      const savedOrder = value.order[widget.group];
      if (!Array.isArray(savedOrder)) continue;
      for (const id of savedOrder) {
        if (
          typeof id === "string" &&
          definitions.get(id)?.group === widget.group &&
          !groupOrder.includes(id)
        ) {
          groupOrder.push(id);
        }
      }
    }

    for (const widget of widgets) {
      if (!order[widget.group].includes(widget.id)) {
        order[widget.group].push(widget.id);
      }
    }

    return {
      version: 1,
      order,
      hidden: [...new Set(value.hidden)].filter(
        (id) => typeof id === "string" && definitions.has(id),
      ),
    };
  }

  function loadLayout(storage, key, widgets = WIDGETS) {
    const fallback = defaultLayout(widgets);
    try {
      const saved = storage.getItem(key);
      if (saved === null) return { layout: fallback, error: null };
      const normalized = normalizeLayout(JSON.parse(saved), widgets);
      return normalized
        ? { layout: normalized, error: null }
        : { layout: fallback, error: new Error("Saved dashboard layout is invalid.") };
    } catch (error) {
      return { layout: fallback, error };
    }
  }

  function saveLayout(storage, key, layout, widgets = WIDGETS) {
    const normalized = normalizeLayout(layout, widgets);
    if (!normalized) throw new TypeError("Dashboard layout is invalid.");
    storage.setItem(key, JSON.stringify(normalized));
    return normalized;
  }

  function localDateString(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function isCalendarDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return false;
    }
    const date = new Date(`${value}T12:00:00`);
    return Number.isFinite(date.getTime()) && localDateString(date) === value;
  }

  function recordDateString(value) {
    if (typeof value !== "string" || !value) return null;
    const day = value.slice(0, 10);
    if (isCalendarDate(day) && value.length === 10) return day;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? localDateString(date) : null;
  }

  function getAnalyticsRange(preset, start, end, now = new Date()) {
    const today = localDateString(now);
    if (preset === "7" || preset === "30") {
      const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      from.setDate(from.getDate() - (Number(preset) - 1));
      return { from: localDateString(from), to: today, error: null };
    }
    if (preset !== "custom") {
      return { from: null, to: null, error: "Choose a supported analytics date range." };
    }
    if (!isCalendarDate(start) || !isCalendarDate(end)) {
      return { from: null, to: null, error: "Enter a valid start and end date." };
    }
    if (start > end) {
      return { from: null, to: null, error: "The start date must be on or before the end date." };
    }
    return { from: start, to: end, error: null };
  }

  function filterRecordsByRange(records, range, dateFields) {
    const included = [];
    let missingDateCount = 0;
    for (const record of records) {
      const date = dateFields
        .map((field) => record?.[field])
        .find(
          (value) => recordDateString(value) !== null,
        );
      const calendarDate = recordDateString(date);
      if (!calendarDate) {
        missingDateCount += 1;
        continue;
      }
      if (calendarDate >= range.from && calendarDate <= range.to) {
        included.push(record);
      }
    }
    return { records: included, missingDateCount };
  }

  const api = Object.freeze({
    WIDGETS,
    defaultLayout,
    normalizeLayout,
    loadLayout,
    saveLayout,
    getAnalyticsRange,
    filterRecordsByRange,
  });

  root.DashboardState = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window === "undefined" ? globalThis : window);
