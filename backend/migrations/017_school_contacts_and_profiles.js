"use strict";

const crypto = require("node:crypto");
const {
  normalizeSchoolEmail,
  normalizeInternationalPhone,
} = require("../utils/schoolContacts");

const SCHOOL_ROLES = ["admin", "school_admin", "teacher", "parent", "student"];
const SCHOOL_PROFILE_COLUMNS = new Set([
  "student_id",
  "teacher_id",
  "guardian_id",
]);

function roleConstraintSql() {
  return SCHOOL_ROLES.map((role) => `'${role}'`).join(", ");
}

function sqlParameter(dialect, index) {
  return dialect === "postgres" ? `$${index}` : "?";
}

async function ensureMembershipRoleConstraint({ execute, dialect }) {
  if (dialect === "postgres") {
    await execute(`
      CREATE OR REPLACE FUNCTION validate_school_membership_role_fn()
      RETURNS trigger LANGUAGE plpgsql AS $body$
      BEGIN
        IF NEW.role_code NOT IN (${roleConstraintSql()}) THEN
          RAISE EXCEPTION 'invalid school membership role'
            USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $body$;
    `);
    await execute("DROP TRIGGER IF EXISTS validate_school_membership_role ON school_memberships");
    await execute(`
      CREATE TRIGGER validate_school_membership_role
      BEFORE INSERT OR UPDATE OF role_code ON school_memberships
      FOR EACH ROW EXECUTE FUNCTION validate_school_membership_role_fn()
    `);
    return;
  }

  const allowed = roleConstraintSql();
  for (const operation of ["INSERT", "UPDATE"]) {
    const suffix = operation.toLowerCase();
    await execute(`
      CREATE TRIGGER IF NOT EXISTS validate_school_membership_role_${suffix}
      BEFORE ${operation} ON school_memberships
      WHEN NEW.role_code NOT IN (${allowed})
      BEGIN
        SELECT RAISE(ABORT, 'invalid school membership role');
      END
    `);
  }
}

async function recordReview(execute, dialect, {
  schoolId,
  userId = null,
  contactType = null,
  profileType = null,
  relatedRecordId = null,
  normalizedValue = null,
  reason,
  createdAt,
}) {
  const entityKey = [
    schoolId,
    userId || "",
    contactType || "",
    profileType || "",
    relatedRecordId || "",
    reason,
  ]
    .join(":");
  const id = `review:${crypto.createHash("sha256").update(entityKey).digest("hex")}`;
  await execute(
    `INSERT INTO school_architecture_reviews
       (id, school_id, user_id, contact_type, profile_type, related_record_id, normalized_value, reason, created_at)
     VALUES (
       ${sqlParameter(dialect, 1)}, ${sqlParameter(dialect, 2)}, ${sqlParameter(dialect, 3)},
       ${sqlParameter(dialect, 4)}, ${sqlParameter(dialect, 5)}, ${sqlParameter(dialect, 6)},
       ${sqlParameter(dialect, 7)}, ${sqlParameter(dialect, 8)}, ${sqlParameter(dialect, 9)}
     )
     ON CONFLICT (id) DO NOTHING`,
    [
      id,
      schoolId,
      userId,
      contactType,
      profileType,
      relatedRecordId,
      normalizedValue,
      reason,
      createdAt,
    ],
  );
}

function settingsFromRow(value) {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" ? value : {};
}

function extraDataFromRow(value) {
  return settingsFromRow(value);
}

async function migrateLegacyContacts({ execute, all, dialect }) {
  const schools = await all("SELECT id, settings_json FROM schools ORDER BY id");
  const values = [];
  const reviews = [];
  for (const school of schools) {
    const settings = settingsFromRow(school.settings_json);
    const rawEmail = typeof settings.email === "string" ? settings.email.trim() : "";
    const rawPhone = typeof settings.phone === "string" ? settings.phone.trim() : "";
    const email = rawEmail ? normalizeSchoolEmail(rawEmail) : null;
    const phone = rawPhone ? normalizeInternationalPhone(rawPhone) : null;
    if (rawEmail && !email) {
      reviews.push({
        schoolId: school.id,
        contactType: "email",
        reason: "legacy_email_requires_review",
        normalizedValue: null,
      });
    } else if (email) {
      values.push({ schoolId: school.id, contactType: "email", normalizedValue: email });
    }
    if (rawPhone && !phone) {
      reviews.push({
        schoolId: school.id,
        contactType: "phone",
        reason: "legacy_phone_requires_review",
        normalizedValue: null,
      });
    } else if (phone) {
      values.push({ schoolId: school.id, contactType: "phone", normalizedValue: phone });
    }
  }

  const groups = new Map();
  for (const value of values) {
    const key = `${value.contactType}:${value.normalizedValue}`;
    const group = groups.get(key) || [];
    group.push(value);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    if (group.length > 1) {
      for (const item of group) {
        reviews.push({
          ...item,
          reason: "duplicate_legacy_contact_requires_review",
        });
      }
    }
    const [keeper] = group;
    await execute(
      `INSERT INTO school_contact_identifiers
         (id, school_id, contact_type, normalized_value, created_at)
       VALUES (
         ${sqlParameter(dialect, 1)}, ${sqlParameter(dialect, 2)}, ${sqlParameter(dialect, 3)},
         ${sqlParameter(dialect, 4)}, ${sqlParameter(dialect, 5)}
       )
       ON CONFLICT (contact_type, normalized_value) DO NOTHING`,
      [
        `legacy:${keeper.contactType}:${keeper.schoolId}`,
        keeper.schoolId,
        keeper.contactType,
        keeper.normalizedValue,
        new Date().toISOString(),
      ],
    );
  }
  for (const review of reviews) {
    await recordReview(execute, dialect, {
      ...review,
      createdAt: new Date().toISOString(),
    });
  }
}

async function migrateLegacyProfiles({ execute, all, dialect }) {
  const expression = dialect === "postgres"
    ? "u.extra_data"
    : "u.extra_data";
  const users = await all(
    `SELECT sm.user_id AS user_id, sm.school_id AS school_id,
            sm.role_code AS role_code, ${expression} AS extra_data
     FROM school_memberships sm
     JOIN users u ON u.id = sm.user_id
     WHERE u.school_id = sm.school_id
     ORDER BY sm.user_id, sm.school_id`,
  );
  const insertProfile = async (row, profileType, profileId, column) => {
    if (!SCHOOL_PROFILE_COLUMNS.has(column)) {
      throw new TypeError("Unsupported school profile column.");
    }
    const existing = await all(
      `SELECT user_id FROM user_school_profiles
       WHERE school_id = ${sqlParameter(dialect, 1)}
         AND ${column} = ${sqlParameter(dialect, 2)}`,
      [row.school_id, profileId],
    );
    const duplicateReview = await all(
      `SELECT 1 FROM school_architecture_reviews
       WHERE school_id = ${sqlParameter(dialect, 1)}
         AND profile_type = ${sqlParameter(dialect, 2)}
         AND related_record_id = ${sqlParameter(dialect, 3)}
         AND reason = 'duplicate_legacy_profile_requires_review'
       LIMIT 1`,
      [row.school_id, profileType, profileId],
    );
    if (duplicateReview.length) return;
    const conflictingUsers = existing.filter((item) => item.user_id !== row.user_id);
    if (!conflictingUsers.length && existing.length) return;
    if (conflictingUsers.length) {
      const affectedUsers = new Set([
        row.user_id,
        ...conflictingUsers.map((item) => item.user_id),
      ]);
      await execute(
        `DELETE FROM user_school_profiles
         WHERE school_id = ${sqlParameter(dialect, 1)}
           AND ${column} = ${sqlParameter(dialect, 2)}`,
        [row.school_id, profileId],
      );
      for (const userId of affectedUsers) {
        await recordReview(execute, dialect, {
          schoolId: row.school_id,
          userId,
          profileType,
          relatedRecordId: profileId,
          reason: "duplicate_legacy_profile_requires_review",
          createdAt: new Date().toISOString(),
        });
      }
      return;
    }
    await execute(
      `INSERT INTO user_school_profiles
         (user_id, school_id, role_code, ${column}, created_at, updated_at)
       VALUES (
         ${sqlParameter(dialect, 1)}, ${sqlParameter(dialect, 2)}, ${sqlParameter(dialect, 3)},
         ${sqlParameter(dialect, 4)}, ${sqlParameter(dialect, 5)}, ${sqlParameter(dialect, 6)}
       )
       ON CONFLICT (user_id, school_id) DO NOTHING`,
      [
        row.user_id,
        row.school_id,
        row.role_code,
        profileId,
        new Date().toISOString(),
        new Date().toISOString(),
      ],
    );
  };

  for (const row of users) {
    const extra = extraDataFromRow(row.extra_data);
    if (row.role_code === "student" && extra.studentId) {
      const profile = await all(
        `SELECT id FROM students
         WHERE id = ${sqlParameter(dialect, 1)}
           AND school_id = ${sqlParameter(dialect, 2)}`,
        [extra.studentId, row.school_id],
      );
      if (profile.length) {
        await insertProfile(row, "student", extra.studentId, "student_id");
      } else {
        await recordReview(execute, dialect, {
          schoolId: row.school_id,
          userId: row.user_id,
          profileType: "student",
          relatedRecordId: extra.studentId,
          reason: "legacy_profile_missing_or_cross_school",
          createdAt: new Date().toISOString(),
        });
      }
    } else if (row.role_code === "teacher" && extra.teacherId) {
      const profile = await all(
        `SELECT id FROM teachers
         WHERE id = ${sqlParameter(dialect, 1)}
           AND school_id = ${sqlParameter(dialect, 2)}`,
        [extra.teacherId, row.school_id],
      );
      if (profile.length) {
        await insertProfile(row, "teacher", extra.teacherId, "teacher_id");
      } else {
        await recordReview(execute, dialect, {
          schoolId: row.school_id,
          userId: row.user_id,
          profileType: "teacher",
          relatedRecordId: extra.teacherId,
          reason: "legacy_profile_missing_or_cross_school",
          createdAt: new Date().toISOString(),
        });
      }
    } else if (row.role_code === "parent") {
      const guardians = await all(
        `SELECT id FROM guardians
         WHERE user_id = ${sqlParameter(dialect, 1)} AND school_id = ${sqlParameter(dialect, 2)}
           AND deleted_at IS NULL
         ORDER BY id`,
        [row.user_id, row.school_id],
      );
      if (guardians.length === 1) {
        await insertProfile(row, "parent", guardians[0].id, "guardian_id");
      } else if (guardians.length > 1 || (Array.isArray(extra.childIds) && extra.childIds.length)) {
        await recordReview(execute, dialect, {
          schoolId: row.school_id,
          userId: row.user_id,
          profileType: "parent",
          reason: guardians.length > 1
            ? "multiple_legacy_guardian_profiles"
            : "legacy_guardian_profile_missing",
          createdAt: new Date().toISOString(),
        });
      }
    }
  }
}

async function reconcileLegacyMemberships({ execute, all, dialect }) {
  const rows = await all(
    `SELECT sm.user_id, sm.school_id, sm.role_code, u.status AS user_status,
            u.deleted_at
     FROM school_memberships sm
     JOIN users u ON u.id = sm.user_id
     WHERE sm.status = 'active'`,
  );
  for (const row of rows) {
    let status = "active";
    const invalidRole = !SCHOOL_ROLES.includes(row.role_code);
    if (row.deleted_at || invalidRole || row.user_status === "disabled") {
      status = "revoked";
    } else if (row.user_status === "suspended") {
      status = "suspended";
    } else if (row.user_status === "pending") {
      status = "pending";
    }
    if (status !== "active") {
      await execute(
        `UPDATE school_memberships
         SET status = ${sqlParameter(dialect, 1)},
             is_active = FALSE,
             updated_at = ${sqlParameter(dialect, 2)}
         WHERE user_id = ${sqlParameter(dialect, 3)}
           AND school_id = ${sqlParameter(dialect, 4)}`,
        [status, new Date().toISOString(), row.user_id, row.school_id],
      );
    }
    if (invalidRole) {
      await recordReview(execute, dialect, {
        schoolId: row.school_id,
        userId: row.user_id,
        reason: "legacy_membership_role_requires_review",
        createdAt: new Date().toISOString(),
      });
    }
  }
}

async function up({ execute, all, dialect }) {
  await execute(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_students_id_school_profiles ON students(id, school_id)",
  );
  await execute(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_teachers_id_school_profiles ON teachers(id, school_id)",
  );
  await execute(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_guardians_id_school_profiles ON guardians(id, school_id)",
  );
  await execute(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_school_memberships_user_school_role ON school_memberships(user_id, school_id, role_code)",
  );
  await execute(`
    CREATE TABLE IF NOT EXISTS school_architecture_reviews (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      contact_type TEXT CHECK (contact_type IS NULL OR contact_type IN ('email', 'phone')),
      profile_type TEXT CHECK (profile_type IS NULL OR profile_type IN ('student', 'teacher', 'parent')),
      related_record_id TEXT,
      normalized_value TEXT,
      reason TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      resolved_at TIMESTAMPTZ
    )
  `);
  await execute(`
    CREATE TABLE IF NOT EXISTS school_contact_identifiers (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      contact_type TEXT NOT NULL CHECK (contact_type IN ('email', 'phone')),
      normalized_value TEXT NOT NULL CHECK (length(trim(normalized_value)) > 0),
      created_at TIMESTAMPTZ NOT NULL,
      UNIQUE (contact_type, normalized_value),
      UNIQUE (school_id, contact_type)
    )
  `);
  await execute(`
    CREATE TABLE IF NOT EXISTS user_school_profiles (
      user_id TEXT NOT NULL,
      school_id TEXT NOT NULL,
      role_code TEXT NOT NULL,
      student_id TEXT,
      teacher_id TEXT,
      guardian_id TEXT,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (user_id, school_id),
      UNIQUE (school_id, student_id),
      UNIQUE (school_id, teacher_id),
      UNIQUE (school_id, guardian_id),
      FOREIGN KEY (user_id, school_id, role_code)
        REFERENCES school_memberships(user_id, school_id, role_code)
        ON DELETE CASCADE ON UPDATE CASCADE,
      FOREIGN KEY (student_id, school_id)
        REFERENCES students(id, school_id) ON DELETE RESTRICT,
      FOREIGN KEY (teacher_id, school_id)
        REFERENCES teachers(id, school_id) ON DELETE RESTRICT,
      FOREIGN KEY (guardian_id, school_id)
        REFERENCES guardians(id, school_id) ON DELETE RESTRICT,
      CHECK (
        (role_code = 'student' AND student_id IS NOT NULL AND teacher_id IS NULL AND guardian_id IS NULL)
        OR (role_code = 'teacher' AND teacher_id IS NOT NULL AND student_id IS NULL AND guardian_id IS NULL)
        OR (role_code = 'parent' AND guardian_id IS NOT NULL AND student_id IS NULL AND teacher_id IS NULL)
        OR (role_code IN ('admin', 'school_admin') AND student_id IS NULL AND teacher_id IS NULL AND guardian_id IS NULL)
      )
    )
  `);
  await execute(
    "CREATE INDEX IF NOT EXISTS idx_user_school_profiles_school_role ON user_school_profiles(school_id, role_code)",
  );
  await execute(
    "CREATE INDEX IF NOT EXISTS idx_school_architecture_reviews_unresolved ON school_architecture_reviews(resolved_at, reason)",
  );

  await reconcileLegacyMemberships({ execute, all, dialect });
  await ensureMembershipRoleConstraint({ execute, dialect });
  await migrateLegacyContacts({ execute, all, dialect });
  await migrateLegacyProfiles({ execute, all, dialect });
}

module.exports = { up };
