async function up({ execute }) {
  await execute(`
    CREATE TABLE IF NOT EXISTS exam_machine_papers (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
      class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE RESTRICT,
      subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
      teacher_id TEXT REFERENCES teachers(id) ON DELETE SET NULL,
      created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 2 AND 120),
      status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'review_pending', 'teacher_approved', 'review_rejected', 'published')),
      question_paper_json JSON NOT NULL,
      answer_sheet_json JSON NOT NULL,
      structural_marks_json JSON NOT NULL DEFAULT '[]',
      reviewed_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at TIMESTAMPTZ,
      review_comments TEXT NOT NULL DEFAULT '' CHECK (length(review_comments) <= 1000),
      published_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      UNIQUE (id, school_id),
      CHECK (
        (status NOT IN ('teacher_approved', 'published')) OR
        (reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL)
      ),
      CHECK ((status <> 'published') OR published_at IS NOT NULL)
    )
  `);
  await execute(`
    CREATE TABLE IF NOT EXISTS exam_machine_mcq_marks (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
      paper_id TEXT NOT NULL,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
      score NUMERIC(10,2) NOT NULL CHECK (score >= 0),
      max_score NUMERIC(10,2) NOT NULL CHECK (max_score > 0 AND score <= max_score),
      responses_json JSON NOT NULL,
      marking_method TEXT NOT NULL CHECK (marking_method = 'answer_sheet'),
      marked_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      FOREIGN KEY (paper_id, school_id) REFERENCES exam_machine_papers(id, school_id) ON DELETE CASCADE,
      UNIQUE (paper_id, student_id)
    )
  `);
  await execute(`
    CREATE TABLE IF NOT EXISTS exam_machine_structural_marks (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
      paper_id TEXT NOT NULL,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
      question_id TEXT NOT NULL CHECK (length(trim(question_id)) > 0),
      score NUMERIC(10,2) NOT NULL CHECK (score >= 0),
      feedback TEXT NOT NULL DEFAULT '' CHECK (length(feedback) <= 1000),
      marking_method TEXT NOT NULL CHECK (marking_method = 'manual'),
      marked_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      FOREIGN KEY (paper_id, school_id) REFERENCES exam_machine_papers(id, school_id) ON DELETE CASCADE,
      UNIQUE (paper_id, student_id, question_id)
    )
  `);
  await execute(
    "CREATE INDEX IF NOT EXISTS idx_exam_machine_papers_school_status ON exam_machine_papers(school_id, status, created_at)",
  );
  await execute(
    "CREATE INDEX IF NOT EXISTS idx_exam_machine_papers_teacher ON exam_machine_papers(teacher_id, school_id)",
  );
  await execute(
    "CREATE INDEX IF NOT EXISTS idx_exam_machine_mcq_student ON exam_machine_mcq_marks(school_id, student_id)",
  );
  await execute(
    "CREATE INDEX IF NOT EXISTS idx_exam_machine_structural_student ON exam_machine_structural_marks(school_id, student_id)",
  );
}

module.exports = { up };
