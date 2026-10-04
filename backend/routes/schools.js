const express = require("express");
const { v4: uuidv4 } = require("uuid");
const db = require("../utils/db");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();
const safe = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

async function ensureAdminSchool(req) {
  if (req.user.schoolId) {
    const existingSchool = await db.findById("schools", req.user.schoolId);
    if (existingSchool) return existingSchool;
  }

  const schoolId = req.user.schoolId || uuidv4();
  const fallbackSchool = await db.findById("schools", schoolId);
  if (!fallbackSchool) {
    await db.insert("schools", {
      id: schoolId,
      name: req.user.name ? `${req.user.name.split(" ")[0]}'s School` : "School",
      createdBy: req.user.id,
      createdAt: new Date().toISOString(),
      settings: {},
      onboardingCompleted: false,
    });
  }

  if (!req.user.schoolId) {
    await db.update("users", req.user.id, { schoolId });
    req.user.schoolId = schoolId;
  }

  return db.findById("schools", schoolId);
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

    const updated = await db.update("schools", school.id, {
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
    res.json({ school: updated });
  }),
);

module.exports = router;