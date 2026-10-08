require("dotenv").config();
const bcrypt = require("bcryptjs");
const db = require("./db");

async function run() {
  if (process.env.NODE_ENV !== "development") {
    throw new Error("Demo data can only be seeded when NODE_ENV=development.");
  }
  const password = process.env.DEMO_SEED_PASSWORD;
  if (
    typeof password !== "string" ||
    password.length < 12 ||
    Buffer.byteLength(password, "utf8") > 72
  ) {
    throw new Error(
      "Set DEMO_SEED_PASSWORD to a unique value between 12 and 72 UTF-8 bytes.",
    );
  }

  await db.migrate();
  const createdAt = new Date().toISOString();
  const today = createdAt.slice(0, 10);
  const schoolId = "demo-school";
  const teacherId = "demo-teacher";
  const classId = "demo-class-grade-7";
  const subjectIds = ["demo-subject-mathematics", "demo-subject-english"];
  const studentIds = ["demo-student-amina", "demo-student-brian"];
  const assignmentId = "demo-assignment-mathematics";
  const passwordHash = await bcrypt.hash(password, 12);

  const entries = [
    {
      collection: "schools",
      record: {
        id: schoolId,
        name: "Green Valley Primary & JSS (Demo)",
        createdAt,
        settings: { schoolType: "Combined", academicYear: "2026-2027" },
        onboardingCompleted: true,
      },
    },
    {
      collection: "users",
      record: {
        id: "demo-admin",
        name: "Demo Administrator",
        email: "admin@greenvalley.example",
        passwordHash,
        role: "admin",
        schoolId,
        status: "active",
        tokenVersion: 0,
        createdAt,
      },
    },
    {
      collection: "users",
      record: {
        id: "demo-teacher-user",
        name: "Grace Wanjiku",
        email: "teacher@greenvalley.example",
        passwordHash,
        role: "teacher",
        schoolId,
        teacherId,
        status: "active",
        tokenVersion: 0,
        createdAt,
      },
    },
    {
      collection: "users",
      record: {
        id: "demo-parent",
        name: "Peter Mwangi",
        email: "parent@greenvalley.example",
        passwordHash,
        role: "parent",
        schoolId,
        childIds: studentIds,
        status: "active",
        tokenVersion: 0,
        createdAt,
      },
    },
    {
      collection: "users",
      record: {
        id: "demo-student-user",
        name: "Amina Mwangi",
        email: "student@greenvalley.example",
        passwordHash,
        role: "student",
        schoolId,
        studentId: studentIds[0],
        status: "active",
        tokenVersion: 0,
        createdAt,
      },
    },
    {
      collection: "teachers",
      record: {
        id: teacherId,
        schoolId,
        name: "Grace Wanjiku",
        employeeNumber: "GV-2026-014",
        subjects: ["Mathematics", "English"],
        contact: "+254 712 345 678",
        status: "active",
      },
    },
    {
      collection: "classes",
      record: {
        id: classId,
        schoolId,
        name: "Grade 7A",
        subjectIds,
        teacherIds: [teacherId],
      },
    },
    {
      collection: "subjects",
      record: {
        id: subjectIds[0],
        schoolId,
        name: "Mathematics",
        code: "MAT-07",
        classIds: [classId],
      },
    },
    {
      collection: "subjects",
      record: {
        id: subjectIds[1],
        schoolId,
        name: "English",
        code: "ENG-07",
        classIds: [classId],
      },
    },
    ...studentIds.map((id, index) => ({
      collection: "students",
      record: {
        id,
        schoolId,
        admissionNumber: `GV-2026-${String(index + 1).padStart(3, "0")}`,
        name: index === 0 ? "Amina Mwangi" : "Brian Otieno",
        class: "Grade 7A",
        classId,
        dateOfBirth: index === 0 ? "2014-05-18" : "2013-11-02",
        gender: index === 0 ? "Female" : "Male",
        admissionDate: "2026-01-12",
        guardianContact: index === 0 ? "+254 722 100 100" : "+254 733 200 200",
        status: "active",
        createdAt,
      },
    })),
    ...studentIds.map((studentId, index) => ({
      collection: "attendance",
      record: {
        id: `demo-attendance-${index + 1}`,
        schoolId,
        studentId,
        className: "Grade 7A",
        date: today,
        status: index === 0 ? "present" : "late",
        markedBy: teacherId,
        createdAt,
      },
    })),
    ...studentIds.map((studentId, index) => ({
      collection: "exams",
      record: {
        id: `demo-result-${index + 1}`,
        schoolId,
        studentId,
        subject: "Mathematics",
        examName: "Term 2 Assessment",
        score: index === 0 ? 82 : 74,
        maxScore: 100,
        term: "Term 2",
        createdAt,
      },
    })),
    ...studentIds.map((studentId, index) => ({
      collection: "fees",
      record: {
        id: `demo-fee-${index + 1}`,
        schoolId,
        studentId,
        studentName: index === 0 ? "Amina Mwangi" : "Brian Otieno",
        class: "Grade 7A",
        amount: index === 0 ? 18000 : 22000,
        due: "2026-10-30",
        status: index === 0 ? "partial" : "outstanding",
        createdAt,
      },
    })),
    {
      collection: "assignments",
      record: {
        id: assignmentId,
        schoolId,
        title: "Fractions in everyday life",
        description: "Show three ways fractions are used at home or in the community.",
        classId,
        subjectId: subjectIds[0],
        dueDate: "2026-10-16",
        maxScore: 20,
        createdBy: "demo-teacher-user",
        createdAt,
      },
    },
    {
      collection: "assignment-submissions",
      record: {
        id: "demo-submission-amina",
        schoolId,
        assignmentId,
        studentId: studentIds[0],
        submitted: true,
        submittedAt: createdAt,
      },
    },
    {
      collection: "library",
      record: {
        id: "demo-book-mathematics",
        schoolId,
        title: "Primary Mathematics: Learner's Book 7",
        author: "East African Education Publishers",
        isbn: "9789966257402",
        copiesTotal: 12,
        copiesAvailable: 11,
        category: "Mathematics",
      },
    },
    {
      collection: "library-loans",
      record: {
        id: "demo-loan-amina",
        schoolId,
        itemId: "demo-book-mathematics",
        itemTitle: "Primary Mathematics: Learner's Book 7",
        studentId: studentIds[0],
        studentName: "Amina Mwangi",
        borrowedDate: today,
        dueDate: "2026-10-18",
        returnedDate: null,
      },
    },
    {
      collection: "timetable",
      record: {
        id: "demo-period-monday-math",
        schoolId,
        className: "Grade 7A",
        day: "Monday",
        period: 1,
        subject: "Mathematics",
        teacherId,
        startTime: "08:00",
        endTime: "08:40",
      },
    },
    {
      collection: "announcements",
      record: {
        id: "demo-announcement-term",
        schoolId,
        title: "Term 2 parent meeting",
        body: "Families are invited to meet class teachers on Friday, 16 October, from 2:00 PM.",
        audience: "parents",
        tag: "School notice",
        createdBy: "demo-admin",
        createdAt,
      },
    },
    {
      collection: "events",
      record: {
        id: "demo-event-parent-meeting",
        schoolId,
        name: "Term 2 parent meeting",
        date: "2026-10-16",
        description: "Class teacher meetings for Grade 1 to Grade 9.",
      },
    },
  ];

  const present = [];
  for (const entry of entries) {
    if (await db.findById(entry.collection, entry.record.id)) present.push(entry);
  }
  if (present.length === entries.length) {
    console.log("Demo school seed is already present; no records changed.");
    return;
  }
  if (present.length) {
    throw new Error(
      "A partial demo seed already exists. Inspect the demo-* records before retrying.",
    );
  }

  for (const { collection, record } of entries) {
    if (
      collection === "users" &&
      await db.findUserByEmail(record.email, { includeDeleted: true })
    ) {
      throw new Error("A demo account email is already in use; no records were changed.");
    }
  }

  const priority = ({ collection, record }) => {
    if (collection === "schools") return 0;
    if (collection === "users") return record.role === "parent" ? 6 : 1;
    if (collection === "teachers") return 2;
    if (collection === "subjects") return 3;
    if (collection === "classes") return 4;
    if (collection === "students") return 5;
    return 10;
  };
  const orderedEntries = entries
    .map((entry, index) => ({ ...entry, index }))
    .sort((left, right) => priority(left) - priority(right) || left.index - right.index);

  await db.transaction(async () => {
    for (const { collection, record } of orderedEntries) {
      try {
        await db.insert(collection, record);
      } catch (error) {
        throw new Error(
          `Failed to seed ${collection}/${record.id}: ${error.message}`,
        );
      }
    }
  });

  console.log("Development demo data created for Green Valley Primary & JSS.");
  console.log("Admin: admin@greenvalley.example");
  console.log("All demo accounts use DEMO_SEED_PASSWORD.");
}

run().catch((error) => {
  console.error(`[seed] ${error.message}`);
  process.exitCode = 1;
});
