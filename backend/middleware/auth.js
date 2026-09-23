const jwt = require("jsonwebtoken");
const db = require("../utils/db");

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
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

  try {
    const user = await db.findById(USERS_COLLECTION, payload.id);
    if (!user) {
      return res.status(401).json({ error: "This account no longer exists." });
    }
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
    }
  } catch (err) {
    console.error("[auth] suspension check failed:", err);
    return res
      .status(500)
      .json({ error: "Something went wrong on the server." });
  }

  req.user = payload;
  next();
}

/**
 * Restricts a route to specific roles.
 * Usage: requireRole('admin', 'teacher')
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Not authenticated." });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res
        .status(403)
        .json({
          error: `This action requires one of these roles: ${allowedRoles.join(", ")}.`,
        });
    }
    next();
  };
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
    },
    JWT_SECRET,
    { expiresIn: "7d" },
  );
}

module.exports = { requireAuth, requireRole, signToken, JWT_SECRET };
