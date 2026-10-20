const assert = require("node:assert/strict");
const test = require("node:test");
const {
  WIDGETS,
  defaultLayout,
  filterRecordsByRange,
  getAnalyticsRange,
  loadLayout,
  saveLayout,
} = require("./dashboard-state");

function memoryStorage(initial = null) {
  let value = initial;
  return {
    getItem: () => value,
    setItem: (_key, next) => {
      value = next;
    },
    value: () => value,
  };
}

test("dashboard layout preferences persist only valid widget configuration", () => {
  const storage = memoryStorage();
  const layout = defaultLayout();
  layout.order.analytics.reverse();
  layout.hidden.push("audit");
  saveLayout(storage, "layout", layout);
  const loaded = loadLayout(storage, "layout");
  assert.equal(loaded.error, null);
  assert.deepEqual(loaded.layout.order.analytics, [
    "finance",
    "performance",
    "attendance",
  ]);
  assert.deepEqual(loaded.layout.hidden, ["audit"]);
  assert.deepEqual(Object.keys(JSON.parse(storage.value())).sort(), [
    "hidden",
    "order",
    "version",
  ]);
});

test("invalid and cross-group dashboard layout data falls back safely", () => {
  const storage = memoryStorage(JSON.stringify({
    version: 1,
    order: { analytics: ["attendance", "audit", "attendance"] },
    hidden: ["unknown", "events"],
  }));
  const result = loadLayout(storage, "layout");
  assert.equal(result.error, null);
  assert.deepEqual(result.layout.order.analytics, [
    "attendance",
    "performance",
    "finance",
  ]);
  assert.deepEqual(result.layout.order.lower, ["activity", "events", "audit"]);
  assert.deepEqual(result.layout.hidden, ["events"]);

  storage.setItem("layout", JSON.stringify({ version: 4 }));
  const fallback = loadLayout(storage, "layout");
  assert.ok(fallback.error);
  assert.deepEqual(fallback.layout, defaultLayout());
});

test("widget definitions have stable unique identifiers", () => {
  assert.equal(new Set(WIDGETS.map((widget) => widget.id)).size, WIDGETS.length);
});

test("analytics presets use local inclusive dates and custom dates are validated", () => {
  const now = new Date(2026, 9, 20, 12);
  assert.deepEqual(getAnalyticsRange("7", "", "", now), {
    from: "2026-10-14",
    to: "2026-10-20",
    error: null,
  });
  assert.deepEqual(getAnalyticsRange("30", "", "", now), {
    from: "2026-09-21",
    to: "2026-10-20",
    error: null,
  });
  assert.ok(getAnalyticsRange("custom", "2026-02-30", "2026-03-01", now).error);
  assert.ok(getAnalyticsRange("custom", "2026-03-02", "2026-03-01", now).error);
  assert.deepEqual(getAnalyticsRange("custom", "2026-03-01", "2026-03-02", now), {
    from: "2026-03-01",
    to: "2026-03-02",
    error: null,
  });
});

test("analytics filters records by real dates and reports unknown timestamps", () => {
  const records = [
    { date: "2026-10-14" },
    { date: "2026-10-20T09:30:00.000Z" },
    { date: "2026-10-13" },
    {},
  ];
  const result = filterRecordsByRange(
    records,
    { from: "2026-10-14", to: "2026-10-20" },
    ["date"],
  );
  assert.deepEqual(result.records, records.slice(0, 2));
  assert.equal(result.missingDateCount, 1);
});
