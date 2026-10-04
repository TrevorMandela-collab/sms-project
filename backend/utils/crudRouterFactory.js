const express = require("express");
const crypto = require("crypto");
const db = require("./db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { recordAuditEvent } = require("./auditLog");

/**
 * Builds a collection CRUD router with role scoping, tenant isolation,
 * protected metadata fields, optional validation, and opt-in list queries.
 */
function createCrudRouter(collection, options = {}) {
  const router = express.Router();
  const permissions = {
    create: options.permissions?.create || ["admin"],
    read: options.permissions?.read || ["admin", "teacher", "parent"],
    update: options.permissions?.update || ["admin"],
    delete: options.permissions?.delete || ["admin"],
  };

  if (options.seed) {
    db.ensureFile(collection, options.seed).catch((error) => {
      console.error(`[${collection}] failed to seed:`, error.message);
    });
  }

  async function applyScope(records, user) {
    if (!user.schoolId) return [];
    const schoolRecords = records.filter(
      (record) => record.schoolId === user.schoolId,
    );
    if (user.role === "parent" && options.scopeForParent)
      return options.scopeForParent(schoolRecords, user);
    if (user.role === "student" && options.scopeForStudent)
      return options.scopeForStudent(schoolRecords, user);
    if (user.role === "teacher" && options.scopeForTeacher)
      return options.scopeForTeacher(schoolRecords, user);
    return schoolRecords;
  }

  async function teacherMayWrite(candidate, user) {
    if (user.role !== "teacher" || !options.writeGuardForTeacher) return true;
    return options.writeGuardForTeacher(candidate, user);
  }

  function sendError(res, error) {
    const status = Number(error.statusCode) || 500;
    const code =
      error.code || (status >= 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR");
    if (status >= 500) console.error(`[${collection}] request failed:`, error);
    res.status(status).json({
      success: false,
      error: {
        code,
        message:
          status >= 500
            ? "The server could not complete that request."
            : error.message,
      },
    });
  }

  function safe(handler) {
    return (req, res) =>
      handler(req, res).catch((error) => sendError(res, error));
  }

  function queryRecords(records, req) {
    let result = records;
    const search = String(req.query.search || "")
      .trim()
      .toLowerCase();
    if (search && Array.isArray(options.searchFields)) {
      result = result.filter((record) =>
        options.searchFields.some((field) =>
          String(record[field] ?? "")
            .toLowerCase()
            .includes(search),
        ),
      );
    }
    if (Array.isArray(options.filterFields)) {
      result = result.filter((record) =>
        options.filterFields.every((field) => {
          const value = req.query[`filter[${field}]`];
          return (
            value === undefined || String(record[field] ?? "") === String(value)
          );
        }),
      );
    }
    const sort = String(req.query.sort || "").trim();
    if (sort) {
      const descending = sort.startsWith("-");
      const field = descending ? sort.slice(1) : sort;
      if (options.sortFields?.includes(field)) {
        result = [...result].sort((leftRecord, rightRecord) => {
          const left = String(leftRecord[field] ?? "").toLowerCase();
          const right = String(rightRecord[field] ?? "").toLowerCase();
          return (
            (left > right ? 1 : left < right ? -1 : 0) * (descending ? -1 : 1)
          );
        });
      }
    }
    return result;
  }

  function paginate(records, req) {
    if (req.query.page === undefined && req.query.limit === undefined)
      return records;
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, Number.parseInt(req.query.limit, 10) || 25),
    );
    return {
      data: records.slice((page - 1) * limit, page * limit),
      meta: {
        page,
        limit,
        total: records.length,
        pages: Math.ceil(records.length / limit),
      },
    };
  }

  // ---- LIST ----
  router.get(
    "/",
    requireAuth,
    requireRole(...permissions.read),
    safe(async (req, res) => {
      const records = queryRecords(
        await applyScope(await db.readAll(collection), req.user),
        req,
      );
      res.json(paginate(records, req));
    }),
  );

  // ---- GET ONE ----
  router.get(
    "/:id",
    requireAuth,
    requireRole(...permissions.read),
    safe(async (req, res) => {
      const record = await db.findById(collection, req.params.id);
      if (!record)
        return res
          .status(404)
          .json({
            success: false,
            error: {
              code: "NOT_FOUND",
              message: `${collection} record not found.`,
            },
          });
      if (!(await applyScope([record], req.user)).length) {
        return res
          .status(404)
          .json({
            success: false,
            error: {
              code: "NOT_FOUND",
              message: `${collection} record not found.`,
            },
          });
      }
      res.json(record);
    }),
  );

  // ---- CREATE ----
  router.post(
    "/",
    requireAuth,
    requireRole(...permissions.create),
    safe(async (req, res) => {
      if (!req.user.schoolId) {
        return res.status(403).json({
          success: false,
          error: {
            code: "SCHOOL_REQUIRED",
            message: "Your account must be linked to a school to create records.",
          },
        });
      }
      const {
        id,
        createdAt,
        createdBy,
        updatedAt,
        updatedBy,
        schoolId,
        ...input
      } = req.body || {};
      const candidate = { ...input, schoolId: req.user.schoolId };
      if (options.validate)
        await options.validate(candidate, {
          operation: "create",
          user: req.user,
        });
      if (!(await teacherMayWrite(candidate, req.user))) {
        return res
          .status(403)
          .json({
            success: false,
            error: {
              code: "OUT_OF_SCOPE",
              message: "You can only add records for your assigned class.",
            },
          });
      }
      const record = {
        id: crypto.randomUUID(),
        ...candidate,
        createdAt: new Date().toISOString(),
        createdBy: req.user.id,
      };
      await db.insert(collection, record);
      await recordAuditEvent(req, {
        action: `${collection.toUpperCase().replace(/-/g, "_")}_CREATED`,
        entityType: collection,
        entityId: record.id,
      });
      res.status(201).json(record);
    }),
  );

  // ---- UPDATE ----
  router.patch(
    "/:id",
    requireAuth,
    requireRole(...permissions.update),
    safe(async (req, res) => {
      const existing = await db.findById(collection, req.params.id);
      if (!existing)
        return res
          .status(404)
          .json({
            success: false,
            error: {
              code: "NOT_FOUND",
              message: `${collection} record not found.`,
            },
          });
      if (!(await applyScope([existing], req.user)).length) {
        return res
          .status(404)
          .json({
            success: false,
            error: {
              code: "NOT_FOUND",
              message: `${collection} record not found.`,
            },
          });
      }
      const {
        id,
        createdAt,
        createdBy,
        updatedAt,
        updatedBy,
        schoolId,
        ...input
      } = req.body || {};
      const candidate = { ...existing, ...input };
      if (options.validate)
        await options.validate(candidate, {
          operation: "update",
          user: req.user,
          existing,
        });
      if (!(await teacherMayWrite(candidate, req.user))) {
        return res
          .status(403)
          .json({
            success: false,
            error: {
              code: "OUT_OF_SCOPE",
              message: "You can only modify records for your assigned class.",
            },
          });
      }
      const updated = await db.update(collection, req.params.id, {
        ...input,
        updatedAt: new Date().toISOString(),
        updatedBy: req.user.id,
      });
      await recordAuditEvent(req, {
        action: `${collection.toUpperCase().replace(/-/g, "_")}_UPDATED`,
        entityType: collection,
        entityId: req.params.id,
      });
      res.json(updated);
    }),
  );

  // ---- DELETE ----
  router.delete(
    "/:id",
    requireAuth,
    requireRole(...permissions.delete),
    safe(async (req, res) => {
      const existing = await db.findById(collection, req.params.id);
      if (!existing)
        return res
          .status(404)
          .json({
            success: false,
            error: {
              code: "NOT_FOUND",
              message: `${collection} record not found.`,
            },
          });
      if (!(await applyScope([existing], req.user)).length) {
        return res
          .status(404)
          .json({
            success: false,
            error: {
              code: "NOT_FOUND",
              message: `${collection} record not found.`,
            },
          });
      }
      if (!(await teacherMayWrite(existing, req.user))) {
        return res
          .status(403)
          .json({
            success: false,
            error: {
              code: "OUT_OF_SCOPE",
              message: "You can only delete records for your assigned class.",
            },
          });
      }
      const removed = await db.remove(collection, req.params.id);
      if (!removed)
        return res
          .status(404)
          .json({
            success: false,
            error: {
              code: "NOT_FOUND",
              message: `${collection} record not found.`,
            },
          });
      await recordAuditEvent(req, {
        action: `${collection.toUpperCase().replace(/-/g, "_")}_DELETED`,
        entityType: collection,
        entityId: req.params.id,
      });
      res.status(204).end();
    }),
  );

  return router;
}

module.exports = createCrudRouter;
