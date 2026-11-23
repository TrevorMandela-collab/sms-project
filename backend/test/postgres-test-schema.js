"use strict";

const crypto = require("node:crypto");
const net = require("node:net");
const { Client } = require("pg");
const {
  parseExpectedServerAddresses,
  validatePostgresTestConfiguration,
} = require("./postgres-test-safety");

const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

function isApprovedServerAddress(address, environment) {
  if (typeof address !== "string") return false;
  const normalizedAddress = address.toLowerCase();
  if (net.isIP(normalizedAddress) === 0) return false;

  const expectedAddresses = parseExpectedServerAddresses(
    environment.POSTGRES_TEST_EXPECTED_SERVER_ADDRESSES,
  );
  if (expectedAddresses === undefined) {
    return LOOPBACK_ADDRESSES.has(normalizedAddress);
  }
  return expectedAddresses !== null && expectedAddresses.has(normalizedAddress);
}

function safeFailure(operation, error) {
  const code = typeof error?.code === "string" ? ` (${error.code})` : "";
  return new Error(`PostgreSQL test ${operation} failed${code}.`);
}

function assertTargetIdentity(row, environment) {
  if (!row || typeof row !== "object") {
    throw new Error("Connected PostgreSQL server identity did not match the test target.");
  }

  const mismatches = [];
  if (row.database_name !== environment.POSTGRES_TEST_EXPECTED_DATABASE) {
    mismatches.push("database");
  }
  if (row.user_name !== environment.POSTGRES_TEST_EXPECTED_USER) {
    mismatches.push("user");
  }
  if (Number(row.server_port) !== Number(environment.POSTGRES_TEST_EXPECTED_PORT)) {
    mismatches.push("port");
  }
  if (!isApprovedServerAddress(row.server_address, environment)) {
    const address =
      row.server_address === null
        ? "null"
        : typeof row.server_address === "string" && net.isIP(row.server_address)
          ? row.server_address
          : `invalid (${typeof row.server_address})`;
    mismatches.push(`server address (${address})`);
  }
  if (mismatches.length) {
    throw new Error(
      `Connected PostgreSQL server identity did not match the test target (${mismatches.join(", ")}).`,
    );
  }
}

function assertSchemaOwnership(row, expectedUser) {
  if (!expectedUser || row?.owner !== expectedUser) {
    throw new Error("PostgreSQL test schema ownership changed before cleanup.");
  }
}

async function dropOwnedTestSchema(client, schema, environment) {
  const identity = (
    await client.query(`
      SELECT current_database() AS database_name,
             current_user AS user_name,
             inet_server_addr()::text AS server_address,
             inet_server_port() AS server_port
    `)
  ).rows[0];
  assertTargetIdentity(identity, environment);

  const ownership = await client.query(
    "SELECT pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname = $1",
    [schema],
  );
  assertSchemaOwnership(
    ownership.rows[0],
    environment.POSTGRES_TEST_EXPECTED_USER,
  );
  await client.query(`DROP SCHEMA "${schema}" CASCADE`);
}

async function assertDisposableDatabase(client) {
  const userSchemas = await client.query(`
    SELECT nspname
    FROM pg_namespace
    WHERE nspname NOT IN ('public', 'information_schema')
      AND left(nspname, 3) <> 'pg_'
    LIMIT 1
  `);
  if (userSchemas.rowCount) {
    throw new Error("PostgreSQL test database contains a user schema.");
  }

  const publicRelations = await client.query(`
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
    LIMIT 1
  `);
  if (publicRelations.rowCount) {
    throw new Error("PostgreSQL test database contains public relations.");
  }
}

async function withPostgresTestSchema(work) {
  if (typeof work !== "function") {
    throw new TypeError("withPostgresTestSchema requires a callback.");
  }

  const environment = {
    ...process.env,
    REQUIRE_POSTGRES_TESTS: "1",
  };
  const connectionString = validatePostgresTestConfiguration(environment);
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const client = new Client({ connectionString, connectionTimeoutMillis: 5000 });
  let database;
  let schema;
  let schemaCreated = false;
  let primaryError;
  let cleanupError;

  try {
    try {
      await client.connect();
    } catch (error) {
      throw safeFailure("connection", error);
    }

    let identity;
    try {
      identity = (
        await client.query(`
          SELECT current_database() AS database_name,
                 current_user AS user_name,
                 inet_server_addr()::text AS server_address,
                 inet_server_port() AS server_port
        `)
      ).rows[0];
    } catch (error) {
      throw safeFailure("identity verification", error);
    }
    assertTargetIdentity(identity, environment);
    await assertDisposableDatabase(client);

    schema = `novexa_migration_test_${process.pid}_${crypto.randomBytes(8).toString("hex")}`;
    const existing = await client.query(
      "SELECT 1 FROM pg_namespace WHERE nspname = $1",
      [schema],
    );
    if (existing.rowCount) {
      throw new Error("Generated PostgreSQL test schema already exists.");
    }
    await client.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    await client.query(`SET search_path TO "${schema}"`);

    const scopedUrl = new URL(connectionString);
    scopedUrl.searchParams.set("options", `-c search_path=${schema}`);
    process.env.DATABASE_URL = scopedUrl.toString();
    database = require("../utils/db");

    return await work({ db: database, client, schema });
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    if (database) {
      try {
        await database.close();
      } catch (error) {
        cleanupError = safeFailure("pool shutdown", error);
      }
    }

    if (schemaCreated) {
      try {
        await dropOwnedTestSchema(client, schema, environment);
      } catch (error) {
        cleanupError = cleanupError || safeFailure("isolated schema cleanup", error);
      }
    }

    try {
      await client.end();
    } catch (error) {
      cleanupError = cleanupError || safeFailure("control connection shutdown", error);
    }

    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;

    if (cleanupError) {
      if (primaryError) {
        throw new AggregateError(
          [primaryError, cleanupError],
          "PostgreSQL test failed and isolated schema cleanup was unsuccessful.",
        );
      }
      throw cleanupError;
    }
  }
}

module.exports = {
  assertDisposableDatabase,
  assertTargetIdentity,
  assertSchemaOwnership,
  dropOwnedTestSchema,
  withPostgresTestSchema,
};
