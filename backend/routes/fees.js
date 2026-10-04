const createCrudRouter = require("../utils/crudRouterFactory");
const db = require("../utils/db");

// Each fee record: { id, studentId, studentName, class, amount, due, status }
module.exports = createCrudRouter("fees", {
  permissions: {
    create: ["admin"],
    read: ["admin", "teacher", "parent", "student"],
    update: ["admin"],
    delete: ["admin"],
  },
  scopeForParent: (records, user) =>
    records.filter((r) => (user.childIds || []).includes(r.studentId)),
  scopeForStudent: (records, user) =>
    records.filter((r) => r.studentId === user.studentId),
  searchFields: ["studentName", "class", "status"],
  filterFields: ["status", "class"],
  sortFields: ["studentName", "amount", "due", "createdAt"],
  validate: async (fee, { user }) => {
    if (!Number.isFinite(Number(fee.amount)) || Number(fee.amount) < 0) {
      const error = new Error("Fee amount must be zero or greater.");
      error.statusCode = 400;
      error.code = "INVALID_FEE_AMOUNT";
      throw error;
    }
    const student = fee.studentId
      ? await db.findById("students", fee.studentId)
      : null;
    if (!student || student.schoolId !== user.schoolId) {
      const error = new Error("Student record not found.");
      error.statusCode = 404;
      error.code = "STUDENT_NOT_FOUND";
      throw error;
    }
    if (
      fee.status &&
      !["paid", "partial", "outstanding"].includes(
        String(fee.status).toLowerCase(),
      )
    ) {
      const error = new Error(
        "Fee status must be paid, partial, or outstanding.",
      );
      error.statusCode = 400;
      error.code = "INVALID_FEE_STATUS";
      throw error;
    }
  },
  seed: [],
});
