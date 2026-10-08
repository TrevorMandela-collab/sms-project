const createCrudRouter = require("../utils/crudRouterFactory");
const { getTeacherStudentIds } = require("../utils/teacherScope");
const db = require("../utils/db");

// Each attendance record: { id, studentId, className, date, status, markedBy }
module.exports = createCrudRouter("attendance", {
  permissions: {
    create: ["admin", "teacher"],
    read: ["admin", "teacher", "parent", "student"],
    update: ["admin", "teacher"],
    delete: ["admin", "teacher"],
  },
  scopeForParent: (records, user) =>
    records.filter((r) => (user.childIds || []).includes(r.studentId)),
  scopeForStudent: (records, user) =>
    records.filter((r) => r.studentId === user.studentId),
  scopeForTeacher: async (records, user) => {
    const ids = await getTeacherStudentIds(user);
    return records.filter((r) => ids.has(r.studentId));
  },
  writeGuardForTeacher: async (record, user) => {
    const ids = await getTeacherStudentIds(user);
    return ids.has(record.studentId);
  },
  validate: async (attendance, { user, existing }) => {
    if (
      !["present", "absent", "late", "excused"].includes(
        String(attendance.status).toLowerCase(),
      )
    ) {
      const error = new Error(
        "Attendance status must be present, absent, late, or excused.",
      );
      error.statusCode = 400;
      error.code = "INVALID_ATTENDANCE_STATUS";
      throw error;
    }
    attendance.status = String(attendance.status).toLowerCase();
    if (
      !attendance.studentId ||
      !attendance.date ||
      Number.isNaN(Date.parse(attendance.date))
    ) {
      const error = new Error(
        "A student and valid attendance date are required.",
      );
      error.statusCode = 400;
      error.code = "INVALID_ATTENDANCE_RECORD";
      throw error;
    }
    const sessionKey = String(attendance.sessionKey || "daily").trim();
    if (!sessionKey || sessionKey.length > 50) {
      const error = new Error("Attendance session must be between 1 and 50 characters.");
      error.statusCode = 400;
      error.code = "INVALID_ATTENDANCE_SESSION";
      throw error;
    }
    attendance.sessionKey = sessionKey;
    const student = await db.findById("students", attendance.studentId);
    if (!student || student.schoolId !== user.schoolId) {
      const error = new Error("Student record not found.");
      error.statusCode = 404;
      error.code = "STUDENT_NOT_FOUND";
      throw error;
    }
    const duplicates = await db.listPage("attendance", {
      schoolId: user.schoolId,
      page: 1,
      limit: 2,
      filters: {
        studentId: attendance.studentId,
        date: attendance.date,
        sessionKey,
      },
    });
    if (duplicates.data.some((record) => record.id !== existing?.id)) {
      const error = new Error(
        "Attendance for this student, date, and session already exists. Edit the existing record instead.",
      );
      error.statusCode = 409;
      error.code = "DUPLICATE_ATTENDANCE";
      throw error;
    }
  },
  seed: [],
});
