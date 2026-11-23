"use strict";

const crypto = require("node:crypto");

function normalizeSchoolEmail(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized && /^\S+@\S+\.\S+$/.test(normalized)
    ? normalized
    : null;
}

function normalizeInternationalPhone(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  if (!/^(?:\+|00)[\d\s().-]+$/.test(trimmed)) return null;
  const digits = trimmed.replace(/\D/g, "");
  const normalized = trimmed.startsWith("00") ? digits.slice(2) : digits;
  if (
    normalized.length < 7 ||
    normalized.length > 15 ||
    normalized.startsWith("0")
  ) {
    return null;
  }
  return normalized;
}

function contactError(code, statusCode = 409) {
  const error = new Error(code);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

async function contactExists(db, contactType, normalizedValue, schoolId = null) {
  const rows = await db.all(
    `SELECT 1 FROM school_contact_identifiers
     WHERE contact_type = $1 AND normalized_value = $2
       AND ($3 IS NULL OR school_id <> $4)
     LIMIT 1`,
    [contactType, normalizedValue, schoolId, schoolId],
  );
  if (rows.length) return true;

  if (contactType === "phone") {
    const unresolvedReviews = await db.all(
      `SELECT 1 FROM school_architecture_reviews
       WHERE contact_type = 'phone'
         AND normalized_value IS NULL
         AND resolved_at IS NULL
         AND ($1 IS NULL OR school_id <> $2)
       LIMIT 1`,
      [schoolId, schoolId],
    );
    if (unresolvedReviews.length) return true;
  }
  return false;
}

async function schoolContactConflict(db, { email = null, phone = null, schoolId = null }) {
  if (
    email &&
    await contactExists(db, "email", email, schoolId)
  ) {
    return true;
  }
  if (
    phone &&
    await contactExists(db, "phone", phone, schoolId)
  ) {
    return true;
  }
  return false;
}

async function reserveSchoolContacts(
  db,
  { schoolId, email = null, phone = null },
) {
  const contacts = [
    ["email", email],
    ["phone", phone],
  ].filter(([, value]) => value);

  for (const [contactType, normalizedValue] of contacts) {
    if (await contactExists(db, contactType, normalizedValue)) {
      throw contactError("SCHOOL_CONTACT_EXISTS");
    }
  }

  const createdAt = new Date().toISOString();
  for (const [contactType, normalizedValue] of contacts) {
    await db.execute(
      `INSERT INTO school_contact_identifiers
         (id, school_id, contact_type, normalized_value, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        crypto.randomUUID(),
        schoolId,
        contactType,
        normalizedValue,
        createdAt,
      ],
    );
  }
}

async function replaceSchoolContact(
  db,
  { schoolId, contactType, normalizedValue },
) {
  if (!["email", "phone"].includes(contactType)) {
    throw new TypeError("Unsupported school contact type.");
  }
  if (
    normalizedValue &&
    await contactExists(db, contactType, normalizedValue, schoolId)
  ) {
    throw contactError("SCHOOL_CONTACT_EXISTS");
  }

  await db.execute(
    "DELETE FROM school_contact_identifiers WHERE school_id = $1 AND contact_type = $2",
    [schoolId, contactType],
  );
  if (normalizedValue) {
    await db.execute(
      `INSERT INTO school_contact_identifiers
         (id, school_id, contact_type, normalized_value, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        crypto.randomUUID(),
        schoolId,
        contactType,
        normalizedValue,
        new Date().toISOString(),
      ],
    );
  }
  await db.execute(
    `UPDATE school_architecture_reviews
     SET resolved_at = $1
     WHERE school_id = $2 AND contact_type = $3 AND resolved_at IS NULL`,
    [new Date().toISOString(), schoolId, contactType],
  );
}

module.exports = {
  normalizeSchoolEmail,
  normalizeInternationalPhone,
  schoolContactConflict,
  reserveSchoolContacts,
  replaceSchoolContact,
};
