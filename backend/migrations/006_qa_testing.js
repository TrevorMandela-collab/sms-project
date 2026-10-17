// QA Testing tables. Owner-only data: every row belongs to one user (the QA owner).
// Plain TEXT timestamps (ISO strings) keep this identical on SQLite and Postgres.
async function up({ execute }) {
  await execute(`
    CREATE TABLE IF NOT EXISTS qa_test_results (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      environment TEXT NOT NULL CHECK (environment IN ('development', 'production')),
      test_id TEXT NOT NULL CHECK (length(test_id) BETWEEN 1 AND 40),
      status TEXT NOT NULL CHECK (status IN ('pass', 'fail', 'blocked', 'notrun')),
      actual_result TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (owner_user_id, environment, test_id)
    )
  `);
  await execute(`
    CREATE TABLE IF NOT EXISTS qa_bugs (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      environment TEXT NOT NULL CHECK (environment IN ('development', 'production')),
      title TEXT NOT NULL CHECK (length(trim(title)) > 0),
      severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
      steps TEXT NOT NULL DEFAULT '',
      expected_result TEXT NOT NULL DEFAULT '',
      actual_result TEXT NOT NULL DEFAULT '',
      evidence TEXT NOT NULL DEFAULT '',
      linked_test_id TEXT,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await execute(
    "CREATE INDEX IF NOT EXISTS idx_qa_results_owner_env ON qa_test_results(owner_user_id, environment)",
  );
  await execute(
    "CREATE INDEX IF NOT EXISTS idx_qa_bugs_owner_env ON qa_bugs(owner_user_id, environment)",
  );
}

module.exports = { up };