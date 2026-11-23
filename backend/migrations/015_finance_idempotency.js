async function up({ execute, dialect }) {
  const responseJsonType = dialect === "postgres"
    ? "JSONB"
    : "TEXT CHECK (response_json IS NULL OR json_valid(response_json))";
  const requestHashCheck = dialect === "postgres"
    ? "request_hash ~ '^[0-9a-f]{64}$'"
    : "request_hash NOT GLOB '*[^0-9a-f]*' AND length(request_hash) = 64";

  await execute(`
    CREATE TABLE finance_idempotency_operations (
      id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
      user_id TEXT NOT NULL,
      operation_type TEXT NOT NULL CHECK (length(trim(operation_type)) BETWEEN 1 AND 64),
      idempotency_key TEXT NOT NULL CHECK (length(trim(idempotency_key)) BETWEEN 1 AND 255),
      request_hash TEXT NOT NULL CHECK (${requestHashCheck}),
      state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'completed')),
      resource_id TEXT,
      response_status INTEGER,
      response_json ${responseJsonType},
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      UNIQUE (school_id, user_id, operation_type, idempotency_key),
      FOREIGN KEY (user_id, school_id)
        REFERENCES users(id, school_id) ON DELETE RESTRICT,
      CHECK (
        (state = 'pending'
          AND resource_id IS NULL
          AND response_status IS NULL
          AND response_json IS NULL)
        OR
        (state = 'completed'
          AND resource_id IS NOT NULL
          AND length(trim(resource_id)) > 0
          AND response_status IS NOT NULL
          AND response_status BETWEEN 200 AND 299
          AND response_json IS NOT NULL)
      )
    )
  `);
}

module.exports = { up };
