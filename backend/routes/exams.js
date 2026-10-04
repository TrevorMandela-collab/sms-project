const createCrudRouter = require("../utils/crudRouterFactory");
const { getTeacherStudentIds } = require("../utils/teacherScope");
const db = require("../utils/db");

// Each exam/grade record: { id, studentId, subject, examName, score, maxScore, term, grade }
module.exports = createCrudRouter("exams", {
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
  validate: async (exam, { user }) => {
    const student = exam.studentId
      ? await db.findById("students", exam.studentId)
      : null;
    if (!student || student.schoolId !== user.schoolId) {
      const error = new Error("Student record not found.");
      error.statusCode = 404;
      error.code = "STUDENT_NOT_FOUND";
      throw error;
    }
    const score = Number(exam.score);
    const maxScore = Number(exam.maxScore);
    if (
      !Number.isFinite(maxScore) ||
      maxScore <= 0 ||
      !Number.isFinite(score) ||
      score < 0 ||
      score > maxScore
    ) {
      const error = new Error(
        "Score must be between zero and the maximum score.",
      );
      error.statusCode = 400;
      error.code = "INVALID_EXAM_SCORE";
      throw error;
    }
  },
  seed: [],
});
