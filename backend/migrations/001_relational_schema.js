const tables = [
  ["roles", "code TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL"],
  ["permissions", "code TEXT PRIMARY KEY, description TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL"],
  ["role_permissions", "role_code TEXT NOT NULL REFERENCES roles(code) ON DELETE CASCADE, permission_code TEXT NOT NULL REFERENCES permissions(code) ON DELETE CASCADE, created_at TIMESTAMPTZ NOT NULL, PRIMARY KEY (role_code, permission_code)"],
  ["schools", "id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK (length(trim(name)) > 0), created_by TEXT, settings_json JSON NOT NULL DEFAULT '{}', onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL, archived_at TIMESTAMPTZ, extra_data JSON NOT NULL DEFAULT '{}'"],
  ["users", "id TEXT PRIMARY KEY, school_id TEXT REFERENCES schools(id) ON DELETE RESTRICT, name TEXT NOT NULL CHECK (length(trim(name)) > 0), email TEXT NOT NULL, password_hash TEXT NOT NULL, role_code TEXT NOT NULL REFERENCES roles(code) ON DELETE RESTRICT, status TEXT NOT NULL CHECK (status IN ('active', 'suspended', 'pending', 'disabled')), token_version INTEGER NOT NULL DEFAULT 0 CHECK (token_version >= 0), created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL, deleted_at TIMESTAMPTZ, extra_data JSON NOT NULL DEFAULT '{}'"],
  ["user_roles", "user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, role_code TEXT NOT NULL REFERENCES roles(code) ON DELETE RESTRICT, created_at TIMESTAMPTZ NOT NULL, PRIMARY KEY (user_id, role_code)"],
  ["students", "id TEXT PRIMARY KEY, school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE RESTRICT, admission_number TEXT, name TEXT NOT NULL CHECK (length(trim(name)) > 0), class_id TEXT REFERENCES classes(id) ON DELETE SET NULL, class_name TEXT, date_of_birth DATE, gender TEXT, admission_date DATE, status TEXT NOT NULL DEFAULT 'active', created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL, deleted_at TIMESTAMPTZ, extra_data JSON NOT NULL DEFAULT '{}', UNIQUE (school_id, admission_number)"],
  ["guardians", "id TEXT PRIMARY KEY, school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE RESTRICT, user_id TEXT REFERENCES users(id) ON DELETE SET NULL, name TEXT NOT NULL CHECK (length(trim(name)) > 0), email TEXT, phone TEXT, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL, deleted_at TIMESTAMPTZ, extra_data JSON NOT NULL DEFAULT '{}'"],
  ["guardian_students", "guardian_id TEXT NOT NULL REFERENCES guardians(id) ON DELETE CASCADE, student_id TEXT NOT NULL REFERENCES students(id) ON DELETE RESTRICT, relationship TEXT, created_at TIMESTAMPTZ NOT NULL, PRIMARY KEY (guardian_id, student_id)"],
  ["teachers", "id TEXT PRIMARY KEY, school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE RESTRICT, employee_id TEXT, name TEXT NOT NULL CHECK (length(trim(name)) > 0), email TEXT, phone TEXT, status TEXT NOT NULL DEFAULT 'active', created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL, deleted_at TIMESTAMPTZ, extra_data JSON NOT NULL DEFAULT '{}', UNIQUE (school_id, employee_id)"],
  ["classes", "id TEXT PRIMARY KEY, school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE RESTRICT, name TEXT NOT NULL CHECK (length(trim(name)) > 0), status TEXT NOT NULL DEFAULT 'active', created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL, archived_at TIMESTAMPTZ, extra_data JSON NOT NULL DEFAULT '{}', UNIQUE (school_id, name)"],
  ["streams", "id TEXT PRIMARY KEY, school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE RESTRICT, class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE RESTRICT, name TEXT NOT NULL CHECK (length(trim(name)) > 0), created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL, archived_at TIMESTAMPTZ, extra_data JSON NOT NULL DEFAULT '{}', UNIQUE (class_id, name)"],
  ["subjects", "id TEXT PRIMARY KEY, school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE RESTRICT, code TEXT, name TEXT NOT NULL CHECK (length(trim(name)) > 0), created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL, archived_at TIMESTAMPTZ, extra_data JSON NOT NULL DEFAULT '{}', UNIQUE (school_id, code)"],
  ["class_subjects", "class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE, subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT, created_at TIMESTAMPTZ NOT NULL, PRIMARY KEY (class_id, subject_id)"],
  ["academic_years", "id TEXT PRIMARY KEY, school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE RESTRICT, name TEXT NOT NULL, starts_on DATE NOT NULL, ends_on DATE NOT NULL, status TEXT NOT NULL DEFAULT 'planned', created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL, CHECK (ends_on >= starts_on), UNIQUE (school_id, name)"],
  ["terms", "id TEXT PRIMARY KEY, school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE RESTRICT, academic_year_id TEXT NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT, name TEXT NOT NULL, starts_on DATE NOT NULL, ends_on DATE NOT NULL, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL, CHECK (ends_on >= starts_on), UNIQUE (academic_year_id, name)"],
  ["enrollments", "id TEXT PRIMARY KEY, school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE RESTRICT, student_id TEXT NOT NULL REFERENCES students(id) ON DELETE RESTRICT, class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE RESTRICT, stream_id TEXT REFERENCES streams(id) ON DELETE SET NULL, academic_year_id TEXT NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT, status TEXT NOT NULL DEFAULT 'active', enrolled_at TIMESTAMPTZ NOT NULL, archived_at TIMESTAMPTZ, extra_data JSON NOT NULL DEFAULT '{}', UNIQUE (student_id, class_id, academic_year_id)"],
  ["teacher_assignments", "id TEXT PRIMARY KEY, school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE RESTRICT, teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE RESTRICT, class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE RESTRICT, stream_id TEXT REFERENCES streams(id) ON DELETE SET NULL, subject_id TEXT REFERENCES subjects(id) ON DELETE SET NULL, academic_year_id TEXT REFERENCES academic_years(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL, UNIQUE (teacher_id, class_id, subject_id, academic_year_id)"],
  ["attendance", "id TEXT PRIMARY KEY, school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE RESTRICT, student_id TEXT NOT NULL REFERENCES students(id) ON DELETE RESTRICT, class_id TEXT REFERENCES classes(id) ON DELETE SET NULL, attendance_date DATE NOT NULL, session_key TEXT NOT NULL DEFAULT 'daily', status TEXT NOT NULL CHECK (status IN ('present', 'absent', 'late', 'excused')), marked_by TEXT, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL, archived_at TIMESTAMPTZ, extra_data JSON NOT NULL DEFAULT '{}', UNIQUE (student_id, attendance_date, session_key)"],
  ["assessments", "id TEXT PRIMARY KEY, school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE RESTRICT, class_id TEXT REFERENCES classes(id) ON DELETE SET NULL, subject_id TEXT REFERENCES subjects(id) ON DELETE SET NULL, term_id TEXT REFERENCES terms(id) ON DELETE SET NULL, name TEXT NOT NULL, assessment_date DATE, max_score NUMERIC(10,2) NOT NULL CHECK (max_score > 0), created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL, archived_at TIMESTAMPTZ, extra_data JSON NOT NULL DEFAULT '{}'"],
  ["assessment_results", "id TEXT PRIMARY KEY, school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE RESTRICT, assessment_id TEXT REFERENCES assessments(id) ON DELETE RESTRICT, student_id TEXT NOT NULL REFERENCES students(id) ON DELETE RESTRICT, score NUMERIC(10,2) NOT NULL CHECK (score >= 0), max_score NUMERIC(10,2) NOT NULL CHECK (max_score > 0 AND score <= max_score), created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL, archived_at TIMESTAMPTZ, extra_data JSON NOT NULL DEFAULT '{}', UNIQUE (assessment_id, student_id)"],
  ["fee_structures", "id TEXT PRIMARY KEY, school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE RESTRICT, academic_year_id TEXT REFERENCES academic_years(id) ON DELETE RESTRICT, term_id TEXT REFERENCES terms(id) ON DELETE RESTRICT, class_id TEXT REFERENCES classes(id) ON DELETE RESTRICT, name TEXT NOT NULL, amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0), created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL"],
  ["invoices", "id TEXT PRIMARY KEY, school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE RESTRICT, student_id TEXT NOT NULL REFERENCES students(id) ON DELETE RESTRICT, invoice_number TEXT, amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0), due_on DATE, status TEXT NOT NULL DEFAULT 'outstanding', issued_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL, archived_at TIMESTAMPTZ, extra_data JSON NOT NULL DEFAULT '{}', UNIQUE (school_id, invoice_number)"],
  ["invoice_items", "id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE, fee_structure_id TEXT REFERENCES fee_structures(id) ON DELETE SET NULL, description TEXT NOT NULL, quantity NUMERIC(10,2) NOT NULL DEFAULT 1 CHECK (quantity > 0), unit_amount NUMERIC(12,2) NOT NULL CHECK (unit_amount >= 0), created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL"],
  ["payments", "id TEXT PRIMARY KEY, school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE RESTRICT, student_id TEXT NOT NULL REFERENCES students(id) ON DELETE RESTRICT, reference TEXT NOT NULL, amount NUMERIC(12,2) NOT NULL CHECK (amount > 0), method TEXT, paid_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL, extra_data JSON NOT NULL DEFAULT '{}', UNIQUE (school_id, reference)"],
  ["payment_allocations", "id TEXT PRIMARY KEY, payment_id TEXT NOT NULL REFERENCES payments(id) ON DELETE RESTRICT, invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT, amount NUMERIC(12,2) NOT NULL CHECK (amount > 0), created_at TIMESTAMPTZ NOT NULL, UNIQUE (payment_id, invoice_id)"],
  ["assignments", "id TEXT PRIMARY KEY, school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE RESTRICT, class_id TEXT REFERENCES classes(id) ON DELETE RESTRICT, subject_id TEXT REFERENCES subjects(id) ON DELETE RESTRICT, title TEXT NOT NULL CHECK (length(trim(title)) > 0), due_at TIMESTAMPTZ, max_score NUMERIC(10,2) CHECK (max_score IS NULL OR max_score > 0), created_by TEXT, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL, archived_at TIMESTAMPTZ, extra_data JSON NOT NULL DEFAULT '{}'"],
  ["assignment_submissions", "id TEXT PRIMARY KEY, school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE RESTRICT, assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE RESTRICT, student_id TEXT NOT NULL REFERENCES students(id) ON DELETE RESTRICT, submitted BOOLEAN NOT NULL DEFAULT FALSE, submitted_at TIMESTAMPTZ, score NUMERIC(10,2) CHECK (score IS NULL OR score >= 0), feedback TEXT, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL, archived_at TIMESTAMPTZ, extra_data JSON NOT NULL DEFAULT '{}', UNIQUE (assignment_id, student_id)"],
  ["library_books", "id TEXT PRIMARY KEY, school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE RESTRICT, title TEXT NOT NULL CHECK (length(trim(title)) > 0), author TEXT, isbn TEXT, category TEXT, copies_total INTEGER NOT NULL DEFAULT 0 CHECK (copies_total >= 0), copies_available INTEGER NOT NULL DEFAULT 0 CHECK (copies_available >= 0 AND copies_available <= copies_total), created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL, archived_at TIMESTAMPTZ, extra_data JSON NOT NULL DEFAULT '{}'"],
  ["library_copies", "id TEXT PRIMARY KEY, school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE RESTRICT, book_id TEXT NOT NULL REFERENCES library_books(id) ON DELETE RESTRICT, barcode TEXT, status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'loaned', 'lost', 'maintenance')), created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL, UNIQUE (school_id, barcode)"],
  ["library_loans", "id TEXT PRIMARY KEY, school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE RESTRICT, copy_id TEXT NOT NULL REFERENCES library_copies(id) ON DELETE RESTRICT, student_id TEXT NOT NULL REFERENCES students(id) ON DELETE RESTRICT, borrowed_at TIMESTAMPTZ NOT NULL, due_at TIMESTAMPTZ NOT NULL, returned_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL, archived_at TIMESTAMPTZ, extra_data JSON NOT NULL DEFAULT '{}'"],
  ["timetable_entries", "id TEXT PRIMARY KEY, school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE RESTRICT, class_id TEXT REFERENCES classes(id) ON DELETE RESTRICT, stream_id TEXT REFERENCES streams(id) ON DELETE RESTRICT, subject_id TEXT REFERENCES subjects(id) ON DELETE RESTRICT, teacher_id TEXT REFERENCES teachers(id) ON DELETE RESTRICT, day_of_week INTEGER CHECK (day_of_week BETWEEN 1 AND 7), starts_at TIME, ends_at TIME, effective_from DATE, effective_until DATE, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL, extra_data JSON NOT NULL DEFAULT '{}'"],
  ["announcements", "id TEXT PRIMARY KEY, school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE RESTRICT, title TEXT NOT NULL, body TEXT NOT NULL, audience TEXT, created_by TEXT, published_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL, archived_at TIMESTAMPTZ, extra_data JSON NOT NULL DEFAULT '{}'"],
  ["notifications", "id TEXT PRIMARY KEY, school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE RESTRICT, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL, body TEXT NOT NULL, read_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL, extra_data JSON NOT NULL DEFAULT '{}'"],
  ["messages", "id TEXT PRIMARY KEY, school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE RESTRICT, sender_id TEXT REFERENCES users(id) ON DELETE SET NULL, recipient_id TEXT REFERENCES users(id) ON DELETE SET NULL, body TEXT NOT NULL, sent_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL, extra_data JSON NOT NULL DEFAULT '{}'"],
  ["audit_logs", "id TEXT PRIMARY KEY, school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE RESTRICT, actor_user_id TEXT, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT, timestamp TIMESTAMPTZ NOT NULL, metadata JSON NOT NULL DEFAULT '{}', ip_address TEXT, user_agent TEXT, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL, extra_data JSON NOT NULL DEFAULT '{}'"],
  ["invite_codes", "id TEXT PRIMARY KEY, school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE RESTRICT, code TEXT NOT NULL UNIQUE, role_code TEXT NOT NULL REFERENCES roles(code) ON DELETE RESTRICT, student_id TEXT REFERENCES students(id) ON DELETE RESTRICT, teacher_id TEXT REFERENCES teachers(id) ON DELETE RESTRICT, created_by TEXT, expires_at TIMESTAMPTZ, used_at TIMESTAMPTZ, used_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL, extra_data JSON NOT NULL DEFAULT '{}'"],
  ["events", "id TEXT PRIMARY KEY, school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE RESTRICT, name TEXT NOT NULL, event_date DATE NOT NULL, description TEXT, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL, extra_data JSON NOT NULL DEFAULT '{}'"],
  ["chats", "id TEXT PRIMARY KEY, school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE RESTRICT, name TEXT NOT NULL, created_by TEXT, invite_code TEXT UNIQUE, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL, extra_data JSON NOT NULL DEFAULT '{}'"],
  ["chat_members", "chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TIMESTAMPTZ NOT NULL, PRIMARY KEY (chat_id, user_id)"],
  ["chat_messages", "id TEXT PRIMARY KEY, school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE RESTRICT, chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE, sender_id TEXT REFERENCES users(id) ON DELETE SET NULL, body TEXT NOT NULL, reply_to_id TEXT REFERENCES chat_messages(id) ON DELETE SET NULL, reactions_json JSON NOT NULL DEFAULT '{}', edited_at TIMESTAMPTZ, deleted_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL, extra_data JSON NOT NULL DEFAULT '{}'"],
  ["password_resets", "id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_hash TEXT NOT NULL UNIQUE, expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL, extra_data JSON NOT NULL DEFAULT '{}'"],
];

const indexes = [
  "CREATE INDEX IF NOT EXISTS idx_users_school_id ON users(school_id)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_normalized ON users(lower(email))",
  "CREATE INDEX IF NOT EXISTS idx_students_school_class ON students(school_id, class_id)",
  "CREATE INDEX IF NOT EXISTS idx_students_school_name ON students(school_id, name)",
  "CREATE INDEX IF NOT EXISTS idx_students_school_status ON students(school_id, status)",
  "CREATE INDEX IF NOT EXISTS idx_guardian_students_student ON guardian_students(student_id)",
  "CREATE INDEX IF NOT EXISTS idx_teachers_school_status ON teachers(school_id, status)",
  "CREATE INDEX IF NOT EXISTS idx_classes_school_id ON classes(school_id)",
  "CREATE INDEX IF NOT EXISTS idx_streams_class_id ON streams(class_id)",
  "CREATE INDEX IF NOT EXISTS idx_subjects_school_id ON subjects(school_id)",
  "CREATE INDEX IF NOT EXISTS idx_enrollments_student_year ON enrollments(student_id, academic_year_id)",
  "CREATE INDEX IF NOT EXISTS idx_teacher_assignments_teacher_class ON teacher_assignments(teacher_id, class_id)",
  "CREATE INDEX IF NOT EXISTS idx_attendance_school_date ON attendance(school_id, attendance_date)",
  "CREATE INDEX IF NOT EXISTS idx_attendance_student_date ON attendance(student_id, attendance_date)",
  "CREATE INDEX IF NOT EXISTS idx_results_assessment ON assessment_results(assessment_id)",
  "CREATE INDEX IF NOT EXISTS idx_results_student ON assessment_results(student_id)",
  "CREATE INDEX IF NOT EXISTS idx_invoices_school_student ON invoices(school_id, student_id)",
  "CREATE INDEX IF NOT EXISTS idx_invoices_status_due ON invoices(school_id, status, due_on)",
  "CREATE INDEX IF NOT EXISTS idx_payments_student_paid ON payments(student_id, paid_at)",
  "CREATE INDEX IF NOT EXISTS idx_payment_allocations_invoice ON payment_allocations(invoice_id)",
  "CREATE INDEX IF NOT EXISTS idx_assignments_class_due ON assignments(class_id, due_at)",
  "CREATE INDEX IF NOT EXISTS idx_submissions_student ON assignment_submissions(student_id)",
  "CREATE INDEX IF NOT EXISTS idx_library_copies_book_status ON library_copies(book_id, status)",
  "CREATE INDEX IF NOT EXISTS idx_library_loans_student_due ON library_loans(student_id, due_at)",
  "CREATE INDEX IF NOT EXISTS idx_timetable_class_teacher ON timetable_entries(class_id, teacher_id)",
  "CREATE INDEX IF NOT EXISTS idx_announcements_school_published ON announcements(school_id, published_at)",
  "CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_messages_recipient_sent ON messages(recipient_id, sent_at)",
  "CREATE INDEX IF NOT EXISTS idx_audit_logs_school_time ON audit_logs(school_id, timestamp)",
  "CREATE INDEX IF NOT EXISTS idx_audit_logs_school_action ON audit_logs(school_id, action, timestamp)",
  "CREATE INDEX IF NOT EXISTS idx_invites_school_status ON invite_codes(school_id, used_at, expires_at)",
  "CREATE INDEX IF NOT EXISTS idx_chat_messages_chat_created ON chat_messages(chat_id, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_password_resets_user_expiry ON password_resets(user_id, expires_at)",
];

async function up({ execute, dialect }) {
  const jsonType = dialect === "postgres" ? "JSONB" : "TEXT";
  const orderedNames = [
    "roles",
    "permissions",
    "schools",
    "role_permissions",
    "users",
    "user_roles",
    "teachers",
    "classes",
    "streams",
    "subjects",
    "students",
    "guardians",
    "guardian_students",
    "class_subjects",
    "academic_years",
    "terms",
    "enrollments",
    "teacher_assignments",
    "attendance",
    "assessments",
    "assessment_results",
    "fee_structures",
    "invoices",
    "invoice_items",
    "payments",
    "payment_allocations",
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
    "events",
    "invite_codes",
    "chats",
    "chat_members",
    "chat_messages",
    "password_resets",
  ];
  const definitions = new Map(tables);
  for (const table of orderedNames) {
    const schema = definitions.get(table);
    const converted = schema
      .replace(/TIMESTAMPTZ/g, dialect === "postgres" ? "TIMESTAMPTZ" : "TEXT")
      .replace(/NUMERIC\(([^)]+)\)/g, dialect === "postgres" ? "NUMERIC($1)" : "NUMERIC")
      .replace(/JSON\b/g, jsonType);
    await execute(`CREATE TABLE IF NOT EXISTS ${table} (${converted})`);
  }
  for (const index of indexes) await execute(index);

  const now = new Date().toISOString();
  for (const [code, name] of [
    ["admin", "Administrator"],
    ["teacher", "Teacher"],
    ["parent", "Parent"],
    ["student", "Student"],
  ]) {
    await execute(
      dialect === "postgres"
        ? "INSERT INTO roles (code, name, created_at, updated_at) VALUES ($1, $2, $3, $3) ON CONFLICT (code) DO NOTHING"
        : "INSERT OR IGNORE INTO roles (code, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
      dialect === "postgres" ? [code, name, now] : [code, name, now, now],
    );
  }
}

module.exports = {
  up,
};
