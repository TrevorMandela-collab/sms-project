const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const db = require("../utils/db");
const {
  signToken,
  requireAuth,
  requireRole,
} = require("../middleware/auth");
const { REGISTERABLE_ROLES, isSchoolAdmin } = require("../utils/roles");
const {
  authRateLimit,
  loginRateLimit,
  passwordResetRateLimit,
} = require("../middleware/rateLimiter");
const { sendPasswordResetEmail } = require("../utils/email");
const { recordAuditEvent } = require("../utils/auditLog");
const { isSchoolSuspended } = require("../utils/schoolStatus");

const router = express.Router();
const COLLECTION = "users";

// Valid roles for this system
const ROLES = REGISTERABLE_ROLES;
const PASSWORD_MIN_LENGTH = 12;

function passwordIsValid(password) {
  return (
    typeof password === "string" &&
    password.length >= PASSWORD_MIN_LENGTH &&
    Buffer.byteLength(password, "utf8") <= 72
  );
}

// Wraps an async handler so a thrown/rejected error becomes a 500
// instead of an unhandled rejection that hangs the request.
function safe(handler) {
  return (req, res) => {
    handler(req, res).catch((err) => {
      console.error("[auth] request failed:", err);
      const isUniqueViolation = [
        "23505",
        "SQLITE_CONSTRAINT_UNIQUE",
        "SQLITE_CONSTRAINT_PRIMARYKEY",
      ].includes(err.code);
      res.status(isUniqueViolation ? 409 : 500).json({
        success: false,
        error: {
          code: isUniqueViolation ? "DUPLICATE_RECORD" : "INTERNAL_ERROR",
          message: isUniqueViolation
            ? "A record with those details already exists."
            : "The server could not complete that request.",
        },
      });
    });
  };
}

/**
 * POST /api/auth/register
 * Public for the very first admin account; after that, only an
 * admin can create new accounts (enforced below).
 */
router.post(
  "/register",
  authRateLimit,
  safe(async (req, res) => {
    const { name, email, password, role, childIds, teacherId, schoolName } =
      req.body;

    if (!name?.trim() || !email?.trim() || !password || !role) {
      return res
        .status(400)
        .json({ error: "name, email, password, and role are required." });
    }
    if (!ROLES.includes(role)) {
      return res
        .status(400)
        .json({ error: `role must be one of: ${ROLES.join(", ")}` });
    }
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      return res.status(400).json({
        success: false,
        error: {
          code: "INVALID_EMAIL",
          message: "Enter a valid email address.",
        },
      });
    }
    if (!passwordIsValid(password)) {
      return res.status(400).json({
        success: false,
        error: {
          code: "WEAK_PASSWORD",
          message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters and no more than 72 bytes.`,
        },
      });
    }

    let adminSchoolId = null;
    let isAuthorizedAdmin = false;
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (token) {
      let payload;
      try {
        const jwt = require("jsonwebtoken");
        const { JWT_SECRET } = require("../middleware/auth");
        payload = jwt.verify(token, JWT_SECRET);
      } catch {
        payload = null;
      }
      if (payload) {
        const creator = await db.findById(COLLECTION, payload.id);
        if (
          !isSchoolAdmin(creator) ||
          creator.status !== "active" ||
          !creator.schoolId ||
          (payload.tokenVersion || 0) !== (creator.tokenVersion || 0)
        ) {
          return res
            .status(403)
            .json({ error: "Only an admin can create new accounts." });
        }
        adminSchoolId = creator.schoolId;
        if (await isSchoolSuspended(creator)) {
          return res.status(403).json({
            error: "This school is suspended. Contact your platform administrator.",
            code: "SCHOOL_SUSPENDED",
          });
        }
        isAuthorizedAdmin = true;
      }
    }

    const createAccount = async (isFirstUser, schoolIdForAdmin) => {
      if (await db.findUserByEmail(email, { includeDeleted: true })) {
        return {
          status: 409,
          body: { error: "An account with that email already exists." },
        };
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const schoolId = isFirstUser ? crypto.randomUUID() : schoolIdForAdmin;
      const newUser = {
        id: crypto.randomUUID(),
        name,
        email,
        passwordHash,
        role,
        schoolId,
        childIds: role === "parent" ? childIds || [] : [],
        teacherId: role === "teacher" ? teacherId || null : null,
        status: "active",
        suspendedUntil: null,
        tokenVersion: 0,
        createdAt: new Date().toISOString(),
      };

      const sessionToken = signToken(newUser);
      const { passwordHash: _, ...safeUser } = newUser;
      await db.transaction(async () => {
        if (isFirstUser) {
          await db.insert("schools", {
            id: schoolId,
            name: schoolName.trim(),
            createdBy: null,
            createdAt: new Date().toISOString(),
          });
        }
        await db.insert(COLLECTION, newUser);
        if (isFirstUser) {
          await db.update("schools", schoolId, { createdBy: newUser.id });
        }
        await recordAuditEvent(req, {
          action: "USER_CREATED",
          entityType: "user",
          entityId: newUser.id,
          metadata: { role: newUser.role },
          actor: safeUser,
        });
      });
      return {
        status: 201,
        body: { user: safeUser, token: sessionToken, isFirstAdmin: isFirstUser },
      };
    };

    if (!isAuthorizedAdmin) {
      const bootstrap = await db.withBootstrapLock(async () => {
        if ((await db.count(COLLECTION)) !== 0) {
          return {
            status: 403,
            body: {
              error:
                "Only an admin can create new accounts. Log in as admin first.",
            },
          };
        }
        if (role !== "admin") {
          return {
            status: 400,
            body: { error: "The first account must be an admin account." },
          };
        }
        if (!schoolName?.trim()) {
          return {
            status: 400,
            body: {
              error: "schoolName is required when creating the first admin account.",
            },
          };
        }
        return createAccount(true, null);
      });
      return res.status(bootstrap.status).json(bootstrap.body);
    }

    if (await db.findUserByEmail(email, { includeDeleted: true })) {
      return res
        .status(409)
        .json({ error: "An account with that email already exists." });
    }

    if (role === "parent" && childIds !== undefined) {
      if (!Array.isArray(childIds)) {
        return res.status(400).json({ error: "childIds must be an array." });
      }
      const students = await db.findByIds("students", childIds, adminSchoolId);
      const linkedStudents = new Set(students.map((student) => student.id));
      if (!childIds.every((id) => linkedStudents.has(id))) {
        return res.status(404).json({
          error: "One or more selected children were not found in your school.",
        });
      }
    }
    if (role === "teacher" && teacherId) {
      const teacher = await db.findById("teachers", teacherId);
      if (!teacher || teacher.schoolId !== adminSchoolId) {
        return res.status(404).json({
          error: "Teacher record not found in your school.",
        });
      }
    }

    const created = await createAccount(false, adminSchoolId);
    if (created.status !== 201) {
      return res.status(created.status).json(created.body);
    }
    res.status(201).json(created.body);
  }),
);

/**
 * POST /api/auth/register-with-code
 * Public. Redeems a single-use invite code (generated by an admin) to
 * create a login. The invite's own `role` field decides what kind of
 * account gets created — student, teacher, or parent — and carries
 * whatever record-linking info the admin set when generating it.
 */
router.post(
  "/register-with-code",
  authRateLimit,
  safe(async (req, res) => {
    const { code, name, email, password, role: requestedRole } = req.body;
    if (!code || !name || !email || !password) {
      return res
        .status(400)
        .json({ error: "code, name, email, and password are required." });
    }
    if (!passwordIsValid(password)) {
      return res.status(400).json({
        success: false,
        error: {
          code: "WEAK_PASSWORD",
          message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters and no more than 72 bytes.`,
        },
      });
    }

    const invite = await db.findInviteByCode(String(code).trim());
    if (!invite || !invite.schoolId) {
      return res.status(404).json({ error: "Invalid invite code." });
    }
    if (invite.used) {
      return res
        .status(410)
        .json({ error: "This invite code has already been used." });
    }
    if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
      return res.status(410).json({
        error:
          "This invite code has expired. Ask your school admin for a new one.",
      });
    }
    if (await isSchoolSuspended({ role: invite.role || "student", schoolId: invite.schoolId })) {
      return res.status(403).json({
        error: "This school is suspended and cannot accept new accounts.",
        code: "SCHOOL_SUSPENDED",
      });
    }

    // Older invite codes (created before roles were supported) are always students.
    const role = invite.role || "student";
    if (requestedRole && requestedRole !== role) {
      return res
        .status(400)
        .json({ error: `This invite is for a ${role} account.` });
    }

    if (role === "student") {
      const student = await db.findById("students", invite.studentId);
      if (!student || student.schoolId !== invite.schoolId) {
        return res.status(404).json({
          error: "The student record for this code no longer exists.",
        });
      }
    }
    if (role === "teacher" && invite.teacherId) {
      const teacher = await db.findById("teachers", invite.teacherId);
      if (!teacher || teacher.schoolId !== invite.schoolId) {
        return res.status(404).json({
          error: "The teacher record for this code no longer exists.",
        });
      }
    }
    if (role === "parent" && Array.isArray(invite.childIds)) {
      const students = await db.findByIds(
        "students",
        invite.childIds,
        invite.schoolId,
      );
      const linkedStudents = new Set(
        students.map((student) => student.id),
      );
      if (!invite.childIds.every((id) => linkedStudents.has(id))) {
        return res.status(404).json({
          error: "One or more linked students no longer belong to this school.",
        });
      }
    }

    if (await db.findUserByEmail(email, { includeDeleted: true })) {
      return res
        .status(409)
        .json({ error: "An account with that email already exists." });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const newUser = {
      id: crypto.randomUUID(),
      name,
      email,
      passwordHash,
      role,
      schoolId: invite.schoolId || null,
      studentId: role === "student" ? invite.studentId : null,
      teacherId: role === "teacher" ? invite.teacherId || null : null,
      childIds: role === "parent" ? invite.childIds || [] : [],
      status: "active",
      suspendedUntil: null,
      tokenVersion: 0,
      createdAt: new Date().toISOString(),
    };
    const token = signToken(newUser);
    const { passwordHash: _, ...safeUser } = newUser;
    let claimed = false;
    try {
      claimed = await db.transaction(async () => {
        await db.insert(COLLECTION, newUser);
        if (!(await db.claimInvite(invite.id, newUser.id))) {
          const error = new Error("Invite is no longer claimable.");
          error.code = "INVITE_NOT_CLAIMABLE";
          throw error;
        }
        await recordAuditEvent(req, {
          action: "USER_ACTIVATED",
          entityType: "user",
          entityId: newUser.id,
          metadata: { role: newUser.role },
          actor: safeUser,
        });
        return true;
      });
    } catch (error) {
      if (error.code !== "INVITE_NOT_CLAIMABLE") throw error;
    }
    if (!claimed) {
      return res
        .status(410)
        .json({ error: "This invite code has already been used or has expired." });
    }
    res.status(201).json({ user: safeUser, token });
  }),
);

/**
 * POST /api/auth/login
 */
router.post(
  "/login",
  loginRateLimit,
  safe(async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
      return res
        .status(400)
        .json({ error: "email and password are required." });
    }

    const user = await db.findUserByEmail(email);
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const matches = await bcrypt.compare(password, user.passwordHash);
    if (!matches) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    if (user.status === "suspended") {
      const stillSuspended =
        !user.suspendedUntil || new Date(user.suspendedUntil) > new Date();
      if (stillSuspended) {
        const untilMsg = user.suspendedUntil
          ? ` until ${new Date(user.suspendedUntil).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`
          : "";
        return res.status(403).json({
          error: `This account has been suspended${untilMsg}. Contact your school admin.`,
        });
      }
      // The suspension's end date has passed — auto-reactivate before issuing a token.
      await db.update(COLLECTION, user.id, {
        status: "active",
        suspendedUntil: null,
      });
      user.status = "active";
      user.suspendedUntil = null;
    }
    if (user.status && user.status !== "active") {
      return res.status(403).json({
        error: "This account is not active. Contact your school admin.",
      });
    }
    if (await isSchoolSuspended(user)) {
      return res.status(403).json({
        error: "This school is suspended. Contact your platform administrator.",
        code: "SCHOOL_SUSPENDED",
      });
    }

    const token = signToken(user);
    const { passwordHash: _, ...safeUser } = user;
    await recordAuditEvent(req, {
      action: "LOGIN",
      entityType: "user",
      entityId: user.id,
      actor: safeUser,
    });
    res.json({ user: safeUser, token });
  }),
);

/**
 * POST /api/auth/forgot-password
 * Creates a one-time reset token for an email address, without revealing
 * whether the account exists. This is intentionally generic for security.
 */
router.post(
  "/forgot-password",
  passwordResetRateLimit,
  safe(async (req, res) => {
    // Testing/deployment mode: with EMAIL_PROVIDER=disabled no reset email can
    // be delivered, so refuse before touching the database or creating a token.
    // This does not depend on the submitted email, so it reveals nothing about
    // which accounts exist.
    if (process.env.EMAIL_PROVIDER === "disabled") {
      return res.status(503).json({
        success: false,
        error: {
          code: "EMAIL_NOT_CONFIGURED",
          message:
            "Password reset by email is not available on this server. Contact your school administrator.",
        },
      });
    }
    const { email } = req.body || {};
    const normalized = typeof email === "string" ? email.trim().toLowerCase() : "";

    if (!normalized) {
      return res.status(400).json({
        success: false,
        error: {
          code: "MISSING_EMAIL",
          message: "Enter the email address for your account.",
        },
      });
    }

    const user = await db.findUserByEmail(normalized);
    if (!user) {
      return res.json({
        success: true,
        message: "If an account exists for that email, a reset link has been sent.",
      });
    }

    const token = crypto.randomBytes(32).toString("hex");
    const resetRecord = {
      id: crypto.randomUUID(),
      userId: user.id,
      tokenHash: crypto.createHash("sha256").update(token).digest("hex"),
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      used: false,
    };

    await db.transaction(async () => {
      const usedAt = new Date().toISOString();
      await db.markPasswordResetsUsed(user.id, usedAt);
      await db.insert("password-resets", resetRecord);
    });
    try {
      await sendPasswordResetEmail({ email: user.email, name: user.name, token });
    } catch (error) {
      console.error("[auth] password reset email delivery failed:", error.message);
    }

    const response = {
      success: true,
      message: "If an account exists for that email, a reset link has been sent.",
    };
    return res.json(response);
  }),
);

/**
 * POST /api/auth/reset-password
 * Uses a one-time token to set a new password.
 */
router.post(
  "/reset-password",
  passwordResetRateLimit,
  safe(async (req, res) => {
    const { token, password } = req.body || {};

    if (!token || !passwordIsValid(password)) {
      return res.status(400).json({
        success: false,
        error: {
          code: "INVALID_RESET_REQUEST",
          message: `A valid reset token and a password with at least ${PASSWORD_MIN_LENGTH} characters are required.`,
        },
      });
    }

    const tokenHash = crypto.createHash("sha256").update(String(token)).digest("hex");
    const completedReset = await db.completePasswordReset(
      tokenHash,
      await bcrypt.hash(password, 12),
    );
    if (!completedReset) {
      return res.status(410).json({
        success: false,
        error: {
          code: "RESET_TOKEN_INVALID",
          message: "This password reset link is invalid or has expired.",
        },
      });
    }
    const user = completedReset.user;
    await recordAuditEvent(req, {
      action: "PASSWORD_RESET",
      entityType: "user",
      entityId: user.id,
      actor: user,
    });
    return res.json({
      success: true,
      message: "Your password has been updated successfully.",
    });
  }),
);

router.post(
  "/password/change",
  requireAuth,
  authRateLimit,
  safe(async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !passwordIsValid(newPassword)) {
      return res.status(400).json({
        success: false,
        error: {
          code: "INVALID_PASSWORD_CHANGE",
          message: `Provide your current password and a new password of at least ${PASSWORD_MIN_LENGTH} characters.`,
        },
      });
    }

    const user = await db.findById(COLLECTION, req.user.id);
    if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
      return res.status(400).json({
        success: false,
        error: {
          code: "CURRENT_PASSWORD_INVALID",
          message: "The current password is incorrect.",
        },
      });
    }
    if (await bcrypt.compare(newPassword, user.passwordHash)) {
      return res.status(400).json({
        success: false,
        error: {
          code: "PASSWORD_UNCHANGED",
          message: "Choose a new password that differs from your current password.",
        },
      });
    }

    const newPasswordHash = await bcrypt.hash(newPassword, 12);
    await db.transaction(async () => {
      await db.update(COLLECTION, user.id, {
        passwordHash: newPasswordHash,
        tokenVersion: (user.tokenVersion || 0) + 1,
      });
      await recordAuditEvent(req, {
        action: "PASSWORD_CHANGED",
        entityType: "user",
        entityId: user.id,
        actor: user,
      });
    });
    res.json({
      success: true,
      message: "Your password has been changed. Sign in again with the new password.",
    });
  }),
);

/**
 * GET /api/auth/me
 */
router.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

router.patch(
  "/me",
  requireAuth,
  safe(async (req, res) => {
    const body = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return res.status(400).json({
        success: false,
        error: { code: "INVALID_PROFILE", message: "A profile object is required." },
      });
    }
    const allowedFields = new Set(["name", "email"]);
    if (
      Object.keys(body).length === 0 ||
      Object.keys(body).some((field) => !allowedFields.has(field))
    ) {
      return res.status(400).json({
        success: false,
        error: {
          code: "INVALID_PROFILE_FIELDS",
          message: "Only name and email can be updated in your profile.",
        },
      });
    }

    const updates = {};
    if (body.name !== undefined) {
      if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 120) {
        return res.status(400).json({
          success: false,
          error: {
            code: "INVALID_NAME",
            message: "Name must contain 1 to 120 characters.",
          },
        });
      }
      updates.name = body.name.trim();
    }
    if (body.email !== undefined) {
      if (
        typeof body.email !== "string" ||
        body.email.trim().length > 254 ||
        !/^\S+@\S+\.\S+$/.test(body.email.trim())
      ) {
        return res.status(400).json({
          success: false,
          error: {
            code: "INVALID_EMAIL",
            message: "Enter a valid email address.",
          },
        });
      }
      updates.email = body.email.trim().toLowerCase();
    }

    const existing = await db.findById(COLLECTION, req.user.id);
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: { code: "USER_NOT_FOUND", message: "Account not found." },
      });
    }
    if (updates.email && updates.email !== existing.email.toLowerCase()) {
      const account = await db.findUserByEmail(updates.email, { includeDeleted: true });
      if (account && account.id !== existing.id) {
        return res.status(409).json({
          success: false,
          error: {
            code: "EMAIL_ALREADY_IN_USE",
            message: "That email address is already in use.",
          },
        });
      }
    }

    const updated = await db.transaction(async () => {
      const result = await db.update(COLLECTION, existing.id, updates);
      await recordAuditEvent(req, {
        action: "PROFILE_UPDATED",
        entityType: "user",
        entityId: existing.id,
        metadata: { fields: Object.keys(updates) },
        actor: existing,
      });
      return result;
    });
    const { passwordHash, ...safeUser } = updated;
    return res.json({
      success: true,
      user: safeUser,
      message: "Your profile has been updated.",
    });
  }),
);

router.post(
  "/logout",
  requireAuth,
  safe(async (req, res) => {
    await db.transaction(async () => {
      await db.update(COLLECTION, req.user.id, {
        tokenVersion: (req.user.tokenVersion || 0) + 1,
      });
      await recordAuditEvent(req, {
        action: "LOGOUT",
        entityType: "user",
        entityId: req.user.id,
      });
    });
    res.json({
      success: true,
      message: "All active sessions for this account have been invalidated.",
    });
  }),
);

/**
 * GET /api/auth/users  (admin only — manage accounts/roles)
 */
router.get(
  "/users",
  requireAuth,
  requireRole("admin"),
  safe(async (req, res) => {
    const users = (await db.readBySchool(COLLECTION, req.user.schoolId))
      .map(
      ({ passwordHash, ...safe }) => safe,
    );
    res.json(users);
  }),
);

/**
 * PATCH /api/auth/users/:id/role  (admin only)
 */
router.patch(
  "/users/:id/role",
  requireAuth,
  requireRole("admin"),
  safe(async (req, res) => {
    const { role } = req.body;
    if (!ROLES.includes(role)) {
      return res
        .status(400)
        .json({ error: `role must be one of: ${ROLES.join(", ")}` });
    }
    const existing = await db.findById(COLLECTION, req.params.id);
    if (!existing || existing.schoolId !== req.user.schoolId) {
      return res.status(404).json({ error: "User not found." });
    }
    const updated = await db.transaction(async () => {
      const result = await db.update(COLLECTION, req.params.id, {
        role,
        tokenVersion: (existing.tokenVersion || 0) + 1,
      });
      await recordAuditEvent(req, {
        action: "USER_ROLE_UPDATED",
        entityType: "user",
        entityId: existing.id,
        metadata: { role },
      });
      return result;
    });
    const { passwordHash, ...safe } = updated;
    res.json(safe);
  }),
);

/**
 * PATCH /api/auth/users/:id  (admin only)
 * Edit an account's name/email/linked-record fields. Deliberately does
 * NOT accept a password — an admin should never be able to set or see
 * another account's password. If someone's locked out, they use their
 * own "forgot password" flow (not built yet) rather than an admin reset.
 * Also does not change role — use the /role endpoint for that.
 * body: { name?, email?, childIds?, teacherId?, studentId? }
 */
router.patch(
  "/users/:id",
  requireAuth,
  requireRole("admin"),
  safe(async (req, res) => {
    const { name, email, childIds, teacherId, studentId } = req.body;
    const existing = await db.findById(COLLECTION, req.params.id);
    if (!existing || existing.schoolId !== req.user.schoolId) {
      return res.status(404).json({ error: "User not found." });
    }

    if (email && email.toLowerCase() !== existing.email.toLowerCase()) {
      const userWithEmail = await db.findUserByEmail(email, {
        includeDeleted: true,
      });
      if (userWithEmail && userWithEmail.id !== existing.id) {
        return res
          .status(409)
          .json({ error: "Another account already uses that email." });
      }
    }

    const updates = {};
    if (name !== undefined) updates.name = name.trim();
    if (email !== undefined) updates.email = email.trim();
    if (existing.role === "parent" && childIds !== undefined)
      if (Array.isArray(childIds)) {
        const students = await db.findByIds(
          "students",
          childIds,
          req.user.schoolId,
        );
        const linkedStudents = new Set(
          students.map((student) => student.id),
        );
        if (!childIds.every((id) => linkedStudents.has(id))) {
          return res.status(404).json({
            error: "One or more selected children were not found in your school.",
          });
        }
        updates.childIds = childIds;
      } else {
        return res.status(400).json({ error: "childIds must be an array." });
      }
    if (existing.role === "teacher" && teacherId !== undefined)
      if (teacherId) {
        const teacher = await db.findById("teachers", teacherId);
        if (!teacher || teacher.schoolId !== req.user.schoolId) {
          return res.status(404).json({ error: "Teacher record not found." });
        }
        updates.teacherId = teacherId;
      } else {
        updates.teacherId = null;
      }
    if (existing.role === "student" && studentId !== undefined)
      if (studentId) {
        const student = await db.findById("students", studentId);
        if (!student || student.schoolId !== req.user.schoolId) {
          return res.status(404).json({ error: "Student record not found." });
        }
        updates.studentId = studentId;
      } else {
        updates.studentId = null;
      }

    updates.tokenVersion = (existing.tokenVersion || 0) + 1;
    const updated = await db.transaction(async () => {
      const result = await db.update(COLLECTION, req.params.id, updates);
      await recordAuditEvent(req, {
        action: "USER_UPDATED",
        entityType: "user",
        entityId: existing.id,
      });
      return result;
    });
    const { passwordHash: _, ...safeUser } = updated;
    res.json(safeUser);
  }),
);

/**
 * PATCH /api/auth/users/:id/status  (admin only)
 * Suspend, time-out, or reinstate an account.
 * body: { status: 'active' | 'suspended', suspendedUntil?: ISOString|null }
 * Leaving suspendedUntil unset/null on a suspension means "indefinite,
 * until an admin manually reinstates it."
 */
router.patch(
  "/users/:id/status",
  requireAuth,
  requireRole("admin"),
  safe(async (req, res) => {
    if (req.params.id === req.user.id) {
      return res.status(400).json({
        error: "You can't suspend your own account while logged in as it.",
      });
    }
    const { status, suspendedUntil } = req.body;
    if (!["active", "suspended"].includes(status)) {
      return res
        .status(400)
        .json({ error: "status must be 'active' or 'suspended'." });
    }
    if (
      suspendedUntil !== undefined &&
      suspendedUntil !== null &&
      (typeof suspendedUntil !== "string" ||
        Number.isNaN(Date.parse(suspendedUntil)))
    ) {
      return res.status(400).json({
        error: "suspendedUntil must be a valid date or null.",
      });
    }
    const updates = {
      status,
      suspendedUntil: status === "suspended" ? suspendedUntil || null : null,
    };
    const existing = await db.findById(COLLECTION, req.params.id);
    if (!existing || existing.schoolId !== req.user.schoolId) {
      return res.status(404).json({ error: "User not found." });
    }
    updates.tokenVersion = (existing.tokenVersion || 0) + 1;
    const updated = await db.transaction(async () => {
      const result = await db.update(COLLECTION, req.params.id, updates);
      await recordAuditEvent(req, {
        action: status === "suspended" ? "USER_SUSPENDED" : "USER_REACTIVATED",
        entityType: "user",
        entityId: existing.id,
        metadata: status === "suspended" && suspendedUntil
          ? { suspendedUntil }
          : {},
      });
      return result;
    });
    const { passwordHash, ...safeUser } = updated;
    res.json(safeUser);
  }),
);

/**
 * DELETE /api/auth/users/:id  (admin only)
 * Admins can't delete their own account (avoids accidental lockout).
 */
router.delete(
  "/users/:id",
  requireAuth,
  requireRole("admin"),
  safe(async (req, res) => {
    if (req.params.id === req.user.id) {
      return res.status(400).json({
        error: "You can't delete your own account while logged in as it.",
      });
    }
    const existing = await db.findById(COLLECTION, req.params.id);
    if (!existing || existing.schoolId !== req.user.schoolId) {
      return res.status(404).json({ error: "User not found." });
    }
    const removed = await db.transaction(async () => {
      const didRemove = await db.remove(COLLECTION, req.params.id);
      if (!didRemove) return false;
      await recordAuditEvent(req, {
        action: "USER_DELETED",
        entityType: "user",
        entityId: existing.id,
      });
      return true;
    });
    if (!removed) return res.status(404).json({ error: "User not found." });
    res.status(204).end();
  }),
);

module.exports = router;
