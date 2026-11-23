"use strict";

const SAFE_EVENTS = new Set([
  "api.request_failed",
  "api.crud_request_failed",
  "api.chat_request_failed",
  "api.finance_request_failed",
  "api.guardians_request_failed",
  "api.transport_request_failed",
  "api.invite_codes_request_failed",
  "auth.suspension_check_failed",
  "database.operation_failed",
  "database.migration_failed",
  "database.migration_command_failed",
  "database.connection_close_failed",
  "database.startup_failed",
  "audit.read_event_failed",
  "server.shutdown_failed",
]);

const SAFE_RESOURCES = new Set([
  "students",
  "assignments",
  "teachers",
  "timetable",
  "attendance",
  "assignment-submissions",
  "exams",
  "fees",
  "library",
  "library-loans",
  "announcements",
  "classes",
  "subjects",
  "events",
  "chats",
  "chat-messages",
  "transport",
  "finance",
  "guardians",
  "invite-codes",
  "schools",
  "audit-logs",
  "roles",
  "auth",
  "qa",
  "dev-monitor",
  "exam-machine",
  "ai-assistant",
  "migrations",
  "database",
  "api",
]);

const SAFE_OPERATIONS = new Set([
  "postgres_idle_client",
  "transaction_rollback",
  "database_operation",
  "migration",
  "http_server_close",
]);

const SAFE_ERROR_CODES = new Set([
  "23502",
  "23503",
  "23505",
  "23514",
  "40001",
  "40P01",
  "53300",
  "57014",
  "08000",
  "08001",
  "08003",
  "08006",
  "SQLITE_BUSY",
  "SQLITE_BUSY_TIMEOUT",
  "SQLITE_CONSTRAINT",
  "SQLITE_CONSTRAINT_FOREIGNKEY",
  "SQLITE_CONSTRAINT_PRIMARYKEY",
  "SQLITE_CONSTRAINT_UNIQUE",
  "SQLITE_ERROR",
  "ABORT_ERR",
  "ECONNREFUSED",
  "ECONNRESET",
  "EAI_AGAIN",
  "ENOTFOUND",
  "ETIMEDOUT",
]);

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;

function errorClass(error) {
  try {
    if (error instanceof TypeError) return "TypeError";
    if (error instanceof RangeError) return "RangeError";
    if (error instanceof SyntaxError) return "SyntaxError";
    if (error instanceof ReferenceError) return "ReferenceError";
    if (error instanceof URIError) return "URIError";
    if (error instanceof EvalError) return "EvalError";
    return error instanceof Error ? "Error" : "UnknownError";
  } catch {
    return "UnknownError";
  }
}

function safeErrorCode(error) {
  if (!error || (typeof error !== "object" && typeof error !== "function")) {
    return "UNCLASSIFIED";
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, "code");
    const code = descriptor && Object.hasOwn(descriptor, "value")
      ? descriptor.value
      : null;
    return typeof code === "string" && SAFE_ERROR_CODES.has(code)
      ? code
      : "UNCLASSIFIED";
  } catch {
    return "UNCLASSIFIED";
  }
}

function safeRequestId(value) {
  return typeof value === "string" && REQUEST_ID_PATTERN.test(value)
    ? value
    : undefined;
}

function formatSafeDiagnostic(event, error, context = {}) {
  const diagnostic = {
    level: "error",
    event: SAFE_EVENTS.has(event) ? event : "api.request_failed",
    errorClass: errorClass(error),
    errorCode: safeErrorCode(error),
  };
  const requestId = safeRequestId(context.requestId);
  if (requestId) diagnostic.requestId = requestId;
  if (SAFE_RESOURCES.has(context.resource)) {
    diagnostic.resource = context.resource;
  }
  if (SAFE_OPERATIONS.has(context.operation)) {
    diagnostic.operation = context.operation;
  }
  if (
    context.migrationVersion !== undefined &&
    typeof context.migrationVersion === "string" &&
    /^\d{1,4}$/.test(context.migrationVersion)
  ) {
    diagnostic.migrationVersion = context.migrationVersion;
  }
  return diagnostic;
}

function logSafeError(event, error, context = {}, logger = console.error) {
  const diagnostic = formatSafeDiagnostic(event, error, context);
  logger(JSON.stringify(diagnostic));
  return diagnostic;
}

module.exports = { formatSafeDiagnostic, logSafeError };
