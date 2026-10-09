const relationships = [
  {
    table: "students",
    key: "id",
    check: (row) =>
      `${row}.class_id IS NOT NULL AND EXISTS (SELECT 1 FROM classes r WHERE r.id = ${row}.class_id AND r.school_id <> ${row}.school_id)`,
  },
  {
    table: "guardians",
    key: "id",
    check: (row, dialect) =>
      `${row}.user_id IS NOT NULL AND EXISTS (SELECT 1 FROM users r WHERE r.id = ${row}.user_id AND ${schoolMismatch("r.school_id", `${row}.school_id`, dialect)})`,
  },
  {
    table: "guardian_students",
    key: "guardian_id || ':' || student_id",
    check: (row) =>
      `EXISTS (
         SELECT 1 FROM guardians g JOIN students s ON s.id = ${row}.student_id
         WHERE g.id = ${row}.guardian_id AND g.school_id <> s.school_id
       )`,
  },
  {
    table: "streams",
    key: "id",
    check: (row) =>
      `EXISTS (SELECT 1 FROM classes r WHERE r.id = ${row}.class_id AND r.school_id <> ${row}.school_id)`,
  },
  {
    table: "class_subjects",
    key: "class_id || ':' || subject_id",
    check: (row) =>
      `EXISTS (SELECT 1 FROM classes c JOIN subjects s ON s.id = ${row}.subject_id WHERE c.id = ${row}.class_id AND c.school_id <> s.school_id)`,
  },
  {
    table: "terms",
    key: "id",
    check: (row) =>
      `EXISTS (SELECT 1 FROM academic_years r WHERE r.id = ${row}.academic_year_id AND r.school_id <> ${row}.school_id)`,
  },
  {
    table: "enrollments",
    key: "id",
    check: (row) =>
      `EXISTS (SELECT 1 FROM students r WHERE r.id = ${row}.student_id AND r.school_id <> ${row}.school_id)
       OR EXISTS (SELECT 1 FROM classes r WHERE r.id = ${row}.class_id AND r.school_id <> ${row}.school_id)
       OR (${row}.stream_id IS NOT NULL AND EXISTS (SELECT 1 FROM streams r WHERE r.id = ${row}.stream_id AND r.school_id <> ${row}.school_id))
       OR EXISTS (SELECT 1 FROM academic_years r WHERE r.id = ${row}.academic_year_id AND r.school_id <> ${row}.school_id)`,
  },
  {
    table: "teacher_assignments",
    key: "id",
    check: (row) =>
      `EXISTS (SELECT 1 FROM teachers r WHERE r.id = ${row}.teacher_id AND r.school_id <> ${row}.school_id)
       OR EXISTS (SELECT 1 FROM classes r WHERE r.id = ${row}.class_id AND r.school_id <> ${row}.school_id)
       OR (${row}.stream_id IS NOT NULL AND EXISTS (SELECT 1 FROM streams r WHERE r.id = ${row}.stream_id AND r.school_id <> ${row}.school_id))
       OR (${row}.subject_id IS NOT NULL AND EXISTS (SELECT 1 FROM subjects r WHERE r.id = ${row}.subject_id AND r.school_id <> ${row}.school_id))
       OR (${row}.academic_year_id IS NOT NULL AND EXISTS (SELECT 1 FROM academic_years r WHERE r.id = ${row}.academic_year_id AND r.school_id <> ${row}.school_id))`,
  },
  {
    table: "attendance",
    key: "id",
    check: (row) =>
      `EXISTS (SELECT 1 FROM students r WHERE r.id = ${row}.student_id AND r.school_id <> ${row}.school_id)
       OR (${row}.class_id IS NOT NULL AND EXISTS (SELECT 1 FROM classes r WHERE r.id = ${row}.class_id AND r.school_id <> ${row}.school_id))`,
  },
  {
    table: "assessments",
    key: "id",
    check: (row) =>
      `(${row}.class_id IS NOT NULL AND EXISTS (SELECT 1 FROM classes r WHERE r.id = ${row}.class_id AND r.school_id <> ${row}.school_id))
       OR (${row}.subject_id IS NOT NULL AND EXISTS (SELECT 1 FROM subjects r WHERE r.id = ${row}.subject_id AND r.school_id <> ${row}.school_id))
       OR (${row}.term_id IS NOT NULL AND EXISTS (SELECT 1 FROM terms r WHERE r.id = ${row}.term_id AND r.school_id <> ${row}.school_id))`,
  },
  {
    table: "assessment_results",
    key: "id",
    check: (row) =>
      `EXISTS (SELECT 1 FROM students r WHERE r.id = ${row}.student_id AND r.school_id <> ${row}.school_id)
       OR (${row}.assessment_id IS NOT NULL AND EXISTS (SELECT 1 FROM assessments r WHERE r.id = ${row}.assessment_id AND r.school_id <> ${row}.school_id))`,
  },
  {
    table: "fee_structures",
    key: "id",
    check: (row) =>
      `(${row}.academic_year_id IS NOT NULL AND EXISTS (SELECT 1 FROM academic_years r WHERE r.id = ${row}.academic_year_id AND r.school_id <> ${row}.school_id))
       OR (${row}.term_id IS NOT NULL AND EXISTS (SELECT 1 FROM terms r WHERE r.id = ${row}.term_id AND r.school_id <> ${row}.school_id))
       OR (${row}.class_id IS NOT NULL AND EXISTS (SELECT 1 FROM classes r WHERE r.id = ${row}.class_id AND r.school_id <> ${row}.school_id))`,
  },
  {
    table: "invoices",
    key: "id",
    check: (row) =>
      `EXISTS (SELECT 1 FROM students r WHERE r.id = ${row}.student_id AND r.school_id <> ${row}.school_id)`,
  },
  {
    table: "invoice_items",
    key: "id",
    check: (row) =>
      `(${row}.fee_structure_id IS NOT NULL AND EXISTS (
         SELECT 1 FROM fee_structures f JOIN invoices i ON i.id = ${row}.invoice_id
         WHERE f.id = ${row}.fee_structure_id AND f.school_id <> i.school_id
       ))`,
  },
  {
    table: "payments",
    key: "id",
    check: (row) =>
      `EXISTS (SELECT 1 FROM students r WHERE r.id = ${row}.student_id AND r.school_id <> ${row}.school_id)`,
  },
  {
    table: "payment_allocations",
    key: "id",
    check: (row) =>
      `EXISTS (
         SELECT 1 FROM payments p JOIN invoices i ON i.id = ${row}.invoice_id
         WHERE p.id = ${row}.payment_id AND (p.school_id <> i.school_id OR p.student_id <> i.student_id)
       )`,
  },
  {
    table: "assignments",
    key: "id",
    check: (row) =>
      `(${row}.class_id IS NOT NULL AND EXISTS (SELECT 1 FROM classes r WHERE r.id = ${row}.class_id AND r.school_id <> ${row}.school_id))
       OR (${row}.subject_id IS NOT NULL AND EXISTS (SELECT 1 FROM subjects r WHERE r.id = ${row}.subject_id AND r.school_id <> ${row}.school_id))`,
  },
  {
    table: "assignment_submissions",
    key: "id",
    check: (row) =>
      `EXISTS (SELECT 1 FROM assignments r WHERE r.id = ${row}.assignment_id AND r.school_id <> ${row}.school_id)
       OR EXISTS (SELECT 1 FROM students r WHERE r.id = ${row}.student_id AND r.school_id <> ${row}.school_id)`,
  },
  {
    table: "library_copies",
    key: "id",
    check: (row) =>
      `EXISTS (SELECT 1 FROM library_books r WHERE r.id = ${row}.book_id AND r.school_id <> ${row}.school_id)`,
  },
  {
    table: "library_loans",
    key: "id",
    check: (row) =>
      `EXISTS (SELECT 1 FROM library_copies r WHERE r.id = ${row}.copy_id AND r.school_id <> ${row}.school_id)
       OR EXISTS (SELECT 1 FROM students r WHERE r.id = ${row}.student_id AND r.school_id <> ${row}.school_id)`,
  },
  {
    table: "timetable_entries",
    key: "id",
    check: (row) =>
      `(${row}.class_id IS NOT NULL AND EXISTS (SELECT 1 FROM classes r WHERE r.id = ${row}.class_id AND r.school_id <> ${row}.school_id))
       OR (${row}.stream_id IS NOT NULL AND EXISTS (SELECT 1 FROM streams r WHERE r.id = ${row}.stream_id AND r.school_id <> ${row}.school_id))
       OR (${row}.subject_id IS NOT NULL AND EXISTS (SELECT 1 FROM subjects r WHERE r.id = ${row}.subject_id AND r.school_id <> ${row}.school_id))
       OR (${row}.teacher_id IS NOT NULL AND EXISTS (SELECT 1 FROM teachers r WHERE r.id = ${row}.teacher_id AND r.school_id <> ${row}.school_id))`,
  },
  {
    table: "notifications",
    key: "id",
    check: (row, dialect) =>
      `EXISTS (SELECT 1 FROM users r WHERE r.id = ${row}.user_id AND ${schoolMismatch("r.school_id", `${row}.school_id`, dialect)})`,
  },
  {
    table: "messages",
    key: "id",
    check: (row, dialect) =>
      `(${row}.sender_id IS NOT NULL AND EXISTS (SELECT 1 FROM users r WHERE r.id = ${row}.sender_id AND ${schoolMismatch("r.school_id", `${row}.school_id`, dialect)}))
       OR (${row}.recipient_id IS NOT NULL AND EXISTS (SELECT 1 FROM users r WHERE r.id = ${row}.recipient_id AND ${schoolMismatch("r.school_id", `${row}.school_id`, dialect)}))`,
  },
  {
    table: "invite_codes",
    key: "id",
    check: (row, dialect) =>
      `(${row}.student_id IS NOT NULL AND EXISTS (SELECT 1 FROM students r WHERE r.id = ${row}.student_id AND r.school_id <> ${row}.school_id))
       OR (${row}.teacher_id IS NOT NULL AND EXISTS (SELECT 1 FROM teachers r WHERE r.id = ${row}.teacher_id AND r.school_id <> ${row}.school_id))
       OR (${row}.used_by_user_id IS NOT NULL AND EXISTS (SELECT 1 FROM users r WHERE r.id = ${row}.used_by_user_id AND ${schoolMismatch("r.school_id", `${row}.school_id`, dialect)}))`,
  },
  {
    table: "chat_members",
    key: "chat_id || ':' || user_id",
    check: (row, dialect) =>
      `EXISTS (SELECT 1 FROM chats c JOIN users u ON u.id = ${row}.user_id WHERE c.id = ${row}.chat_id AND ${schoolMismatch("c.school_id", "u.school_id", dialect)})`,
  },
  {
    table: "chat_messages",
    key: "id",
    check: (row, dialect) =>
      `EXISTS (SELECT 1 FROM chats r WHERE r.id = ${row}.chat_id AND r.school_id <> ${row}.school_id)
       OR (${row}.sender_id IS NOT NULL AND EXISTS (SELECT 1 FROM users r WHERE r.id = ${row}.sender_id AND ${schoolMismatch("r.school_id", `${row}.school_id`, dialect)}))`,
  },
];

function schoolMismatch(left, right, dialect) {
  return dialect === "postgres"
    ? `${left} IS DISTINCT FROM ${right}`
    : `${left} IS NOT ${right}`;
}

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

  for (const relation of relationships) {
    const name = `enforce_school_${relation.table}`;
    if (dialect === "postgres") {
      const functionName = `${name}_fn`;
      await execute(`
        CREATE OR REPLACE FUNCTION ${functionName}() RETURNS trigger
        LANGUAGE plpgsql AS $body$
        BEGIN
          IF ${relation.check("NEW", dialect)} THEN
            RAISE EXCEPTION 'cross-school relationship in ${relation.table}'
              USING ERRCODE = '23514';
          END IF;
          RETURN NEW;
        END;
        $body$;
      `);
      await execute(`DROP TRIGGER IF EXISTS ${name} ON ${relation.table}`);
      await execute(`
        CREATE TRIGGER ${name}
        BEFORE INSERT OR UPDATE ON ${relation.table}
        FOR EACH ROW EXECUTE FUNCTION ${functionName}()
      `);
      continue;
    }

    for (const operation of ["INSERT", "UPDATE"]) {
      const suffix = operation === "INSERT" ? "insert" : "update";
      await execute(`
        CREATE TRIGGER IF NOT EXISTS ${name}_${suffix}
        BEFORE ${operation} ON ${relation.table}
        WHEN ${relation.check("NEW", dialect)}
        BEGIN
          SELECT RAISE(ABORT, 'cross-school relationship in ${relation.table}');
        END
      `);
    }
  }
}

module.exports = { up, relationships };
