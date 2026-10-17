const crypto = require("crypto");
const db = require("./db");

async function recordAuditEvent(
  req,
  { action, entityType, entityId, metadata = {}, actor = req.user },
) {
  if (!actor?.schoolId && actor?.role !== "super_admin") {
    throw new Error("Cannot write a school audit event without an authenticated school.");
  }

  const record = {
    id: crypto.randomUUID(),
    schoolId: actor.schoolId || null,
    actorUserId: actor.id,
    action,
    entityType,
    entityId: entityId || null,
    timestamp: new Date().toISOString(),
    metadata,
    ipAddress: req?.ip || null,
    userAgent: String(req?.get?.("user-agent") || "").slice(0, 512) || null,
  };
  if (actor.role === "super_admin") {
    await db.insertPlatformAuditEvent(record);
    return record;
  }
  await db.insert("audit-logs", record);
  return record;
}

module.exports = { recordAuditEvent };
