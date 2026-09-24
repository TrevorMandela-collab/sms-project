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
  validate: async (attendance, { operation, existing }) => {
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
    if (operation === "create") {
      const records = await db.readAll("attendance");
      const duplicate = records.some(
        (record) =>
          record.studentId === attendance.studentId &&
          record.date === attendance.date,
      );
      if (duplicate) {
        const error = new Error(
          "Attendance for this student and date already exists. Edit the existing record instead.",
        );
        error.statusCode = 409;
        error.code = "DUPLICATE_ATTENDANCE";
        throw error;
      }
    }
  },
  seed: [],
});
