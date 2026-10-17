const jwt = require("jsonwebtoken");
const db = require("../utils/db");
const { jwtSecret: JWT_SECRET } = require("../config");
const {
  requireRole,
  requirePlatformAdmin,
  isSchoolAdmin,
} = require("../utils/roles");
const { isSchoolSuspended } = require("../utils/schoolStatus");

const USERS_COLLECTION = "users";

/**
 * Verifies the Bearer token, then checks the account's current suspension
 * status directly in the database — this means a suspension takes effect
 * immediately, even for a token that was issued before the account was
 * suspended (tokens last 7 days, so we can't rely on the token alone).
 * On success, attaches req.user = { id, name, email, role, schoolId, childIds, studentId?, teacherId? }
 */
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "No token provided." });
  }

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: "Invalid or expired token." });
  }

  let authenticatedUser;
  try {
    const user = await db.findById(USERS_COLLECTION, payload.id);
    if (!user) {
      return res.status(401).json({ error: "This account no longer exists." });
    }
    if ((payload.tokenVersion || 0) !== (user.tokenVersion || 0)) {
      return res.status(401).json({ error: "This session is no longer valid." });
    }
    authenticatedUser = user;
    if (user.status === "suspended") {
      const stillSuspended =
        !user.suspendedUntil || new Date(user.suspendedUntil) > new Date();
      if (stillSuspended) {
        return res
          .status(403)
          .json({
            error:
              "This account has been suspended. Contact your school admin.",
          });
      }
      // The suspension's end date has passed — auto-reactivate.
      await db.update(USERS_COLLECTION, user.id, {
        status: "active",
        suspendedUntil: null,
      });
      authenticatedUser = { ...user, status: "active", suspendedUntil: null };
    } else if (user.status && user.status !== "active") {
      return res.status(403).json({
        error: "This account is not active. Contact your school admin.",
      });
    }
    if (await isSchoolSuspended(authenticatedUser)) {
      return res.status(403).json({
        error: "This school is suspended. Contact your platform administrator.",
        code: "SCHOOL_SUSPENDED",
      });
    }
  } catch (err) {
    console.error("[auth] suspension check failed:", err);
    return res
      .status(500)
      .json({ error: "Something went wrong on the server." });
  }

  const { passwordHash, ...safeUser } = authenticatedUser;
  req.user = safeUser;
  next();
}

function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      schoolId: user.schoolId || null,
      childIds: user.childIds || [],
      // Present only for role === 'student' — the linked students record id.
      studentId: user.studentId || null,
      // Present only for role === 'teacher' — the linked teachers record id.
      teacherId: user.teacherId || null,
      tokenVersion: user.tokenVersion || 0,
    },
    JWT_SECRET,
    { expiresIn: "7d" },
  );
}

module.exports = {
  requireAuth,
  requireRole,
  requirePlatformAdmin,
  isSchoolAdmin,
  signToken,
  JWT_SECRET,
};
