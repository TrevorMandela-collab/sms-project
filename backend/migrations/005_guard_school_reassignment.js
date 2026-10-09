const { relationships } = require("./003_enforce_school_relationships");

const schoolScopedTables = [
  "users",
  "students",
  "guardians",
  "teachers",
  "classes",
  "streams",
  "subjects",
  "academic_years",
  "terms",
  "enrollments",
  "teacher_assignments",
  "attendance",
  "assessments",
  "assessment_results",
  "fee_structures",
  "invoices",
  "payments",
  "assignments",
  "assignment_submissions",
  "library_books",
  "library_copies",
  "library_loans",
  "timetable_entries",
  "announcements",
  "notifications",
  "messages",
  "audit_logs",
  "invite_codes",
  "events",
  "chats",
  "chat_messages",
];

async function up({ execute, all, dialect }) {
  for (const relation of relationships) {
    const invalid = await all(
      `SELECT ${relation.key} AS record_key FROM ${relation.table} t WHERE ${relation.check("t", dialect)} LIMIT 1`,
    );
    if (invalid.length) {
      throw new Error(
        `Cross-school relationship in ${relation.table}/${invalid[0].record_key}.`,
      );
    }
  }

  const invalidRelationship = relationships
    .map(
      ({ table, check }) =>
        `EXISTS (SELECT 1 FROM ${table} t WHERE ${check("t", dialect)})`,
    )
    .join(" OR ");

  if (dialect === "postgres") {
    await execute(`
      CREATE OR REPLACE FUNCTION enforce_school_reassignment_fn() RETURNS trigger
      LANGUAGE plpgsql AS $body$
      BEGIN
        IF ${invalidRelationship} THEN
          RAISE EXCEPTION 'school reassignment would create a cross-school relationship'
            USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $body$;
    `);
  }

  for (const table of schoolScopedTables) {
    const triggerName = `enforce_school_reassignment_${table}`;
    if (dialect === "postgres") {
      await execute(`DROP TRIGGER IF EXISTS ${triggerName} ON ${table}`);
      await execute(`
        CREATE TRIGGER ${triggerName}
        AFTER UPDATE OF school_id ON ${table}
        FOR EACH ROW
        WHEN (OLD.school_id IS DISTINCT FROM NEW.school_id)
        EXECUTE FUNCTION enforce_school_reassignment_fn()
      `);
      continue;
    }

    await execute(`
      CREATE TRIGGER IF NOT EXISTS ${triggerName}
      AFTER UPDATE OF school_id ON ${table}
      WHEN OLD.school_id IS NOT NEW.school_id AND (${invalidRelationship})
      BEGIN
        SELECT RAISE(ABORT, 'school reassignment would create a cross-school relationship');
      END
    `);
  }
}

module.exports = { up };
