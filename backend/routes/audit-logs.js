const express = require("express");
const db = require("../utils/db");
const {
  requireAuth,
  requireRole,
  requirePlatformAdmin,
} = require("../middleware/auth");

const router = express.Router();

router.get(
  "/filters",
  requireAuth,
  requireRole("admin"),
  async (req, res, next) => {
    if (!req.user.schoolId) {
      return res.status(403).json({
        success: false,
        error: {
          code: "SCHOOL_REQUIRED",
          message: "Your account must be linked to a school.",
        },
      });
    }
    try {
      const rows = await db.all(
        "SELECT DISTINCT action FROM audit_logs WHERE school_id = ? AND action IS NOT NULL AND action <> '' ORDER BY action LIMIT 100",
        [req.user.schoolId],
      );
      return res.json({ actions: rows.map((row) => row.action) });
    } catch (error) {
      return next(error);
    }
  },
);

router.get(
  "/platform",
  requireAuth,
  requirePlatformAdmin,
  async (req, res, next) => {
    const page = Number.parseInt(req.query.page || "1", 10);
    const limit = Number.parseInt(req.query.limit || "25", 10);
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100
    ) {
      return res.status(400).json({
        success: false,
        error: {
          code: "INVALID_PAGINATION",
          message: "Page must be positive and limit must be between 1 and 100.",
        },
      });
    }
    try {
      return res.json(await db.listPlatformAuditLogs({ page, limit }));
    } catch (error) {
      return next(error);
    }
  },
);

router.get("/", requireAuth, requireRole("admin"), async (req, res, next) => {
  try {
    if (!req.user.schoolId) {
      return res.status(403).json({
        success: false,
        error: {
          code: "SCHOOL_REQUIRED",
          message: "Your account must be linked to a school.",
        },
      });
    }

    const page = Number.parseInt(req.query.page || "1", 10);
    const limit = Number.parseInt(req.query.limit || "25", 10);
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100
    ) {
      return res.status(400).json({
        success: false,
        error: {
          code: "INVALID_PAGINATION",
          message: "Page must be positive and limit must be between 1 and 100.",
        },
      });
    }

    const dateFilter = (value, fieldName) => {
      if (value === undefined) return null;
      if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
        const error = new Error(`${fieldName} must be a valid date.`);
        error.statusCode = 400;
        error.code = "INVALID_DATE_FILTER";
        throw error;
      }
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const calendarDate = new Date(`${value}T00:00:00.000Z`);
        if (calendarDate.toISOString().slice(0, 10) !== value) {
          const error = new Error(`${fieldName} must be a valid calendar date.`);
          error.statusCode = 400;
          error.code = "INVALID_DATE_FILTER";
          throw error;
        }
      }
      const parsed = new Date(value);
      if (fieldName === "to" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        parsed.setUTCHours(23, 59, 59, 999);
      }
      return parsed.getTime();
    };

    const from = dateFilter(req.query.from, "from");
    const to = dateFilter(req.query.to, "to");
    if (from !== null && to !== null && from > to) {
      return res.status(400).json({
        success: false,
        error: {
          code: "INVALID_DATE_RANGE",
          message: "The start of the date range must not be after its end.",
        },
      });
    }

    const textFilter = (value, fieldName, maxLength) => {
      if (value === undefined) return null;
      if (typeof value !== "string" || value.length > maxLength) {
        const error = new Error(`${fieldName} must be text no longer than ${maxLength} characters.`);
        error.statusCode = 400;
        error.code = "INVALID_AUDIT_FILTER";
        throw error;
      }
      return value.trim() || null;
    };
    const action = textFilter(req.query.action, "Action", 80);
    const entityType = textFilter(req.query.entityType, "Entity", 80);
    const entityId = textFilter(req.query.entityId, "Target", 160);
    const actorUserId = textFilter(req.query.actorUserId, "Actor", 160);
    const timestampRange = {};
    if (from !== null) timestampRange.from = new Date(from).toISOString();
    if (to !== null) timestampRange.to = new Date(to).toISOString();
    const result = await db.listPage("audit-logs", {
      schoolId: req.user.schoolId,
      page,
      limit,
      filters: { action, entityType, entityId, actorUserId },
      rangeFilters: { timestamp: timestampRange },
      sortField: "timestamp",
      descending: true,
    });
    return res.json(result);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        error: { code: error.code, message: error.message },
      });
    }
    return next(error);
  }
});

module.exports = router;
