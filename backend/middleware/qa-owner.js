const { requireAuth } = require("./auth");

function allowedEmails() {
  return (process.env.QA_OWNER_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Restricts a route to the owner(s) listed in QA_OWNER_EMAILS.
 * Must run after requireAuth. If the setting is empty, nobody gets in.
 */
function requireQaOwner(req, res, next) {
  const email = String(req.user?.email || "").trim().toLowerCase();
  if (!email || !allowedEmails().includes(email)) {
    return res
      .status(403)
      .json({ error: "You do not have access to this resource." });
  }
  return next();
}

module.exports = { requireAuth, requireQaOwner };