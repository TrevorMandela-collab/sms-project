async function up({ execute }) {
  await execute(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_students_id_school_transport ON students(id, school_id)",
  );
  await execute(`
    CREATE TABLE IF NOT EXISTS transport_routes (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
      name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
      vehicle TEXT NOT NULL CHECK (length(trim(vehicle)) BETWEEN 1 AND 120),
      driver_name TEXT,
      driver_phone TEXT,
      pickup_time TEXT,
      dropoff_time TEXT,
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT,
      UNIQUE (id, school_id)
    )
  `);
  await execute(`
    CREATE TABLE IF NOT EXISTS student_transport_assignments (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
      route_id TEXT NOT NULL,
      student_id TEXT NOT NULL,
      pickup_location TEXT NOT NULL CHECK (length(trim(pickup_location)) BETWEEN 1 AND 200),
      dropoff_location TEXT NOT NULL CHECK (length(trim(dropoff_location)) BETWEEN 1 AND 200),
      fee_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (fee_amount >= 0),
      starts_on TEXT,
      ends_on TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT,
      CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on),
      FOREIGN KEY (route_id, school_id) REFERENCES transport_routes(id, school_id) ON DELETE RESTRICT,
      FOREIGN KEY (student_id, school_id) REFERENCES students(id, school_id) ON DELETE RESTRICT
    )
  `);
  await execute(
    "CREATE INDEX IF NOT EXISTS idx_transport_routes_school_status ON transport_routes(school_id, status, archived_at)",
  );
  await execute(
    "CREATE INDEX IF NOT EXISTS idx_transport_assignments_school_student ON student_transport_assignments(school_id, student_id, status, archived_at)",
  );
  await execute(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_transport_one_active_assignment ON student_transport_assignments(student_id) WHERE status = 'active' AND archived_at IS NULL",
  );
}

module.exports = { up };
