"use strict";

const net = require("node:net");

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const PRODUCTION_CONNECTION_VARIABLES = [
  "DATABASE_URL",
  "PGHOST",
  "PGPORT",
  "PGDATABASE",
  "PGUSER",
  "PGPASSWORD",
  "PGSERVICE",
  "PGSERVICEFILE",
  "PGOPTIONS",
  "PGSSLMODE",
  "PGSSLROOTCERT",
  "PGSSLCERT",
  "PGSSLKEY",
  "PGAPPNAME",
  "PGCONNECT_TIMEOUT",
];

function isPrivateIpv4Address(address) {
  const octets = address.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false;
  }
  const [first, second] = octets;
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function isPrivateServiceAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return isPrivateIpv4Address(address);
  if (family !== 6) return false;

  const mappedIpv4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  if (mappedIpv4 && net.isIP(mappedIpv4[1]) === 4) {
    return isPrivateIpv4Address(mappedIpv4[1]);
  }
  return /^(?:fc|fd)[0-9a-f]{2}$/i.test(address.split(":")[0]);
}

function parseExpectedServerAddresses(value) {
  if (value === undefined) return undefined;
  let addresses;
  try {
    addresses = JSON.parse(value);
  } catch {
    return null;
  }
  if (
    !Array.isArray(addresses) ||
    addresses.length === 0 ||
    addresses.some(
      (address) =>
        typeof address !== "string" ||
        !isPrivateServiceAddress(address.toLowerCase()),
    )
  ) {
    return null;
  }

  const normalizedAddresses = addresses.map((address) => address.toLowerCase());
  const uniqueAddresses = new Set(normalizedAddresses);
  return uniqueAddresses.size === normalizedAddresses.length
    ? uniqueAddresses
    : null;
}

function fail(message) {
  throw new Error(`PostgreSQL test safety check failed: ${message}`);
}

function validatePostgresTestConfiguration(env = process.env) {
  const required = env.REQUIRE_POSTGRES_TESTS === "1";
  if (env.REQUIRE_POSTGRES_TESTS && !required) {
    fail("REQUIRE_POSTGRES_TESTS must be set to '1' when provided.");
  }

  const connectionString = env.TEST_DATABASE_URL;
  if (!connectionString) {
    if (required) fail("TEST_DATABASE_URL is required.");
    return null;
  }

  if (env.POSTGRES_TEST_OPT_IN !== "1") {
    fail("set POSTGRES_TEST_OPT_IN=1 to explicitly allow the disposable test connection.");
  }
  if (env.POSTGRES_TEST_DISPOSABLE !== "1") {
    fail("set POSTGRES_TEST_DISPOSABLE=1 to confirm this database is disposable.");
  }
  if (env.NODE_ENV === "production") {
    fail("production NODE_ENV is not allowed.");
  }
  if (PRODUCTION_CONNECTION_VARIABLES.some((name) => env[name])) {
    fail("remove application or libpq connection variables before running PostgreSQL tests.");
  }

  const expectedDatabase = env.POSTGRES_TEST_EXPECTED_DATABASE;
  const expectedHost = env.POSTGRES_TEST_EXPECTED_HOST;
  const expectedUser = env.POSTGRES_TEST_EXPECTED_USER;
  const expectedPort = env.POSTGRES_TEST_EXPECTED_PORT;
  if (
    env.POSTGRES_TEST_EXPECTED_SERVER_ADDRESSES !== undefined &&
    !parseExpectedServerAddresses(env.POSTGRES_TEST_EXPECTED_SERVER_ADDRESSES)
  ) {
    fail("POSTGRES_TEST_EXPECTED_SERVER_ADDRESSES must be a non-empty JSON array of unique private IP addresses.");
  }
  if (!expectedDatabase || !/(^|[_-])test([_-]|$)/i.test(expectedDatabase)) {
    fail("POSTGRES_TEST_EXPECTED_DATABASE must explicitly identify a test database.");
  }
  if (/(^|[_-])(prod(uction)?|live|staging)([_-]|$)/i.test(expectedDatabase)) {
    fail("production-style database names are not allowed.");
  }
  if (!expectedHost || !LOOPBACK_HOSTS.has(expectedHost.toLowerCase())) {
    fail("POSTGRES_TEST_EXPECTED_HOST must be localhost or a loopback address.");
  }
  if (!expectedUser || !/(^|[_-])test([_-]|$)/i.test(expectedUser)) {
    fail("POSTGRES_TEST_EXPECTED_USER must explicitly identify a test user.");
  }
  if (!/^\d+$/.test(expectedPort || "")) {
    fail("POSTGRES_TEST_EXPECTED_PORT must be an explicit TCP port.");
  }

  let connection;
  try {
    connection = new URL(connectionString);
  } catch {
    fail("TEST_DATABASE_URL is invalid.");
  }

  const host = connection.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const port = connection.port || (connection.protocol === "postgres:" ? "5432" : "");
  let database;
  let username;
  try {
    database = decodeURIComponent(connection.pathname.slice(1));
    username = decodeURIComponent(connection.username);
  } catch {
    fail("TEST_DATABASE_URL contains invalid encoded connection fields.");
  }

  if (!["postgres:", "postgresql:"].includes(connection.protocol)) {
    fail("TEST_DATABASE_URL must use the PostgreSQL protocol.");
  }
  if (!LOOPBACK_HOSTS.has(host) || host !== expectedHost.toLowerCase()) {
    fail("the PostgreSQL host must match the explicitly configured loopback host.");
  }
  if (database !== expectedDatabase) {
    fail("the PostgreSQL database does not match POSTGRES_TEST_EXPECTED_DATABASE.");
  }
  if (port !== String(Number(expectedPort))) {
    fail("the PostgreSQL port does not match POSTGRES_TEST_EXPECTED_PORT.");
  }
  if (!username || username !== expectedUser) {
    fail("the PostgreSQL user does not match POSTGRES_TEST_EXPECTED_USER.");
  }
  if (connection.pathname !== `/${database}`) {
    fail("TEST_DATABASE_URL must identify exactly one database name.");
  }
  if (connection.search || connection.hash) {
    fail("query parameters and fragments are not allowed in TEST_DATABASE_URL.");
  }

  return connectionString;
}

module.exports = {
  parseExpectedServerAddresses,
  validatePostgresTestConfiguration,
};
