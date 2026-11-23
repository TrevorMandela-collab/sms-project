async function up({ execute }) {
  await execute(`
    CREATE TABLE IF NOT EXISTS qa_test_runs (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      environment TEXT NOT NULL CHECK (environment IN ('development', 'production')),
      name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
      created_at TEXT NOT NULL
    )
  `);
  await execute(`
    CREATE TABLE IF NOT EXISTS qa_test_run_results (
      run_id TEXT NOT NULL REFERENCES qa_test_runs(id) ON DELETE CASCADE,
      test_id TEXT NOT NULL CHECK (length(test_id) BETWEEN 1 AND 40),
      status TEXT NOT NULL CHECK (status IN ('pass', 'fail', 'blocked', 'notrun')),
      actual_result TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (run_id, test_id)
    )
  `);
  await execute(
    "CREATE INDEX IF NOT EXISTS idx_qa_test_runs_owner_env ON qa_test_runs(owner_user_id, environment, created_at)",
  );
}

module.exports = { up };
