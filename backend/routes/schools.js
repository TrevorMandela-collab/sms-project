const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const db = require("../utils/db");
const {
  requireAuth,
  requireRole,
  requirePlatformAdmin,
} = require("../middleware/auth");
const { recordAuditEvent } = require("../utils/auditLog");

const router = express.Router();
const safe = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

async function ensureAdminSchool(req) {
  return db.transaction(async () => {
    if (req.user.schoolId) {
      const existingSchool = await db.findById("schools", req.user.schoolId);
      if (existingSchool) return existingSchool;
    }

    const schoolId = req.user.schoolId || crypto.randomUUID();
    const fallbackSchool = await db.findById("schools", schoolId);
    if (!fallbackSchool) {
      await db.insert("schools", {
        id: schoolId,
        name: req.user.name ? `${req.user.name.split(" ")[0]}'s School` : "School",
        createdBy: req.user.id,
        createdAt: new Date().toISOString(),
        settings: { status: "active" },
        onboardingCompleted: false,
      });
    }

    if (!req.user.schoolId) {
      await db.update("users", req.user.id, { schoolId });
      req.user.schoolId = schoolId;
    }

    return db.findById("schools", schoolId);
  });
}

router.get(
  "/me",
  requireAuth,
  requireRole("admin"),
  safe(async (req, res) => {
    const school = await ensureAdminSchool(req);
    if (!school) return res.status(404).json({ error: "School not found." });
    res.json({ school });
  }),
);

router.patch(
  "/me",
  requireAuth,
  requireRole("admin"),
  safe(async (req, res) => {
    const school = await ensureAdminSchool(req);
    if (!school) return res.status(404).json({ error: "School not found." });

    const {
      name,
      schoolType,
      phone,
      email,
      address,
      academicYear,
      accentColor,
    } = req.body;
    if (name !== undefined && !String(name).trim()) {
      return res.status(400).json({ error: "School name is required." });
    }
    if (accentColor !== undefined && !/^#[\da-f]{6}$/i.test(accentColor)) {
      return res.status(400).json({ error: "Accent color must be a hex color." });
    }

    const updated = await db.transaction(async () => {
      const result = await db.update("schools", school.id, {
        ...(name !== undefined ? { name: String(name).trim() } : {}),
        settings: {
          ...(school.settings || {}),
          ...(schoolType !== undefined
            ? { schoolType: String(schoolType).trim() }
            : {}),
          ...(phone !== undefined ? { phone: String(phone).trim() } : {}),
          ...(email !== undefined ? { email: String(email).trim() } : {}),
          ...(address !== undefined ? { address: String(address).trim() } : {}),
          ...(academicYear !== undefined
            ? { academicYear: String(academicYear).trim() }
            : {}),
          ...(accentColor !== undefined ? { accentColor } : {}),
        },
        onboardingCompleted: req.body.onboardingCompleted === true
          ? true
          : Boolean(school.onboardingCompleted),
      });
      await recordAuditEvent(req, {
        action: "SCHOOL_SETTINGS_UPDATED",
        entityType: "school",
        entityId: school.id,
        metadata: {
          fields: Object.keys(req.body || {}).filter(
            (field) => field !== "onboardingCompleted",
          ),
        },
      });
      return result;
    });
    res.json({ school: updated });
  }),
);

router.get(
  "/platform",
  requireAuth,
  requirePlatformAdmin,
  safe(async (_req, res) => {
    res.json({ schools: await db.readAll("schools") });
  }),
);

router.post(
  "/platform",
  requireAuth,
  requirePlatformAdmin,
  safe(async (req, res) => {
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (!name) return res.status(400).json({ error: "School name is required." });

    const now = new Date().toISOString();
    const school = {
      id: crypto.randomUUID(),
      name,
      createdBy: req.user.id,
      createdAt: now,
      settings: { status: "active" },
      onboardingCompleted: false,
    };
    await db.transaction(async () => {
      await db.insert("schools", school);
      await recordAuditEvent(req, {
        action: "PLATFORM_SCHOOL_CREATED",
        entityType: "school",
        entityId: school.id,
        actor: { ...req.user, schoolId: school.id },
      });
    });
    res.status(201).json({ school });
  }),
);

router.get(
  "/platform/:id",
  requireAuth,
  requirePlatformAdmin,
  safe(async (req, res) => {
    const school = await db.findById("schools", req.params.id);
    if (!school) return res.status(404).json({ error: "School not found." });
    res.json({ school });
  }),
);

router.patch(
  "/platform/:id",
  requireAuth,
  requirePlatformAdmin,
  safe(async (req, res) => {
    const school = await db.findById("schools", req.params.id);
    if (!school) return res.status(404).json({ error: "School not found." });
    const {
      name,
      schoolType,
      phone,
      email,
      address,
      academicYear,
      accentColor,
      lifecycleStatus,
    } = req.body || {};
    if (name !== undefined && (typeof name !== "string" || !name.trim())) {
      return res.status(400).json({ error: "School name is required." });
    }
    if (
      accentColor !== undefined &&
      (typeof accentColor !== "string" || !/^#[\da-f]{6}$/i.test(accentColor))
    ) {
      return res.status(400).json({ error: "Accent color must be a hex color." });
    }
    if (
      lifecycleStatus !== undefined &&
      !["active", "suspended"].includes(lifecycleStatus)
    ) {
      return res.status(400).json({
        error: "School status must be active or suspended.",
      });
    }

    const updated = await db.transaction(async () => {
      const result = await db.update("schools", school.id, {
        ...(name !== undefined ? { name: name.trim() } : {}),
        settings: {
          ...(school.settings || {}),
          ...(schoolType !== undefined
            ? { schoolType: String(schoolType).trim() }
            : {}),
          ...(phone !== undefined ? { phone: String(phone).trim() } : {}),
          ...(email !== undefined ? { email: String(email).trim() } : {}),
          ...(address !== undefined ? { address: String(address).trim() } : {}),
          ...(academicYear !== undefined
            ? { academicYear: String(academicYear).trim() }
            : {}),
          ...(accentColor !== undefined ? { accentColor } : {}),
          ...(lifecycleStatus !== undefined
            ? { status: lifecycleStatus }
            : {}),
        },
      });
      await recordAuditEvent(req, {
        action: "PLATFORM_SCHOOL_UPDATED",
        entityType: "school",
        entityId: school.id,
        metadata: {
          changedFields: [
            ...(name !== undefined ? ["name"] : []),
            ...(schoolType !== undefined ? ["schoolType"] : []),
            ...(phone !== undefined ? ["phone"] : []),
            ...(email !== undefined ? ["email"] : []),
            ...(address !== undefined ? ["address"] : []),
            ...(academicYear !== undefined ? ["academicYear"] : []),
            ...(accentColor !== undefined ? ["accentColor"] : []),
            ...(lifecycleStatus !== undefined ? ["lifecycleStatus"] : []),
          ],
        },
        actor: { ...req.user, schoolId: school.id },
      });
      return result;
    });
    res.json({ school: updated });
  }),
);

router.post(
  "/platform/:id/admins",
  requireAuth,
  requirePlatformAdmin,
  safe(async (req, res) => {
    const school = await db.findById("schools", req.params.id);
    if (!school) return res.status(404).json({ error: "School not found." });

    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const email =
      typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = req.body?.password;
    if (!name || !/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ error: "A name and valid email address are required." });
    }
    if (
      typeof password !== "string" ||
      password.length < 12 ||
      Buffer.byteLength(password, "utf8") > 72
    ) {
      return res.status(400).json({
        error: "Password must be at least 12 characters and no more than 72 UTF-8 bytes.",
      });
    }
    if (await db.findUserByEmail(email, { includeDeleted: true })) {
      return res.status(409).json({ error: "An account with that email already exists." });
    }

    const now = new Date().toISOString();
    const user = {
      id: crypto.randomUUID(),
      name,
      email,
      passwordHash: await bcrypt.hash(password, 12),
      role: "school_admin",
      schoolId: school.id,
      childIds: [],
      teacherId: null,
      status: "active",
      suspendedUntil: null,
      tokenVersion: 0,
      createdAt: now,
    };
    const { passwordHash, ...safeUser } = user;
    try {
      await db.transaction(async () => {
        if (await db.findUserByEmail(email, { includeDeleted: true })) {
        const error = new Error("An account with that email already exists.");
        error.code = "DUPLICATE_ACCOUNT";
        throw error;
        }
        await db.insert("users", user);
        await recordAuditEvent(req, {
        action: "PLATFORM_SCHOOL_ADMIN_CREATED",
        entityType: "user",
        entityId: user.id,
        metadata: { schoolId: school.id, role: user.role },
        actor: { ...req.user, schoolId: school.id },
        });
      });
    } catch (error) {
      if (
        error.code === "DUPLICATE_ACCOUNT" ||
        ["23505", "SQLITE_CONSTRAINT_UNIQUE", "SQLITE_CONSTRAINT_PRIMARYKEY"].includes(
        error.code,
        )
      ) {
        return res.status(409).json({ error: "An account with that email already exists." });
      }
      throw error;
    }

    res.status(201).json({ user: safeUser });
  }),
);

module.exports = router;