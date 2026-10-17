const assert = require("assert");
const Module = require("module");
const path = require("path");
const express = require("express");
const { requireRole } = require("../utils/roles");

const routePath = path.resolve(
  __dirname,
  "..",
  "utils",
  "crudRouterFactory.js",
);
const records = [
  { id: "school-a-record", schoolId: "school-a", name: "School A record" },
  { id: "school-b-record", schoolId: "school-b", name: "School B record" },
];
const auditEvents = [];
const database = {
  readBySchool: async (collection, schoolId) => {
    assert.equal(collection, "isolation-records");
    return records.filter((record) => record.schoolId === schoolId);
  },
  listPage: async (collection, options) => {
    assert.equal(collection, "isolation-records");
    assert.equal(options.schoolId, "school-a");
    const matching = records.filter((record) => {
      if (record.schoolId !== options.schoolId) return false;
      if (options.search && !record.name.includes(options.search)) return false;
      return Object.entries(options.filters).every(
        ([key, value]) => String(record[key] ?? "") === String(value),
      );
    });
    return {
      data: matching.slice((options.page - 1) * options.limit, options.page * options.limit),
      meta: {
        page: options.page,
        limit: options.limit,
        total: matching.length,
        pages: Math.ceil(matching.length / options.limit),
      },
    };
  },
  findById: async (_collection, id) =>
    records.find((record) => record.id === id) || null,
  insert: async (_collection, record) => {
    records.push(record);
    return record;
  },
  update: async (_collection, id, changes) => {
    const index = records.findIndex((record) => record.id === id);
    records[index] = { ...records[index], ...changes };
    return records[index];
  },
  remove: async (_collection, id) => {
    const index = records.findIndex((record) => record.id === id);
    if (index < 0) return false;
    records.splice(index, 1);
    return true;
  },
  transaction: async (operation) => operation(),
};

async function run() {
  const originalLoad = Module._load;
  let server;
  try {
    Module._load = function loadWithRouterStubs(request, parent, isMain) {
      if (parent?.filename === routePath && request === "./db") return database;
      if (parent?.filename === routePath && request === "../middleware/auth") {
        return {
          requireAuth: (_req, _res, next) => next(),
          requireRole,
        };
      }
      if (parent?.filename === routePath && request === "./roles") {
        return require("../utils/roles");
      }
      if (parent?.filename === routePath && request === "./auditLog") {
        return {
          recordAuditEvent: async (_req, event) => auditEvents.push(event),
        };
      }
      return originalLoad.call(this, request, parent, isMain);
    };

    delete require.cache[routePath];
    const createCrudRouter = require(routePath);
    const router = createCrudRouter("isolation-records", {
      permissions: {
        create: ["admin"],
        read: ["admin"],
        update: ["admin"],
        delete: ["admin"],
      },
      requiredFields: ["name"],
      searchFields: ["name"],
      filterFields: ["name"],
      sortFields: ["name"],
    });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = {
        id: "school-a-admin",
        name: "School A Admin",
        role: req.get("x-test-role") || "school_admin",
        schoolId: req.get("x-test-school") ?? "school-a",
      };
      next();
    });
    app.use("/api/records", router);
    server = await new Promise((resolve) => {
      const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}/api/records`;
    const request = (url = "", options = {}) =>
      fetch(`${baseUrl}${url}`, {
        ...options,
        headers: {
          "content-type": "application/json",
          ...(options.headers || {}),
        },
      });

    const list = await request();
    assert.equal(list.status, 200);
    assert.deepEqual(
      (await list.json()).map((record) => record.id),
      ["school-a-record"],
      "school admins must only list records from their own school",
    );

    const pagedList = await request("?page=1&limit=10", {
      headers: { "x-test-role": "school_admin" },
    });
    assert.equal(pagedList.status, 200);
    assert.deepEqual(
      (await pagedList.json()).data.map((record) => record.id),
      ["school-a-record"],
      "paginated queries must apply the authenticated school scope",
    );

    for (const [method, suffix] of [
      ["GET", ""],
      ["PATCH", ""],
      ["DELETE", ""],
    ]) {
      const response = await request(`/school-b-record${suffix}`, {
        method,
        body: method === "PATCH" ? JSON.stringify({ name: "stolen" }) : undefined,
      });
      assert.equal(response.status, 404, `${method} must hide another school's record`);
    }
    assert.equal(
      records.find((record) => record.id === "school-b-record").name,
      "School B record",
      "cross-school updates and deletes must leave the foreign record untouched",
    );

    const created = await request("", {
      method: "POST",
      body: JSON.stringify({
        name: "Created by School A",
        schoolId: "school-b",
        id: "attacker-chosen-id",
        createdBy: "attacker",
      }),
    });
    assert.equal(created.status, 201);
    const createdRecord = await created.json();
    assert.equal(createdRecord.schoolId, "school-a");
    assert.notEqual(createdRecord.id, "attacker-chosen-id");
    assert.equal(createdRecord.createdBy, "school-a-admin");

    const updated = await request("/school-a-record", {
      method: "PATCH",
      body: JSON.stringify({ name: "Updated by A", schoolId: "school-b" }),
    });
    assert.equal(updated.status, 200);
    assert.equal((await updated.json()).schoolId, "school-a");

    const deniedRole = await request("", {
      headers: { "x-test-role": "teacher" },
    });
    assert.equal(deniedRole.status, 403);

    const noSchool = await request("", {
      headers: { "x-test-school": "" },
    });
    assert.equal(noSchool.status, 200);
    assert.deepEqual(await noSchool.json(), []);

    assert.ok(auditEvents.some((event) => event.action === "ISOLATION_RECORDS_CREATED"));
    assert.ok(auditEvents.some((event) => event.action === "ISOLATION_RECORDS_UPDATED"));
    console.log("CRUD tenant isolation tests passed");
  } finally {
    if (server) {
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
    delete require.cache[routePath];
    Module._load = originalLoad;
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
