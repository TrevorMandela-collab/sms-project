const assert = require("assert");
const { mapRecord, mappings } = require("../migrations/002_import_legacy_store");
const { toCents } = require("../utils/money");
const {
  EXPECTED_MIGRATION_VERSIONS,
  assertMigrationFiles,
} = require("./migration-versions");
const { withPostgresTestSchema } = require("./postgres-test-schema");

assertMigrationFiles();
let db;
const eventRecord = (id) => ({
  id,
  schoolId: "school-1",
  name: id,
  date: "2026-10-08",
  createdAt: new Date().toISOString(),
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function parameter(index) {
  return `$${index}`;
}

function parameters(count) {
  return Array.from({ length: count }, (_, index) => parameter(index + 1)).join(", ");
}

async function run({ db: testDatabase }) {
  db = testDatabase;
  assert.equal(toCents(0.1), 10);
  assert.equal(toCents(0.3), 30);
  assert.equal(toCents(1.005), null);
  assert.equal(toCents(10000000000), null);
  const hashAlias = mapRecord(
    "users",
    {
      id: "hash-alias-user",
      password_hash: "bcrypt-hash",
      createdAt: new Date().toISOString(),
    },
    "sqlite",
  );
  assert.equal(hashAlias.password_hash, "bcrypt-hash");
  assert.equal(Object.hasOwn(hashAlias.extra_data, "password_hash"), false);
  assert.equal(
    mapRecord(
      "schools",
      { id: "false-school", onboardingCompleted: "false", createdAt: new Date().toISOString() },
      "sqlite",
    ).onboarding_completed,
    0,
  );
  assert.throws(
    () =>
      mapRecord(
        "students",
        {
          id: "invalid-date",
          dateOfBirth: "2026-02-30",
          createdAt: new Date().toISOString(),
        },
        "sqlite",
      ),
    /invalid field dateOfBirth/,
  );
  const resetHashAlias = mapRecord(
    "password-resets",
    {
      id: "reset-alias",
      token_hash: "sha256-hash",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    },
    "sqlite",
  );
  assert.equal(resetHashAlias.token_hash, "sha256-hash");
  assert.equal(Object.hasOwn(resetHashAlias.extra_data, "token_hash"), false);
  await db.ensureSchema();
  const existingMigrations = await db.all(
    "SELECT COUNT(*) AS count FROM schema_migrations",
  );
  const existingTables = await db.all(
    "SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename <> 'schema_migrations'",
  );
  if (
    Number(existingMigrations[0].count) !== 0 ||
    existingTables.length !== 0
  ) {
    throw new Error(
      "Database integration tests require a fresh, isolated test schema.",
    );
  }
  await db.execute(
    "CREATE TABLE store (collection TEXT NOT NULL, id TEXT NOT NULL, data JSONB NOT NULL, PRIMARY KEY (collection, id))",
  );
  const now = new Date().toISOString();
  const legacy = [
    ["schools", { id: "school-1", name: "Migration School", settings: { email: "School@Example.test", phone: "+1 555 123 4567" }, createdBy: null, createdAt: now }],
    ["schools", { id: "school-migration-2", name: "Second Migration School", settings: { email: "school@example.test", phone: "not-a-phone" }, createdAt: now }],
    ["users", { id: "admin-1", schoolId: "school-1", name: "Test Admin", email: "admin@example.test", passwordHash: "bcrypt-hash-only", role: "admin", status: "active", tokenVersion: 0, createdAt: now }],
    ["users", { id: "student-user-1", schoolId: "school-1", name: "Profile Student", email: "student@example.test", passwordHash: "bcrypt-hash-only", role: "student", status: "active", studentId: "student-1", createdAt: now }],
    ["users", { id: "teacher-user-1", schoolId: "school-1", name: "Profile Teacher", email: "teacher@example.test", passwordHash: "bcrypt-hash-only", role: "teacher", status: "active", teacherId: "teacher-1", createdAt: now }],
    ["users", { id: "cross-school-profile-user", schoolId: "school-1", name: "Cross-school Profile", email: "cross-school@example.test", passwordHash: "bcrypt-hash-only", role: "student", status: "active", studentId: "student-2", createdAt: now }],
    ["teachers", { id: "teacher-1", schoolId: "school-1", name: "Test Teacher", employeeNumber: "EMP-1", status: "active", createdAt: now }],
    ["students", { id: "student-2", schoolId: "school-migration-2", name: "Other School Student", status: "active", createdAt: now }],
    ["classes", { id: "class-1", schoolId: "school-1", name: "Grade 1", teacherIds: ["teacher-1"], subjectIds: ["subject-1"], createdAt: now }],
    ["subjects", { id: "subject-1", schoolId: "school-1", name: "Reading", code: "READ-1", createdAt: now }],
    ["students", { id: "student-1", schoolId: "school-1", name: "Test Student", classId: "class-1", class: "Grade 1", admissionNumber: "ADM-1", status: "active", createdAt: now }],
    ["assignments", { id: "assignment-1", schoolId: "school-1", classId: "class-1", subjectId: "subject-1", title: "Read", dueDate: now, maxScore: 10, createdAt: now }],
    ["assignment-submissions", { id: "submission-1", schoolId: "school-1", assignmentId: "assignment-1", studentId: "student-1", submitted: true, submittedAt: now, createdAt: now }],
    ["attendance", { id: "attendance-1", schoolId: "school-1", studentId: "student-1", date: "2026-10-08", status: "present", createdAt: now }],
    ["exams", { id: "result-1", schoolId: "school-1", studentId: "student-1", subject: "Reading", examName: "Quiz 1", score: 8, maxScore: 10, createdAt: now }],
    ["fees", { id: "invoice-1", schoolId: "school-1", studentId: "student-1", amount: 1200, due: "2026-11-01", status: "outstanding", createdAt: now }],
    ["library", { id: "book-1", schoolId: "school-1", title: "Reader", copiesTotal: 2, copiesAvailable: 1, createdAt: now }],
    ["library-loans", { id: "loan-1", schoolId: "school-1", itemId: "book-1", itemTitle: "Reader", studentId: "student-1", studentName: "Test Student", borrowedDate: now, dueDate: now, createdAt: now }],
    ["timetable", { id: "period-1", schoolId: "school-1", classId: "class-1", className: "Grade 1", teacherId: "teacher-1", subject: "Reading", day: "Monday", period: 1, startTime: "08:00", endTime: "08:40", createdAt: now }],
    ["announcements", { id: "announcement-1", schoolId: "school-1", title: "Notice", body: "Body", createdAt: now }],
    ["events", { id: "event-1", schoolId: "school-1", name: "Meeting", date: "2026-10-08", customContext: { source: "legacy-event" }, createdAt: now }],
    ["invite-codes", { id: "invite-1", schoolId: "school-1", code: "ABCD-EFGH", role: "student", studentId: "student-1", createdAt: now, expiresAt: now, used: false }],
    ["chats", { id: "chat-1", schoolId: "school-1", name: "General", memberIds: ["admin-1"], inviteCode: "CHAT-CODE", createdAt: now }],
    ["chat-messages", { id: "message-1", schoolId: "school-1", chatId: "chat-1", senderId: "admin-1", text: "Hello", reactions: {}, createdAt: now }],
    ["audit-logs", { id: "audit-1", schoolId: "school-1", actorUserId: "admin-1", action: "TEST", entityType: "test", timestamp: now, metadata: {}, createdAt: now }],
    ["password-resets", { id: "reset-1", userId: "admin-1", tokenHash: "hashed-token", expiresAt: new Date(Date.now() + 60000).toISOString(), used: false, createdAt: now }],
  ];
  const expectedCounts = {};
  for (const [collection, record] of legacy) {
    expectedCounts[collection] = (expectedCounts[collection] || 0) + 1;
    await db.execute(
      `INSERT INTO store (collection, id, data) VALUES (${parameters(3)})`,
      [collection, record.id, JSON.stringify(record)],
    );
  }
  const versions = await db.migrate();
  assert.deepEqual(versions, EXPECTED_MIGRATION_VERSIONS);
  for (const [collection, count] of Object.entries(expectedCounts)) {
    const table = mappings[collection].table;
    const result = await db.all(`SELECT COUNT(*) AS count FROM ${table}`);
    assert.equal(
      Number(result[0].count),
      count,
      `${collection} records must all be imported`,
    );
  }

  assert.equal(
    (await db.all("SELECT to_regclass('store') AS name"))[0]?.name ?? null,
    null,
  );
  const reconciledContacts = await db.all(
    "SELECT school_id, contact_type, normalized_value FROM school_contact_identifiers ORDER BY school_id, contact_type",
  );
  assert.deepEqual(
    reconciledContacts.map(({ school_id, contact_type, normalized_value }) => [
      school_id,
      contact_type,
      normalized_value,
    ]),
    [
      ["school-1", "email", "school@example.test"],
      ["school-1", "phone", "15551234567"],
    ],
  );
  const reconciledProfiles = await db.all(
    "SELECT user_id, role_code, student_id, teacher_id FROM user_school_profiles ORDER BY user_id",
  );
  assert.deepEqual(
    reconciledProfiles.map(({ user_id, role_code, student_id, teacher_id }) => [
      user_id,
      role_code,
      student_id,
      teacher_id,
    ]),
    [
      ["student-user-1", "student", "student-1", null],
      ["teacher-user-1", "teacher", null, "teacher-1"],
    ],
  );
  const migrationReviewReasons = await db.all(
    "SELECT reason, COUNT(*) AS count FROM school_architecture_reviews GROUP BY reason ORDER BY reason",
  );
  assert.deepEqual(
    migrationReviewReasons.map(({ reason, count }) => [reason, Number(count)]),
    [
      ["duplicate_legacy_contact_requires_review", 2],
      ["legacy_phone_requires_review", 1],
      ["legacy_profile_missing_or_cross_school", 1],
    ],
  );
  const qaColumns = await db.all(
    "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = current_schema() AND ((table_name = 'qa_test_runs' AND column_name = 'duration_ms') OR (table_name = 'qa_test_run_results' AND column_name IN ('failure_reason', 'evidence')))",
  );
  assert.deepEqual(
    qaColumns.map(({ table_name, column_name }) => `${table_name}.${column_name}`).sort(),
    [
      "qa_test_run_results.evidence",
      "qa_test_run_results.failure_reason",
      "qa_test_runs.duration_ms",
    ],
  );
  await db.execute(
    `INSERT INTO qa_test_runs (id, owner_user_id, environment, name, created_at, duration_ms)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    ["qa-run-diagnostic", "admin-1", "development", "Synthetic diagnostics", now, 1234],
  );
  await db.execute(
    `INSERT INTO qa_test_run_results
       (run_id, test_id, status, actual_result, notes, failure_reason, evidence)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      "qa-run-diagnostic",
      "synthetic-test",
      "fail",
      "Synthetic failure",
      "",
      "synthetic_failure_reason",
      "synthetic_evidence",
    ],
  );
  const qaDiagnostic = await db.all(
    `SELECT qa_run.duration_ms, result.failure_reason, result.evidence
     FROM qa_test_runs qa_run
     JOIN qa_test_run_results result ON result.run_id = qa_run.id
     WHERE qa_run.id = $1 AND result.test_id = $2`,
    ["qa-run-diagnostic", "synthetic-test"],
  );
  assert.deepEqual(qaDiagnostic, [
    {
      duration_ms: 1234,
      failure_reason: "synthetic_failure_reason",
      evidence: "synthetic_evidence",
    },
  ]);
  const importedCounts = await db.all(
    "SELECT 'students' AS entity, COUNT(*) AS count FROM students UNION ALL SELECT 'attendance', COUNT(*) FROM attendance UNION ALL SELECT 'invoices', COUNT(*) FROM invoices UNION ALL SELECT 'assessment_results', COUNT(*) FROM assessment_results",
  );
  assert.deepEqual(importedCounts.map(({ count }) => Number(count)), [2, 1, 1, 1]);
  assert.equal((await db.findById("students", "student-1")).admissionNumber, "ADM-1");
  assert.deepEqual(
    (await db.findById("events", "event-1")).customContext,
    { source: "legacy-event" },
  );
  const importedClass = (await db.readAll("classes"))[0];
  assert.deepEqual(importedClass.teacherIds, ["teacher-1"]);
  assert.deepEqual(importedClass.subjectIds, ["subject-1"]);
  assert.equal((await db.findById("users", "admin-1")).passwordHash, "bcrypt-hash-only");
  assert.equal((await db.readAll("exams"))[0].examName, "Quiz 1");
  assert.equal(typeof (await db.readAll("exams"))[0].score, "number");
  assert.equal((await db.readAll("attendance"))[0].sessionKey, "daily");
  assert.equal((await db.readAll("library-loans"))[0].itemId, "book-1");
  assert.equal(await db.count("students"), 2);

  const countTestStudentId = "student-count-check";
  await db.insert("students", {
    id: countTestStudentId,
    schoolId: "school-1",
    admissionNumber: "ADM-COUNT",
    name: "Count Check Student",
    classId: "class-1",
    class: "Grade 1",
    dateOfBirth: "2019-01-01",
    gender: "female",
    admissionDate: "2024-01-01",
    status: "active",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  assert.equal(await db.count("students"), 3);
  await db.remove("students", countTestStudentId);
  assert.equal(await db.count("students"), 2);

  assert.equal(
    (await db.findByIds("students", ["student-1"], "school-1")).length,
    1,
  );
  assert.equal(
    (await db.findByIds("students", ["student-1"], "other-school")).length,
    0,
  );
  assert.equal(
    (await db.findUserByEmail("ADMIN@example.test")).id,
    "admin-1",
  );
  assert.equal(
    (await db.readBySchool("users", "school-1")).length,
    4,
  );
  const studentPage = await db.listPage("students", {
    schoolId: "school-1",
    page: 1,
    limit: 1,
    search: "test",
    searchFields: ["name"],
  });
  assert.equal(studentPage.data.length, 1);
  assert.equal(studentPage.meta.total, 1);
  assert.equal(studentPage.meta.pages, 1);
  const injectionSearch = await db.listPage("students", {
    schoolId: "school-1",
    page: 1,
    limit: 10,
    search: "' OR 1=1 --",
    searchFields: ["name"],
  });
  assert.equal(injectionSearch.meta.total, 0);
  assert.equal(Number((await db.all("SELECT COUNT(*) AS count FROM library_copies"))[0].count), 1);
  assert.equal(Number((await db.all("SELECT COUNT(*) AS count FROM teacher_assignments"))[0].count), 1);
  assert.equal(Number((await db.all("SELECT COUNT(*) AS count FROM class_subjects"))[0].count), 1);
  assert.equal(Number((await db.all("SELECT COUNT(*) AS count FROM chat_members"))[0].count), 1);
  assert.equal(
    Number((await db.all("SELECT COUNT(*) AS count FROM schema_migrations"))[0].count),
    EXPECTED_MIGRATION_VERSIONS.length,
  );
  assert.equal((await db.findById("chats", "chat-1")).inviteCode, null);
  assert.equal(
    Number((await db.all("SELECT COUNT(*) AS count FROM chat_invitation_codes"))[0].count),
    0,
    "migration must retire plaintext legacy chat invitation codes",
  );
  const chatMessages = await db.readByChatId("chat-1");
  assert.equal(chatMessages.length, 1);
  const chatPage = await db.readChatPageByChatId("chat-1", { limit: 2 });
  assert.deepEqual(chatPage.map((message) => message.id), [chatMessages[0].id]);
  const chatBeforePage = await db.readChatPageByChatId("chat-1", {
    limit: 2,
    beforeCreatedAt: chatMessages[0].createdAt,
    beforeId: chatMessages[0].id,
  });
  assert.equal(chatBeforePage.length, 0);
  console.log("[database] migration, relational reads, and constraints passed");
  const financeStamp = new Date().toISOString();
  const invoice = {
    id: "invoice-with-items",
    schoolId: "school-1",
    studentId: "student-1",
    amount: 60,
    due: "2026-11-01",
    status: "outstanding",
    createdAt: financeStamp,
  };
  await db.createInvoiceWithItems(invoice, [
    {
      id: "invoice-item-1",
      description: "Books",
      quantity: 2,
      unitAmount: 30,
    },
  ]);
  assert.equal(
    Number((await db.all("SELECT COUNT(*) AS count FROM invoice_items WHERE invoice_id = $1", ["invoice-with-items"]))[0].count),
    1,
  );
  await assert.rejects(
    db.createInvoiceWithItems(
      { ...invoice, id: "invoice-rollback" },
      [
        {
          id: "invoice-item-invalid",
          feeStructureId: "missing-fee-structure",
          description: "Invalid fee",
          quantity: 1,
          unitAmount: 1,
        },
      ],
    ),
    /FOREIGN KEY|foreign key/i,
  );
  await assert.rejects(
    db.createInvoiceWithItems({ ...invoice, id: "invoice-invalid-cents", amount: 1.005 }, []),
    /non-negative amount/i,
  );
  for (const [id, amount] of [
    ["invoice-tenth-a", 0.1],
    ["invoice-tenth-b", 0.2],
  ]) {
    await db.createInvoiceWithItems({ ...invoice, id, amount }, []);
  }
  await db.recordPaymentWithAllocations(
    {
      id: "payment-decimal-allocation",
      schoolId: "school-1",
      studentId: "student-1",
      reference: "REF-DECIMAL-ALLOCATION",
      amount: 0.3,
      paidAt: financeStamp,
    },
    [
      { id: "allocation-tenth-a", invoiceId: "invoice-tenth-a", amount: 0.1 },
      { id: "allocation-tenth-b", invoiceId: "invoice-tenth-b", amount: 0.2 },
    ],
  );
  assert.equal(
    toCents(
      Number(
        (
          await db.all(
            "SELECT SUM(amount) AS total FROM payment_allocations WHERE payment_id = $1",
            ["payment-decimal-allocation"],
          )
        )[0].total,
      ),
    ),
    30,
  );
  await assert.rejects(
    db.recordPaymentWithAllocations(
      {
        id: "payment-invalid-cents",
        schoolId: "school-1",
        studentId: "student-1",
        reference: "REF-INVALID-CENTS",
        amount: 1.005,
        paidAt: financeStamp,
      },
      [],
    ),
    /Payment amount and allocations are invalid/,
  );
  assert.equal(await db.findById("fees", "invoice-rollback"), null);
  await db.recordPaymentWithAllocations(
    {
      id: "payment-allocated",
      schoolId: "school-1",
      studentId: "student-1",
      reference: "REF-ALLOCATED",
      amount: 50,
      paidAt: financeStamp,
    },
    [{ id: "payment-allocation-1", invoiceId: invoice.id, amount: 50 }],
  );
  assert.equal(
    Number((await db.all("SELECT COUNT(*) AS count FROM payment_allocations WHERE payment_id = $1", ["payment-allocated"]))[0].count),
    1,
  );
  await assert.rejects(
    db.recordPaymentWithAllocations(
      {
        id: "payment-over-invoice",
        schoolId: "school-1",
        studentId: "student-1",
        reference: "REF-OVER-INVOICE",
        amount: 20,
        paidAt: financeStamp,
      },
      [{ id: "payment-allocation-over", invoiceId: invoice.id, amount: 20 }],
    ),
    (error) => error.code === "INVOICE_BALANCE_EXCEEDED",
  );
  assert.equal(
    Number((await db.all("SELECT COUNT(*) AS count FROM payments WHERE id = $1", ["payment-over-invoice"]))[0].count),
    0,
  );
  const concurrentInvoiceAllocations = await Promise.allSettled(
    ["payment-concurrent-a", "payment-concurrent-b"].map((id) =>
      db.recordPaymentWithAllocations(
        {
          id,
          schoolId: "school-1",
          studentId: "student-1",
          reference: `REF-${id}`,
          amount: 10,
          paidAt: financeStamp,
        },
        [{ id: `allocation-${id}`, invoiceId: invoice.id, amount: 10 }],
      ),
    ),
  );
  assert.equal(
    concurrentInvoiceAllocations.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    concurrentInvoiceAllocations.filter(
      (result) =>
        result.status === "rejected" &&
        result.reason.code === "INVOICE_BALANCE_EXCEEDED",
    ).length,
    1,
  );
  assert.equal(
    Number(
      (
        await db.all(
          "SELECT COALESCE(SUM(amount), 0) AS total FROM payment_allocations WHERE invoice_id = $1",
          [invoice.id],
        )
      )[0].total,
    ),
    60,
  );
  await assert.rejects(
    db.recordPaymentWithAllocations(
      {
        id: "payment-rollback",
        schoolId: "school-1",
        studentId: "student-1",
        reference: "REF-ROLLBACK",
        amount: 50,
        paidAt: financeStamp,
      },
      [{ id: "payment-allocation-1", invoiceId: "invoice-1", amount: 50 }],
    ),
    /UNIQUE|unique/i,
  );
  assert.equal(
    Number((await db.all("SELECT COUNT(*) AS count FROM payments WHERE id = $1", ["payment-rollback"]))[0].count),
    0,
  );
  await db.insert("library", {
    id: "book-loan-test",
    schoolId: "school-1",
    title: "Loan workflow book",
    copiesTotal: 1,
    copiesAvailable: 1,
    createdAt: financeStamp,
  });
  await db.insert("library-loans", {
    id: "loan-workflow",
    schoolId: "school-1",
    itemId: "book-loan-test",
    studentId: "student-1",
    borrowedDate: financeStamp,
    dueDate: financeStamp,
    createdAt: financeStamp,
  });
  assert.equal((await db.findById("library", "book-loan-test")).copiesAvailable, 0);
  await assert.rejects(
    db.insert("library-loans", {
      id: "loan-over-capacity",
      schoolId: "school-1",
      itemId: "book-loan-test",
      studentId: "student-1",
      borrowedDate: financeStamp,
      dueDate: financeStamp,
      createdAt: financeStamp,
    }),
    (error) => error.code === "NO_AVAILABLE_BOOK_COPY",
  );
  assert.equal(await db.findById("library-loans", "loan-over-capacity"), null);
  await db.update("library-loans", "loan-workflow", {
    returnedDate: financeStamp,
  });
  assert.equal((await db.findById("library", "book-loan-test")).copiesAvailable, 1);
  await db.update("library-loans", "loan-workflow", { returnedDate: null });
  assert.equal((await db.findById("library", "book-loan-test")).copiesAvailable, 0);
  assert.equal(await db.remove("library-loans", "loan-workflow"), true);
  assert.equal((await db.findById("library", "book-loan-test")).copiesAvailable, 1);
  assert.equal(await db.findById("library-loans", "loan-workflow"), null);
  assert.equal(await db.remove("library-loans", "loan-workflow"), false);
  assert.equal((await db.findById("library", "book-loan-test")).copiesAvailable, 1);
  await db.insert("library", {
    id: "book-loan-concurrent",
    schoolId: "school-1",
    title: "Concurrent loan book",
    copiesTotal: 1,
    copiesAvailable: 1,
    createdAt: financeStamp,
  });
  const concurrentLoans = await Promise.allSettled(
    ["loan-concurrent-1", "loan-concurrent-2"].map((id) =>
      db.insert("library-loans", {
        id,
        schoolId: "school-1",
        itemId: "book-loan-concurrent",
        studentId: "student-1",
        borrowedDate: financeStamp,
        dueDate: financeStamp,
        createdAt: financeStamp,
      }),
    ),
  );
  const activeLoanId = ["loan-concurrent-1", "loan-concurrent-2"][
    concurrentLoans.findIndex((result) => result.status === "fulfilled")
  ];
  assert.equal(
    concurrentLoans.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    concurrentLoans.filter((result) => result.status === "rejected").length,
    1,
  );
  assert.equal((await db.findById("library", "book-loan-concurrent")).copiesAvailable, 0);
  await assert.rejects(
    db.update("library", "book-loan-concurrent", {
      copiesTotal: 0,
      copiesAvailable: 0,
    }),
    (error) => error.code === "BOOK_COPIES_BELOW_ACTIVE_LOANS",
  );
  const expandedBook = await db.update("library", "book-loan-concurrent", {
    copiesTotal: 2,
    copiesAvailable: 1,
  });
  assert.equal(expandedBook.copiesAvailable, 1);
  await db.update("library-loans", activeLoanId, {
    returnedDate: financeStamp,
  });
  assert.equal((await db.findById("library", "book-loan-concurrent")).copiesAvailable, 2);
  await db.migrate();
  assert.equal((await db.readAll("students")).length, 2);
  const stamp = now;
  const duplicateAdmission = () => db.execute(
    `INSERT INTO students (id, school_id, name, admission_number, status, created_at, updated_at) VALUES (${parameters(7)})`,
    ["student-duplicate", "school-1", "Duplicate", "ADM-1", "active", stamp, stamp],
  );
  await assert.rejects(duplicateAdmission(), /UNIQUE|unique/i);
  await assert.rejects(
    db.execute(
      `INSERT INTO teachers (id, school_id, employee_id, name, status, created_at, updated_at) VALUES (${parameters(7)})`,
      ["teacher-duplicate", "school-1", "EMP-1", "Duplicate Teacher", "active", stamp, stamp],
    ),
    /UNIQUE|unique/i,
  );
  await assert.rejects(
    db.execute(
      `INSERT INTO subjects (id, school_id, code, name, created_at, updated_at) VALUES (${parameters(6)})`,
      ["subject-duplicate", "school-1", "READ-1", "Duplicate Subject", stamp, stamp],
    ),
    /UNIQUE|unique/i,
  );
  await assert.rejects(
    db.execute(
      `INSERT INTO students (id, school_id, name, status, created_at, updated_at) VALUES (${parameters(6)})`,
      ["student-no-school", "missing-school", "Invalid", "active", stamp, stamp],
    ),
    /FOREIGN KEY|foreign key/i,
  );
  await assert.rejects(
    db.execute(
      `INSERT INTO students (id, school_id, name, status, created_at, updated_at) VALUES (${parameters(6)})`,
      ["student-no-name", "school-1", null, "active", stamp, stamp],
    ),
    /not[- ]null/i,
  );
  await db.execute(
    `INSERT INTO schools (id, name, created_at, updated_at) VALUES (${parameters(4)})`,
    ["school-2", "Other School", stamp, stamp],
  );
  await db.execute(
    `INSERT INTO classes (id, school_id, name, created_at, updated_at) VALUES (${parameters(5)})`,
    ["class-foreign", "school-2", "Foreign Class", stamp, stamp],
  );
  await assert.rejects(
    db.execute(
      `INSERT INTO students (id, school_id, class_id, name, status, created_at, updated_at) VALUES (${parameters(7)})`,
      ["student-cross-school-class", "school-1", "class-foreign", "Invalid Tenant Link", "active", stamp, stamp],
    ),
    /cross-school relationship/i,
  );
  await assert.rejects(
    db.execute(
      `UPDATE students SET class_id = ${parameter(1)} WHERE id = ${parameter(2)}`,
      ["class-foreign", "student-1"],
    ),
    /cross-school relationship/i,
  );
  await assert.rejects(
    db.execute(
      `UPDATE classes SET school_id = ${parameter(1)} WHERE id = ${parameter(2)}`,
      ["school-2", "class-1"],
    ),
    /cross-school relationship/i,
  );
  assert.equal(
    (await db.findById("classes", "class-1")).schoolId,
    "school-1",
  );
  await assert.rejects(
    db.execute(
      `UPDATE users SET school_id = ${parameter(1)} WHERE id = ${parameter(2)}`,
      ["school-2", "admin-1"],
    ),
    /cross-school relationship/i,
  );
  assert.equal((await db.findById("users", "admin-1")).schoolId, "school-1");
  await assert.rejects(
    db.execute(
      `INSERT INTO assessment_results (id, school_id, student_id, score, max_score, created_at, updated_at) VALUES (${parameters(7)})`,
      ["invalid-score", "school-1", "student-1", 11, 10, stamp, stamp],
    ),
    /CHECK|check/i,
  );
  await db.execute(
    `INSERT INTO assessments (id, school_id, name, max_score, created_at, updated_at) VALUES (${parameters(6)})`,
    ["assessment-1", "school-1", "Assessment 1", 10, stamp, stamp],
  );
  await db.execute(
    `INSERT INTO assessment_results (id, school_id, assessment_id, student_id, score, max_score, created_at, updated_at) VALUES (${parameters(8)})`,
    ["result-unique", "school-1", "assessment-1", "student-1", 8, 10, stamp, stamp],
  );
  await assert.rejects(
    db.execute(
      `INSERT INTO assessment_results (id, school_id, assessment_id, student_id, score, max_score, created_at, updated_at) VALUES (${parameters(8)})`,
      ["result-duplicate", "school-1", "assessment-1", "student-1", 9, 10, stamp, stamp],
    ),
    /UNIQUE|unique/i,
  );
  await assert.rejects(
    db.execute(
      `INSERT INTO attendance (id, school_id, student_id, attendance_date, session_key, status, created_at, updated_at) VALUES (${parameters(8)})`,
      ["attendance-duplicate", "school-1", "student-1", "2026-10-08", "daily", "present", stamp, stamp],
    ),
    /UNIQUE|unique/i,
  );
  await db.execute(
    `INSERT INTO payments (id, school_id, student_id, reference, amount, paid_at, created_at, updated_at) VALUES (${parameters(8)})`,
    ["payment-1", "school-1", "student-1", "REF-1", 100, stamp, stamp, stamp],
  );
  await assert.rejects(
    db.execute(
      `INSERT INTO payments (id, school_id, student_id, reference, amount, paid_at, created_at, updated_at) VALUES (${parameters(8)})`,
      ["payment-2", "school-1", "student-1", "REF-1", 100, stamp, stamp, stamp],
    ),
    /UNIQUE|unique/i,
  );
  const concurrentPayments = await Promise.allSettled(
    ["payment-concurrent-1", "payment-concurrent-2"].map((id) =>
      db.execute(
        `INSERT INTO payments (id, school_id, student_id, reference, amount, paid_at, created_at, updated_at) VALUES (${parameters(8)})`,
        [id, "school-1", "student-1", "REF-CONCURRENT", 100, stamp, stamp, stamp],
      ),
    ),
  );
  assert.equal(
    concurrentPayments.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    concurrentPayments.filter((result) => result.status === "rejected").length,
    1,
  );
  const concurrentAttendance = await Promise.allSettled(
    ["attendance-concurrent-1", "attendance-concurrent-2"].map((id) =>
      db.insert("attendance", {
        id,
        schoolId: "school-1",
        studentId: "student-1",
        date: "2026-10-09",
        status: "present",
        createdAt: stamp,
      }),
    ),
  );
  assert.equal(
    concurrentAttendance.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    concurrentAttendance.filter((result) => result.status === "rejected").length,
    1,
  );
  await Promise.all([
    db.update("exams", "result-unique", { score: 9 }),
    db.update("exams", "result-unique", { grade: "A" }),
  ]);
  const updatedResult = await db.findById("exams", "result-unique");
  assert.equal(updatedResult.score, 9);
  assert.equal(updatedResult.grade, "A");
  await assert.rejects(
    db.execute(
      `INSERT INTO library_loans (id, school_id, copy_id, student_id, borrowed_at, due_at, created_at, updated_at) VALUES (${parameters(8)})`,
      ["loan-no-copy", "school-1", "missing-copy", "student-1", stamp, stamp, stamp, stamp],
    ),
    /FOREIGN KEY|foreign key/i,
  );

  console.log("[database] domain persistence and concurrent operations passed");
  let insertedStudents = 0;
  for (const batchSize of [100, 900, 9000]) {
    const start = insertedStudents;
    await db.transaction(async () => {
      for (let offset = 0; offset < batchSize; offset += 1) {
        const index = start + offset;
        await db.execute(
          `INSERT INTO students (id, school_id, admission_number, name, status, created_at, updated_at, extra_data) VALUES (${parameters(8)})`,
          [`perf-student-${index}`, "school-1", `PERF-${index}`, `Performance Student ${String(index).padStart(5, "0")}`, "active", stamp, stamp, "{}"],
        );
      }
    });
    insertedStudents += batchSize;
    const queryStart = Date.now();
    const page = await db.listPage("students", {
      schoolId: "school-1",
      page: 1,
      limit: 25,
      sortField: "name",
    });
    assert.equal(page.data.length, 25);
    assert.equal(page.meta.total, insertedStudents + 1);
    assert.ok(Date.now() - queryStart < 5000, "indexed student pagination should remain responsive");
  }
  console.log("[database] indexed pagination performance checks passed");
  await db.transaction(async () => {
    await db.insert("events", eventRecord("committed"));
    await db.insert("events", eventRecord("also-committed"));
  });
  assert.equal(await db.findById("events", "committed").then(Boolean), true);

  await assert.rejects(
    db.transaction(async () => {
      await db.insert("events", eventRecord("rolled-back"));
      throw new Error("expected rollback");
    }),
    /expected rollback/,
  );
  assert.equal(await db.findById("events", "rolled-back"), null);

  await db.transaction(async () => {
    await db.insert("events", eventRecord("outer"));
    await assert.rejects(
      db.transaction(async () => {
        await db.insert("events", eventRecord("nested-rollback"));
        throw new Error("expected savepoint rollback");
      }),
      /expected savepoint rollback/,
    );
    await db.insert("events", eventRecord("outer-after-savepoint"));
  });
  assert.ok(await db.findById("events", "outer"));
  assert.equal(await db.findById("events", "nested-rollback"), null);
  assert.ok(await db.findById("events", "outer-after-savepoint"));

  const entered = deferred();
  const finish = deferred();
  const transaction = db.transaction(async () => {
    await db.insert("events", eventRecord("concurrent-rollback"));
    entered.resolve();
    await finish.promise;
    throw new Error("expected concurrent rollback");
  });
  await entered.promise;
  const outsideWrite = db.insert("events", eventRecord("outside-transaction"));
  finish.resolve();
  await assert.rejects(transaction, /expected concurrent rollback/);
  await outsideWrite;
  assert.equal(await db.findById("events", "concurrent-rollback"), null);
  assert.ok(await db.findById("events", "outside-transaction"));

  console.log("Database transaction tests passed");
}

withPostgresTestSchema(run).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
