"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { validatePostgresTestConfiguration } = require("./postgres-test-safety");
const {
  assertDisposableDatabase,
  assertTargetIdentity,
  assertSchemaOwnership,
  dropOwnedTestSchema,
} = require("./postgres-test-schema");

const validEnvironment = {
  POSTGRES_TEST_OPT_IN: "1",
  POSTGRES_TEST_DISPOSABLE: "1",
  POSTGRES_TEST_EXPECTED_DATABASE: "sms_test",
  POSTGRES_TEST_EXPECTED_HOST: "localhost",
  POSTGRES_TEST_EXPECTED_PORT: "5432",
  POSTGRES_TEST_EXPECTED_USER: "sms_test",
  TEST_DATABASE_URL: "postgresql://sms_test:test-only-password@localhost:5432/sms_test",
};

test("PostgreSQL test safety requires a URL when CI requires PostgreSQL", () => {
  assert.throws(
    () => validatePostgresTestConfiguration({ REQUIRE_POSTGRES_TESTS: "1" }),
    /TEST_DATABASE_URL is required/,
  );
  assert.throws(
    () => validatePostgresTestConfiguration({
      REQUIRE_POSTGRES_TESTS: "1",
      DATABASE_URL: "postgresql://not-used@localhost:5432/application",
    }),
    /TEST_DATABASE_URL is required/,
  );
});

test("PostgreSQL test safety requires explicit opt-in and disposable confirmation", () => {
  const noOptIn = { ...validEnvironment };
  delete noOptIn.POSTGRES_TEST_OPT_IN;
  assert.throws(
    () => validatePostgresTestConfiguration(noOptIn),
    /POSTGRES_TEST_OPT_IN/,
  );

  const noDisposableConfirmation = { ...validEnvironment };
  delete noDisposableConfirmation.POSTGRES_TEST_DISPOSABLE;
  assert.throws(
    () => validatePostgresTestConfiguration(noDisposableConfirmation),
    /POSTGRES_TEST_DISPOSABLE/,
  );
});

test("PostgreSQL test safety rejects mismatched identity and unsafe URL options", () => {
  assert.throws(
    () => validatePostgresTestConfiguration({
      ...validEnvironment,
      POSTGRES_TEST_EXPECTED_DATABASE: "sms_production",
    }),
    /must explicitly identify a test database/,
  );
  assert.throws(
    () => validatePostgresTestConfiguration({
      ...validEnvironment,
      POSTGRES_TEST_EXPECTED_DATABASE: "production_test",
    }),
    /production-style database names/,
  );
  assert.throws(
    () => validatePostgresTestConfiguration({
      ...validEnvironment,
      POSTGRES_TEST_EXPECTED_USER: "postgres",
    }),
    /must explicitly identify a test user/,
  );
  assert.throws(
    () => validatePostgresTestConfiguration({
      ...validEnvironment,
      TEST_DATABASE_URL: "postgresql://sms_test:test-only-password@db.example:5432/sms_test",
    }),
    /loopback host/,
  );
  assert.throws(
    () => validatePostgresTestConfiguration({
      ...validEnvironment,
      TEST_DATABASE_URL: "postgresql://sms_test:test-only-password@localhost:5432/other_test",
    }),
    /does not match POSTGRES_TEST_EXPECTED_DATABASE/,
  );
  assert.throws(
    () => validatePostgresTestConfiguration({
      ...validEnvironment,
      TEST_DATABASE_URL: "postgresql://other_test:test-only-password@localhost:5432/sms_test",
    }),
    /does not match POSTGRES_TEST_EXPECTED_USER/,
  );
  assert.throws(
    () => validatePostgresTestConfiguration({
      ...validEnvironment,
      TEST_DATABASE_URL: "postgresql://sms_test:test-only-password@localhost:5433/sms_test",
    }),
    /does not match POSTGRES_TEST_EXPECTED_PORT/,
  );
  assert.throws(
    () => validatePostgresTestConfiguration({
      ...validEnvironment,
      TEST_DATABASE_URL: `${validEnvironment.TEST_DATABASE_URL}?options=-c%20search_path=public`,
    }),
    /query parameters and fragments/,
  );
});

test("PostgreSQL test safety rejects production-style configuration", () => {
  assert.throws(
    () => validatePostgresTestConfiguration({
      ...validEnvironment,
      DATABASE_URL: "postgresql://application:secret@db.example/app",
    }),
    /application or libpq connection variables/,
  );
  assert.throws(
    () => validatePostgresTestConfiguration({
      ...validEnvironment,
      NODE_ENV: "production",
    }),
    /production NODE_ENV/,
  );
});

test("PostgreSQL test safety accepts an explicitly opted-in loopback test database", () => {
  assert.equal(
    validatePostgresTestConfiguration(validEnvironment),
    validEnvironment.TEST_DATABASE_URL,
  );
  const ipv4LoopbackEnvironment = {
    ...validEnvironment,
    POSTGRES_TEST_EXPECTED_HOST: "127.0.0.1",
    TEST_DATABASE_URL: "postgresql://sms_test:test-only-password@127.0.0.1:5432/sms_test",
  };
  assert.equal(
    validatePostgresTestConfiguration(ipv4LoopbackEnvironment),
    ipv4LoopbackEnvironment.TEST_DATABASE_URL,
  );
});

test("PostgreSQL schema harness accepts an explicitly discovered CI service address", () => {
  const serviceAddress = "172.20.10.4";
  const serviceEnvironment = {
    ...validEnvironment,
    POSTGRES_TEST_EXPECTED_SERVER_ADDRESSES: JSON.stringify([serviceAddress]),
  };
  assert.equal(
    validatePostgresTestConfiguration(serviceEnvironment),
    serviceEnvironment.TEST_DATABASE_URL,
  );
  assert.doesNotThrow(() =>
    assertTargetIdentity(
      {
        database_name: "sms_test",
        user_name: "sms_test",
        server_address: serviceAddress,
        server_port: 5432,
      },
      serviceEnvironment,
    ),
  );
});

test("PostgreSQL schema harness permits local loopback without a service address", () => {
  for (const address of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
    assert.doesNotThrow(() =>
      assertTargetIdentity(
        {
          database_name: "sms_test",
          user_name: "sms_test",
          server_address: address,
          server_port: 5432,
        },
        validEnvironment,
      ),
    );
  }
});

test("PostgreSQL schema harness rejects private, public and malformed unpinned addresses", () => {
  for (const address of [
    "10.1.2.3",
    "172.18.0.2",
    "192.168.1.10",
    "fd00::2",
    "fc00::1",
    "8.8.8.8",
    "2001:4860:4860::8888",
    "not-an-ip",
    "172.16.0.999",
    null,
  ]) {
    assert.throws(
      () =>
        assertTargetIdentity(
          {
            database_name: "sms_test",
            user_name: "sms_test",
            server_address: address,
            server_port: 5432,
          },
          validEnvironment,
        ),
      /identity did not match/,
      `expected ${String(address)} to be rejected`,
    );
  }
});

test("PostgreSQL schema identity errors identify only the mismatched address", () => {
  const invalidServerAddress = "172.18.0.2/32";
  assert.throws(
    () =>
      assertTargetIdentity(
        {
          database_name: "sms_test",
          user_name: "sms_test",
          server_address: invalidServerAddress,
          server_port: 5432,
        },
        validEnvironment,
      ),
    /server address \(invalid \("172\.18\.0\.2\/32"\)\)/,
  );
  assert.throws(
    () =>
      assertTargetIdentity(
        {
          database_name: "sms_test",
          user_name: "sms_test",
          server_address: null,
          server_port: 5432,
        },
        validEnvironment,
      ),
    /server address \(null\)/,
  );
});

test("PostgreSQL schema harness rejects database, user, port and service-address mismatches", () => {
  const serviceEnvironment = {
    ...validEnvironment,
    POSTGRES_TEST_EXPECTED_SERVER_ADDRESSES: JSON.stringify(["172.20.10.4"]),
  };
  for (const identity of [
    {
      database_name: "wrong_test",
      user_name: "sms_test",
      server_address: "172.20.10.4",
      server_port: 5432,
    },
    {
      database_name: "sms_test",
      user_name: "wrong_test",
      server_address: "172.20.10.4",
      server_port: 5432,
    },
    {
      database_name: "sms_test",
      user_name: "sms_test",
      server_address: "172.20.10.4",
      server_port: 5433,
    },
    {
      database_name: "sms_test",
      user_name: "sms_test",
      server_address: "172.20.10.5",
      server_port: 5432,
    },
  ]) {
    assert.throws(
      () => assertTargetIdentity(identity, serviceEnvironment),
      /identity did not match/,
    );
  }
  assert.throws(
    () => assertTargetIdentity(null, serviceEnvironment),
    /identity did not match/,
  );
});

test("PostgreSQL test safety rejects malformed or public expected service addresses", () => {
  for (const addresses of [
    "not-json",
    "[]",
    JSON.stringify(["not-an-ip"]),
    JSON.stringify(["8.8.8.8"]),
    JSON.stringify(["2001:4860:4860::8888"]),
    JSON.stringify(["172.20.10.4", "172.20.10.4"]),
  ]) {
    assert.throws(
      () =>
        validatePostgresTestConfiguration({
          ...validEnvironment,
          POSTGRES_TEST_EXPECTED_SERVER_ADDRESSES: addresses,
        }),
      /POSTGRES_TEST_EXPECTED_SERVER_ADDRESSES/,
    );
  }
});

test("PostgreSQL schema cleanup requires the expected owner", () => {
  assert.doesNotThrow(() =>
    assertSchemaOwnership({ owner: "sms_test" }, "sms_test"),
  );
  assert.throws(
    () => assertSchemaOwnership({ owner: "other_user" }, "sms_test"),
    /ownership changed before cleanup/,
  );
  assert.throws(
    () => assertSchemaOwnership(undefined, "sms_test"),
    /ownership changed before cleanup/,
  );
});

test("PostgreSQL schema cleanup never drops a schema after identity or owner mismatch", async () => {
  const serviceEnvironment = {
    ...validEnvironment,
    POSTGRES_TEST_EXPECTED_SERVER_ADDRESSES: JSON.stringify(["172.18.0.2"]),
  };
  const identity = {
    database_name: "sms_test",
    user_name: "sms_test",
    server_address: "172.18.0.2",
    server_port: 5432,
  };
  for (const { serverIdentity, owner, expectedError } of [
    {
      serverIdentity: identity,
      owner: "other_user",
      expectedError: /ownership changed before cleanup/,
    },
    {
      serverIdentity: { ...identity, database_name: "wrong_test" },
      owner: "sms_test",
      expectedError: /identity did not match/,
    },
  ]) {
    let droppedSchema = false;
    let ownershipChecked = false;
    const client = {
      query: async (sql) => {
        if (sql.includes("current_database()")) {
          return { rows: [serverIdentity] };
        }
        if (sql.includes("pg_get_userbyid")) {
          ownershipChecked = true;
          return { rows: [{ owner }] };
        }
        if (sql.startsWith("DROP SCHEMA")) {
          droppedSchema = true;
          return { rows: [] };
        }
        throw new Error("Unexpected cleanup query.");
      },
    };

    await assert.rejects(
      dropOwnedTestSchema(
        client,
        "novexa_migration_test_123_abcdef",
        serviceEnvironment,
      ),
      expectedError,
    );
    assert.equal(droppedSchema, false);
    assert.equal(
      ownershipChecked,
      serverIdentity.database_name === "sms_test",
    );
  }
});

test("PostgreSQL schema harness rejects databases with existing user data schemas", async () => {
  const emptyClient = {
    query: async () => ({ rowCount: 0, rows: [] }),
  };
  await assert.doesNotReject(() => assertDisposableDatabase(emptyClient));

  const populatedClient = {
    query: async () => ({ rowCount: 1, rows: [{ nspname: "school_data" }] }),
  };
  await assert.rejects(
    assertDisposableDatabase(populatedClient),
    /contains a user schema/,
  );

  let queryCount = 0;
  const populatedPublicSchema = {
    query: async () => ({
      rowCount: queryCount++ === 0 ? 0 : 1,
      rows: [],
    }),
  };
  await assert.rejects(
    assertDisposableDatabase(populatedPublicSchema),
    /contains public relations/,
  );
});

test("PostgreSQL test safety permits SQLite mode when PostgreSQL is not required", () => {
  assert.equal(validatePostgresTestConfiguration({}), null);
});
