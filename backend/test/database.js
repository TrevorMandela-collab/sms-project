const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "sms-database-test-"));
process.env.SQLITE_PATH = path.join(tempDirectory, "test.sqlite");
process.env.DATABASE_URL = "";

const db = require("../utils/db");
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

async function run() {
  await db.ensureSchema();
  const now = new Date().toISOString();
  const legacy = [
    ["schools", { id: "school-1", name: "Migration School", createdBy: null, createdAt: now }],
    ["users", { id: "admin-1", schoolId: "school-1", name: "Test Admin", email: "admin@example.test", passwordHash: "bcrypt-hash-only", role: "admin", status: "active", tokenVersion: 0, createdAt: now }],
    ["teachers", { id: "teacher-1", schoolId: "school-1", name: "Test Teacher", employeeNumber: "EMP-1", status: "active", createdAt: now }],
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
    ["events", { id: "event-1", schoolId: "school-1", name: "Meeting", date: "2026-10-08", createdAt: now }],
    ["invite-codes", { id: "invite-1", schoolId: "school-1", code: "ABCD-EFGH", role: "student", studentId: "student-1", createdAt: now, expiresAt: now, used: false }],
    ["chats", { id: "chat-1", schoolId: "school-1", name: "General", memberIds: ["admin-1"], inviteCode: "CHAT-CODE", createdAt: now }],
    ["chat-messages", { id: "message-1", schoolId: "school-1", chatId: "chat-1", senderId: "admin-1", text: "Hello", reactions: {}, createdAt: now }],
    ["audit-logs", { id: "audit-1", schoolId: "school-1", actorUserId: "admin-1", action: "TEST", entityType: "test", timestamp: now, metadata: {}, createdAt: now }],
    ["password-resets", { id: "reset-1", userId: "admin-1", tokenHash: "hashed-token", expiresAt: new Date(Date.now() + 60000).toISOString(), used: false, createdAt: now }],
  ];
  for (const [collection, record] of legacy) {
    await db.execute(
      "INSERT INTO store (collection, id, data) VALUES (?, ?, ?)",
      [collection, record.id, JSON.stringify(record)],
    );
  }
  const versions = await db.migrate();
  assert.deepEqual(versions, ["001", "002", "003"]);
  const importedCounts = await db.all(
    "SELECT 'students' AS entity, COUNT(*) AS count FROM students UNION ALL SELECT 'attendance', COUNT(*) FROM attendance UNION ALL SELECT 'invoices', COUNT(*) FROM invoices UNION ALL SELECT 'assessment_results', COUNT(*) FROM assessment_results",
  );
  assert.deepEqual(importedCounts.map(({ count }) => Number(count)), [1, 1, 1, 1]);
  assert.equal((await db.readAll("students"))[0].admissionNumber, "ADM-1");
  assert.equal((await db.readAll("exams"))[0].examName, "Quiz 1");
  assert.equal(typeof (await db.readAll("exams"))[0].score, "number");
  assert.equal((await db.readAll("attendance"))[0].sessionKey, "daily");
  assert.equal((await db.readAll("library-loans"))[0].itemId, "book-1");
  assert.equal(await db.count("students"), 1);
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
    1,
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
  assert.equal((await db.all("SELECT COUNT(*) AS count FROM library_copies"))[0].count, 1);
  assert.equal((await db.all("SELECT COUNT(*) AS count FROM teacher_assignments"))[0].count, 1);
  assert.equal((await db.all("SELECT COUNT(*) AS count FROM class_subjects"))[0].count, 1);
  assert.equal((await db.all("SELECT COUNT(*) AS count FROM chat_members"))[0].count, 1);
  assert.equal((await db.all("SELECT COUNT(*) AS count FROM schema_migrations"))[0].count, 3);
  assert.equal((await db.findChatByInviteCode("school-1", "chat-code")).id, "chat-1");
  assert.equal((await db.readByChatId("chat-1")).length, 1);
  await db.migrate();
  assert.equal((await db.readAll("students")).length, 1);
  const failedMigration = spawnSync(
    process.execPath,
    [path.join(__dirname, "migration-failure.js")],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_URL: "",
        SQLITE_PATH: path.join(tempDirectory, "failed-migration.sqlite"),
      },
    },
  );
  assert.equal(failedMigration.status, 0, failedMigration.stderr || failedMigration.stdout);
  assert.match(
    `${failedMigration.stdout}${failedMigration.stderr}`,
    /plaintext password fields cannot be imported/,
  );
  const seedTest = spawnSync(process.execPath, [path.join(__dirname, "seed.js")], {
    encoding: "utf8",
    env: process.env,
  });
  assert.equal(seedTest.status, 0, seedTest.stderr || seedTest.stdout);

  const stamp = now;
  const duplicateAdmission = () => db.execute(
    "INSERT INTO students (id, school_id, name, admission_number, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ["student-duplicate", "school-1", "Duplicate", "ADM-1", "active", stamp, stamp],
  );
  await assert.rejects(duplicateAdmission(), /UNIQUE|unique/i);
  await assert.rejects(
    db.execute(
      "INSERT INTO teachers (id, school_id, employee_id, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ["teacher-duplicate", "school-1", "EMP-1", "Duplicate Teacher", "active", stamp, stamp],
    ),
    /UNIQUE|unique/i,
  );
  await assert.rejects(
    db.execute(
      "INSERT INTO subjects (id, school_id, code, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      ["subject-duplicate", "school-1", "READ-1", "Duplicate Subject", stamp, stamp],
    ),
    /UNIQUE|unique/i,
  );
  await assert.rejects(
    db.execute(
      "INSERT INTO students (id, school_id, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      ["student-no-school", "missing-school", "Invalid", "active", stamp, stamp],
    ),
    /FOREIGN KEY|foreign key/i,
  );
  await assert.rejects(
    db.execute(
      "INSERT INTO students (id, school_id, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      ["student-no-name", "school-1", null, "active", stamp, stamp],
    ),
    /NOT NULL|not null/i,
  );
  await db.execute(
    "INSERT INTO schools (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
    ["school-2", "Other School", stamp, stamp],
  );
  await db.execute(
    "INSERT INTO classes (id, school_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ["class-foreign", "school-2", "Foreign Class", stamp, stamp],
  );
  await assert.rejects(
    db.execute(
      "INSERT INTO students (id, school_id, class_id, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ["student-cross-school-class", "school-1", "class-foreign", "Invalid Tenant Link", "active", stamp, stamp],
    ),
    /cross-school relationship/i,
  );
  await assert.rejects(
    db.execute(
      "UPDATE students SET class_id = ? WHERE id = ?",
      ["class-foreign", "student-1"],
    ),
    /cross-school relationship/i,
  );
  await assert.rejects(
    db.execute(
      "INSERT INTO assessment_results (id, school_id, student_id, score, max_score, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ["invalid-score", "school-1", "student-1", 11, 10, stamp, stamp],
    ),
    /CHECK|check/i,
  );
  await db.execute(
    "INSERT INTO assessments (id, school_id, name, max_score, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ["assessment-1", "school-1", "Assessment 1", 10, stamp, stamp],
  );
  await db.execute(
    "INSERT INTO assessment_results (id, school_id, assessment_id, student_id, score, max_score, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ["result-unique", "school-1", "assessment-1", "student-1", 8, 10, stamp, stamp],
  );
  await assert.rejects(
    db.execute(
      "INSERT INTO assessment_results (id, school_id, assessment_id, student_id, score, max_score, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ["result-duplicate", "school-1", "assessment-1", "student-1", 9, 10, stamp, stamp],
    ),
    /UNIQUE|unique/i,
  );
  await assert.rejects(
    db.execute(
      "INSERT INTO attendance (id, school_id, student_id, attendance_date, session_key, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ["attendance-duplicate", "school-1", "student-1", "2026-10-08", "daily", "present", stamp, stamp],
    ),
    /UNIQUE|unique/i,
  );
  await db.execute(
    "INSERT INTO payments (id, school_id, student_id, reference, amount, paid_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ["payment-1", "school-1", "student-1", "REF-1", 100, stamp, stamp, stamp],
  );
  await assert.rejects(
    db.execute(
      "INSERT INTO payments (id, school_id, student_id, reference, amount, paid_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ["payment-2", "school-1", "student-1", "REF-1", 100, stamp, stamp, stamp],
    ),
    /UNIQUE|unique/i,
  );
  const concurrentPayments = await Promise.allSettled(
    ["payment-concurrent-1", "payment-concurrent-2"].map((id) =>
      db.execute(
        "INSERT INTO payments (id, school_id, student_id, reference, amount, paid_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
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
      "INSERT INTO library_loans (id, school_id, copy_id, student_id, borrowed_at, due_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ["loan-no-copy", "school-1", "missing-copy", "student-1", stamp, stamp, stamp, stamp],
    ),
    /FOREIGN KEY|foreign key/i,
  );

  let insertedStudents = 0;
  for (const batchSize of [100, 900, 9000]) {
    const start = insertedStudents;
    await db.transaction(async () => {
      for (let offset = 0; offset < batchSize; offset += 1) {
        const index = start + offset;
        await db.execute(
          "INSERT INTO students (id, school_id, admission_number, name, status, created_at, updated_at, extra_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
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

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.close();
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });
