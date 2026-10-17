const SCHOOL_ADMIN_ROLES = new Set(["admin", "school_admin"]);

const REGISTERABLE_ROLES = Object.freeze([
  "admin",
  "school_admin",
  "teacher",
  "parent",
  "student",
]);

function isSchoolAdmin(user) {
  return Boolean(user && SCHOOL_ADMIN_ROLES.has(user.role));
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Not authenticated." });
    }
    const schoolAdminAccess =
      allowedRoles.some((role) => SCHOOL_ADMIN_ROLES.has(role)) &&
      SCHOOL_ADMIN_ROLES.has(req.user.role);
    if (!allowedRoles.includes(req.user.role) && !schoolAdminAccess) {
      return res
        .status(403)
        .json({
          error: `This action requires one of these roles: ${allowedRoles.join(", ")}.`,
        });
    }
    next();
  };
}

const requirePlatformAdmin = requireRole("super_admin");

module.exports = {
  REGISTERABLE_ROLES,
  isSchoolAdmin,
  requireRole,
  requirePlatformAdmin,
};
