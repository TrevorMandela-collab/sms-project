"use strict";

function observeChildExit(child) {
  let spawnError;
  const closed = new Promise((resolve) => {
    child.once("error", (error) => {
      spawnError = error;
    });
    child.once("close", (code, signal) => {
      resolve({ code, signal, spawnError });
    });
  });

  return async function waitForExit(timeoutMs) {
    let timer;
    try {
      const result = await Promise.race([
        closed,
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            const error = new Error(
              "Smoke-test server did not exit before the timeout",
            );
            error.code = "CHILD_EXIT_TIMEOUT";
            reject(error);
          }, timeoutMs);
        }),
      ]);
      if (result.spawnError) throw result.spawnError;
      return result;
    } finally {
      clearTimeout(timer);
    }
  };
}

async function stopChildProcess(child, waitForExit, gracefulTimeoutMs = 5000) {
  if (child.exitCode === null && child.signalCode === null) child.kill();
  try {
    return await waitForExit(gracefulTimeoutMs);
  } catch (error) {
    if (error.code !== "CHILD_EXIT_TIMEOUT") throw error;

    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
    try {
      await waitForExit(1000);
    } catch (forceError) {
      throw new AggregateError(
        [error, forceError],
        "Smoke-test server did not exit after forced shutdown.",
      );
    }
    throw error;
  }
}

function combineSmokeErrors(primaryError, cleanupErrors) {
  if (primaryError && cleanupErrors.length) {
    return new AggregateError(
      [primaryError, ...cleanupErrors],
      "Smoke test failed and cleanup encountered additional errors.",
    );
  }
  if (primaryError) return primaryError;
  if (cleanupErrors.length === 1) return cleanupErrors[0];
  if (cleanupErrors.length > 1) {
    return new AggregateError(cleanupErrors, "Smoke-test cleanup failed.");
  }
  return null;
}

module.exports = {
  combineSmokeErrors,
  observeChildExit,
  stopChildProcess,
};
