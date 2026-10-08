const mappings = {
  schools: {
    table: "schools",
    fields: {
      id: "id",
      name: "name",
      createdBy: "created_by",
      settings: ["settings_json", "json"],
      onboardingCompleted: ["onboarding_completed", "boolean"],
    },
  },
  users: {
    table: "users",
    fields: {
      id: "id",
      schoolId: "school_id",
      name: "name",
      email: "email",
      passwordHash: "password_hash",
      role: "role_code",
      status: "status",
      tokenVersion: ["token_version", "integer"],
    },
  },
  students: {
    table: "students",
    fields: {
      id: "id",
      schoolId: "school_id",
      admissionNumber: "admission_number",
      name: "name",
      classId: "class_id",
      class: "class_name",
      dateOfBirth: ["date_of_birth", "date"],
      gender: "gender",
      admissionDate: ["admission_date", "date"],
      status: "status",
    },
  },
  teachers: {
    table: "teachers",
    fields: {
      id: "id",
      schoolId: "school_id",
      employeeNumber: "employee_id",
      name: "name",
      email: "email",
      contact: "phone",
      status: "status",
    },
  },
  classes: {
    table: "classes",
    fields: { id: "id", schoolId: "school_id", name: "name", status: "status" },
  },
  subjects: {
    table: "subjects",
    fields: { id: "id", schoolId: "school_id", code: "code", name: "name" },
  },
  assignments: {
    table: "assignments",
    fields: {
      id: "id",
      schoolId: "school_id",
      classId: "class_id",
      subjectId: "subject_id",
      title: "title",
      dueDate: ["due_at", "timestamp"],
      maxScore: ["max_score", "number"],
      createdBy: "created_by",
    },
  },
  "assignment-submissions": {
    table: "assignment_submissions",
    fields: {
      id: "id",
      schoolId: "school_id",
      assignmentId: "assignment_id",
      studentId: "student_id",
      submitted: ["submitted", "boolean"],
      submittedAt: ["submitted_at", "timestamp"],
      score: ["score", "number"],
      feedback: "feedback",
    },
  },
  attendance: {
    table: "attendance",
    fields: {
      id: "id",
      schoolId: "school_id",
      studentId: "student_id",
      classId: "class_id",
      date: ["attendance_date", "date"],
      sessionKey: "session_key",
      status: "status",
      markedBy: "marked_by",
    },
  },
  exams: {
    table: "assessment_results",
    fields: {
      id: "id",
      schoolId: "school_id",
      assessmentId: "assessment_id",
      studentId: "student_id",
      score: ["score", "number"],
      maxScore: ["max_score", "number"],
    },
  },
  fees: {
    table: "invoices",
    fields: {
      id: "id",
      schoolId: "school_id",
      studentId: "student_id",
      invoiceNumber: "invoice_number",
      amount: ["amount", "number"],
      due: ["due_on", "date"],
      issuedAt: ["issued_at", "timestamp"],
      status: "status",
    },
  },
  library: {
    table: "library_books",
    fields: {
      id: "id",
      schoolId: "school_id",
      title: "title",
      author: "author",
      isbn: "isbn",
      category: "category",
      copiesTotal: ["copies_total", "integer"],
      copiesAvailable: ["copies_available", "integer"],
    },
  },
  "library-loans": {
    table: "library_loans",
    fields: {
      id: "id",
      schoolId: "school_id",
      studentId: "student_id",
      borrowedDate: ["borrowed_at", "timestamp"],
      dueDate: ["due_at", "timestamp"],
      returnedDate: ["returned_at", "timestamp"],
    },
  },
  timetable: {
    table: "timetable_entries",
    fields: {
      id: "id",
      schoolId: "school_id",
      classId: "class_id",
      streamId: "stream_id",
      subjectId: "subject_id",
      teacherId: "teacher_id",
      dayOfWeek: ["day_of_week", "integer"],
      startTime: ["starts_at", "time"],
      endTime: ["ends_at", "time"],
    },
  },
  announcements: {
    table: "announcements",
    fields: {
      id: "id",
      schoolId: "school_id",
      title: "title",
      body: "body",
      audience: "audience",
      createdBy: "created_by",
    },
  },
  events: {
    table: "events",
    fields: {
      id: "id",
      schoolId: "school_id",
      name: "name",
      date: ["event_date", "date"],
      description: "description",
    },
  },
  "invite-codes": {
    table: "invite_codes",
    fields: {
      id: "id",
      schoolId: "school_id",
      code: "code",
      role: "role_code",
      studentId: "student_id",
      teacherId: "teacher_id",
      createdBy: "created_by",
      expiresAt: ["expires_at", "timestamp"],
      usedAt: ["used_at", "timestamp"],
      usedByUserId: "used_by_user_id",
    },
  },
  chats: {
    table: "chats",
    fields: {
      id: "id",
      schoolId: "school_id",
      name: "name",
      createdBy: "created_by",
      inviteCode: "invite_code",
    },
  },
  "chat-messages": {
    table: "chat_messages",
    fields: {
      id: "id",
      schoolId: "school_id",
      chatId: "chat_id",
      senderId: "sender_id",
      text: "body",
      replyToId: "reply_to_id",
      reactions: ["reactions_json", "json"],
      editedAt: ["edited_at", "timestamp"],
      deletedAt: ["deleted_at", "timestamp"],
    },
  },
  "audit-logs": {
    table: "audit_logs",
    fields: {
      id: "id",
      schoolId: "school_id",
      actorUserId: "actor_user_id",
      action: "action",
      entityType: "entity_type",
      entityId: "entity_id",
      timestamp: ["timestamp", "timestamp"],
      metadata: ["metadata", "json"],
      ipAddress: "ip_address",
      userAgent: "user_agent",
    },
  },
  "password-resets": {
    table: "password_resets",
    fields: {
      id: "id",
      userId: "user_id",
      tokenHash: "token_hash",
      expiresAt: ["expires_at", "timestamp"],
    },
  },
};

const importOrder = [
  "schools",
  "users",
  "teachers",
  "classes",
  "subjects",
  "students",
  "assignments",
  "assignment-submissions",
  "attendance",
  "exams",
  "fees",
  "library",
  "library-loans",
  "timetable",
  "announcements",
  "events",
  "invite-codes",
  "chats",
  "chat-messages",
  "audit-logs",
  "password-resets",
];

function convert(value, type) {
  if (value === undefined || value === null || value === "") return null;
  if (type === "json") return value;
  if (type === "boolean") return Boolean(value);
  if (type === "integer") {
    const result = Number(value);
    if (!Number.isSafeInteger(result)) throw new Error("invalid integer");
    return result;
  }
  if (type === "number") {
    const result = Number(value);
    if (!Number.isFinite(result)) throw new Error("invalid number");
    return result;
  }
  if (type === "date") {
    const date = String(value).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
      throw new Error("invalid date");
    }
    return date;
  }
  if (type === "timestamp") {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new Error("invalid timestamp");
    return date.toISOString();
  }
  if (type === "time") {
    const time = String(value);
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(time)) {
      throw new Error("invalid time");
    }
    return time.length === 5 ? `${time}:00` : time;
  }
  return value;
}

function mapRecord(collection, record, dialect, fallbackTimestamp = new Date().toISOString()) {
  const mapping = mappings[collection];
  if (collection === "users" && Object.prototype.hasOwnProperty.call(record, "password")) {
    throw new Error("plaintext password fields cannot be imported");
  }
  if (
    collection === "password-resets" &&
    Object.prototype.hasOwnProperty.call(record, "token")
  ) {
    throw new Error("plaintext reset-token fields cannot be imported");
  }
  const consumed = new Set();
  const values = {
    id: record.id,
    created_at: fallbackTimestamp,
    updated_at: fallbackTimestamp,
    extra_data: {},
  };
  const createdAt = record.createdAt || record.timestamp || fallbackTimestamp;
  values.created_at = convert(createdAt, "timestamp");
  values.updated_at = convert(record.updatedAt || createdAt, "timestamp");
  consumed.add("createdAt");
  consumed.add("updatedAt");

  for (const [apiField, definition] of Object.entries(mapping.fields)) {
    if (!Object.prototype.hasOwnProperty.call(record, apiField)) continue;
    const [column, type] = Array.isArray(definition) ? definition : [definition, null];
    try {
      values[column] = convert(record[apiField], type);
    } catch {
      throw new Error(`invalid field ${apiField}`);
    }
    consumed.add(apiField);
  }

  if (collection === "users" && !record.passwordHash && record.password_hash) {
    values.password_hash = record.password_hash;
    consumed.add("password_hash");
  }
  if (collection === "password-resets" && !record.tokenHash && record.token_hash) {
    values.token_hash = record.token_hash;
    consumed.add("token_hash");
  }

  if (collection === "users") {
    values.status = record.status || "active";
    values.token_version = Number.isSafeInteger(record.tokenVersion) ? record.tokenVersion : 0;
  }
  if (collection === "teachers") values.status = record.status || "active";
  if (collection === "classes") values.status = record.status || "active";
  if (collection === "students") values.status = record.status || "active";
  if (collection === "attendance" && values.status) values.status = String(values.status).toLowerCase();
  if (collection === "attendance") values.session_key = values.session_key || "daily";
  if (collection === "library") {
    values.copies_total = values.copies_total ?? 0;
    values.copies_available = values.copies_available ?? values.copies_total;
  }
  if (collection === "library-loans") {
    values.copy_id = `legacy-copy:${record.id}`;
    values.book_id = record.itemId;
    consumed.add("itemId");
  }
  if (collection === "timetable") {
    const days = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 7 };
    if (typeof record.day === "string") {
      values.day_of_week = days[record.day.toLowerCase()] || null;
      consumed.add("day");
    }
  }
  if (collection === "announcements") {
    values.body = record.body || record.message || "";
    consumed.add("message");
  }
  if (collection === "invite-codes") values.role_code = values.role_code || record.role || "student";
  if (collection === "chat-messages") {
    values.reactions_json = values.reactions_json || {};
    values.edited_at = record.edited && !record.editedAt ? values.updated_at : values.edited_at;
    values.deleted_at = record.deleted && !record.deletedAt ? values.updated_at : values.deleted_at;
  }
  if (collection === "audit-logs") values.timestamp = values.timestamp || values.created_at;
  if (collection === "password-resets" && record.used) {
    values.used_at = record.usedAt ? convert(record.usedAt, "timestamp") : values.updated_at;
  }

  values.extra_data = Object.fromEntries(
    Object.entries(record).filter(([key]) => !consumed.has(key)),
  );
  if (dialect === "sqlite") {
    for (const [key, value] of Object.entries(values)) {
      if (value && typeof value === "object") values[key] = JSON.stringify(value);
      else if (typeof value === "boolean") values[key] = Number(value);
    }
  }
  return values;
}

async function up({ all, execute, transaction, dialect }) {
  const source = await all("SELECT collection, id, data FROM store ORDER BY collection, id");
  const importedAt = new Date().toISOString();
  const unsupported = [...new Set(source.map((row) => row.collection).filter((name) => !mappings[name]))];
  if (unsupported.length) {
    throw new Error(`Legacy import encountered unsupported collections: ${unsupported.join(", ")}.`);
  }

  const groups = new Map();
  for (const row of source) {
    if (!groups.has(row.collection)) groups.set(row.collection, []);
    const record = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
    groups.get(row.collection).push({ row, record });
  }
  const failures = [];
  const counts = {};
  const parameter = (index) => (dialect === "postgres" ? `$${index}` : "?");

  for (const collection of importOrder) {
    const records = groups.get(collection) || [];
    if (!records.length) continue;
    const { table } = mappings[collection];
    counts[collection] = { source: records.length, imported: 0 };

    for (const { row, record } of records) {
      try {
        if (!record || typeof record !== "object" || record.id !== row.id) {
          throw new Error("record ID does not match its legacy key");
        }
        const values = mapRecord(collection, record, dialect, importedAt);
        const bookId = values.book_id;
        delete values.book_id;
        if (collection === "fees") values.issued_at = values.issued_at || values.created_at;
        const columns = Object.keys(values);
        const placeholders = columns.map((_, index) => parameter(index + 1));
        await transaction(async () => {
          if (collection === "library-loans") {
            const copy = {
              id: values.copy_id,
              school_id: values.school_id,
              book_id: bookId,
              status: values.returned_at ? "available" : "loaned",
              created_at: values.created_at,
              updated_at: values.updated_at,
            };
            const copyColumns = Object.keys(copy);
            await execute(
              `INSERT INTO library_copies (${copyColumns.join(", ")}) VALUES (${copyColumns.map((_, index) => parameter(index + 1)).join(", ")})`,
              Object.values(copy),
            );
          }
          await execute(
            `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders.join(", ")})`,
            Object.values(values),
          );
        });
        counts[collection].imported += 1;
      } catch (error) {
        failures.push(`${collection}/${row.id}: ${error.message.replace(/[\r\n]/g, " ").slice(0, 160)}`);
      }
    }
  }

  for (const { record } of groups.get("users") || []) {
    try {
      const userRole = [record.id, record.role, convert(record.createdAt || importedAt, "timestamp")];
      await transaction(async () => {
        await execute(
          `INSERT INTO user_roles (user_id, role_code, created_at) VALUES (${userRole.map((_, index) => parameter(index + 1)).join(", ")})`,
          userRole,
        );
      });
    } catch (error) {
      failures.push(`users/${record.id} role link: ${error.message.replace(/[\r\n]/g, " ").slice(0, 160)}`);
    }
    if (record.role !== "parent" || !Array.isArray(record.childIds)) continue;
    const guardianId = `guardian:${record.id}`;
    try {
      await transaction(async () => {
        const values = {
          id: guardianId,
          school_id: record.schoolId,
          user_id: record.id,
          name: record.name,
          email: record.email || null,
          phone: record.phone || null,
          created_at: convert(record.createdAt || importedAt, "timestamp"),
          updated_at: convert(record.updatedAt || record.createdAt || importedAt, "timestamp"),
          extra_data: dialect === "sqlite" ? "{}" : {},
        };
        const columns = Object.keys(values);
        await execute(
          `INSERT INTO guardians (${columns.join(", ")}) VALUES (${columns.map((_, index) => parameter(index + 1)).join(", ")})`,
          Object.values(values),
        );
        for (const studentId of new Set(record.childIds)) {
          const relation = [guardianId, studentId, null, values.created_at];
          await execute(
            `INSERT INTO guardian_students (guardian_id, student_id, relationship, created_at) VALUES (${relation.map((_, index) => parameter(index + 1)).join(", ")})`,
            relation,
          );
        }
      });
    } catch (error) {
      failures.push(`users/${record.id} guardian links: ${error.message.replace(/[\r\n]/g, " ").slice(0, 160)}`);
    }
  }

  for (const { record } of groups.get("classes") || []) {
    const createdAt = convert(record.createdAt || importedAt, "timestamp");
    for (const subjectId of new Set(Array.isArray(record.subjectIds) ? record.subjectIds : [])) {
      try {
        await transaction(async () => {
          await execute(
            `INSERT INTO class_subjects (class_id, subject_id, created_at) VALUES (${parameter(1)}, ${parameter(2)}, ${parameter(3)})`,
            [record.id, subjectId, createdAt],
          );
        });
      } catch (error) {
        failures.push(`classes/${record.id} subject ${subjectId}: ${error.message.replace(/[\r\n]/g, " ").slice(0, 160)}`);
      }
    }
    for (const teacherId of new Set(Array.isArray(record.teacherIds) ? record.teacherIds : [])) {
      try {
        const values = {
          id: `legacy-assignment:${record.id}:${teacherId}`,
          school_id: record.schoolId,
          teacher_id: teacherId,
          class_id: record.id,
          subject_id: null,
          academic_year_id: null,
          created_at: createdAt,
          updated_at: createdAt,
        };
        const columns = Object.keys(values);
        await transaction(async () => {
          await execute(
            `INSERT INTO teacher_assignments (${columns.join(", ")}) VALUES (${columns.map((_, index) => parameter(index + 1)).join(", ")})`,
            Object.values(values),
          );
        });
      } catch (error) {
        failures.push(`classes/${record.id} teacher ${teacherId}: ${error.message.replace(/[\r\n]/g, " ").slice(0, 160)}`);
      }
    }
  }

  for (const { record } of groups.get("chats") || []) {
    for (const userId of new Set(Array.isArray(record.memberIds) ? record.memberIds : [])) {
      try {
        await transaction(async () => {
          await execute(
            `INSERT INTO chat_members (chat_id, user_id, created_at) VALUES (${parameter(1)}, ${parameter(2)}, ${parameter(3)})`,
            [record.id, userId, convert(record.createdAt || new Date(0).toISOString(), "timestamp")],
          );
        });
      } catch (error) {
        failures.push(`chats/${record.id} member ${userId}: ${error.message.replace(/[\r\n]/g, " ").slice(0, 160)}`);
      }
    }
  }

  for (const collection of Object.keys(counts)) {
    if (counts[collection].source !== counts[collection].imported) {
      failures.push(`${collection}: ${counts[collection].source} source records, ${counts[collection].imported} imported`);
    }
  }
  if (failures.length) {
    throw new Error(`Legacy import was rolled back. Invalid records: ${failures.slice(0, 20).join("; ")}`);
  }
  console.log(`[db] Legacy import verified: ${source.length} records across ${Object.keys(counts).length} collections.`);
}

module.exports = { up, mappings, mapRecord };
