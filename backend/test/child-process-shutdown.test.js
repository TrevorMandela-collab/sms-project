"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const {
  combineSmokeErrors,
  observeChildExit,
  stopChildProcess,
} = require("./child-process-shutdown");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("shutdown observes a child that exited before cleanup began", async () => {
  const child = spawn(process.execPath, ["-e", "process.exit(7)"], {
    stdio: "ignore",
  });
  const waitForExit = observeChildExit(child);
  while (child.exitCode === null && child.signalCode === null) await sleep(10);

  const result = await stopChildProcess(child, waitForExit, 1000);
  assert.equal(result.code, 7);
  assert.equal(result.signal, null);
});

test("shutdown waits for a child to handle SIGTERM and close", async () => {
  const child = spawn(
    process.execPath,
    [
      "-e",
      "process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000)",
    ],
    { stdio: "ignore" },
  );
  const waitForExit = observeChildExit(child);

  const result = await stopChildProcess(child, waitForExit, 2000);
  assert.ok(result.code === 0 || result.signal === "SIGTERM");
});

test("shutdown escalates after its graceful deadline and reports the timeout", async () => {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  const signals = [];
  child.kill = (signal) => {
    signals.push(signal);
    if (signal === "SIGKILL") {
      child.signalCode = signal;
      child.emit("close", null, signal);
    }
    return true;
  };
  const waitForExit = observeChildExit(child);

  await assert.rejects(
    stopChildProcess(child, waitForExit, 50),
    (error) => error.code === "CHILD_EXIT_TIMEOUT",
  );
  assert.deepEqual(signals, [undefined, "SIGKILL"]);
});

test("cleanup errors preserve the original smoke-test failure", () => {
  const primaryError = new Error("request assertion failed");
  const cleanupError = new Error("socket cleanup failed");
  const combined = combineSmokeErrors(primaryError, [cleanupError]);

  assert.ok(combined instanceof AggregateError);
  assert.deepEqual(combined.errors, [primaryError, cleanupError]);
});
