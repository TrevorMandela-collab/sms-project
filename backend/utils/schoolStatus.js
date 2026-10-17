const db = require("./db");

async function isSchoolSuspended(user) {
  if (!user?.schoolId || user.role === "super_admin") return false;
  const school = await db.findById("schools", user.schoolId);
  if (!school) return true;
  return (school.settings?.status || "active") !== "active";
}

module.exports = { isSchoolSuspended };
