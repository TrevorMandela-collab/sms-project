async function addColumnIfMissing({ all, execute, dialect }, table, column, definition) {
  const rows =
    dialect === "postgres"
      ? await all(
          "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1",
          [table],
        )
      : await all(`PRAGMA table_info(${table})`);
  const exists = rows.some(
    (row) => (row.column_name || row.name) === column,
  );
  if (!exists) {
    await execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

async function up(context) {
  await addColumnIfMissing(
    context,
    "qa_test_runs",
    "duration_ms",
    "INTEGER CHECK (duration_ms IS NULL OR duration_ms BETWEEN 0 AND 86400000)",
  );
  await addColumnIfMissing(
    context,
    "qa_test_run_results",
    "failure_reason",
    "TEXT NOT NULL DEFAULT ''",
  );
  await addColumnIfMissing(
    context,
    "qa_test_run_results",
    "evidence",
    "TEXT NOT NULL DEFAULT ''",
  );
}

module.exports = { up };
