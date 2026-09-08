import assert from "node:assert/strict";
import test from "node:test";

import { runCli } from "../src/cli.ts";

type CapturedIo = Readonly<{
  io: {
    error(message: string): void;
    log(message: string): void;
  };
  stderr: string[];
  stdout: string[];
}>;

function captureIo(): CapturedIo {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      error(message) {
        stderr.push(message);
      },
      log(message) {
        stdout.push(message);
      },
    },
    stderr,
    stdout,
  };
}

test("--help explains the available task lifecycle interface", async () => {
  const capture = captureIo();

  const exitCode = await runCli(["--help"], capture.io);

  assert.equal(exitCode, 0);
  assert.deepEqual(capture.stderr, []);
  assert.deepEqual(capture.stdout, [
    [
      "Exoframe — autonomous delivery around pstack",
      "",
      "Usage:",
      "  exoframe run <task text>",
      "  exoframe status [task-id]",
      "  exoframe explain [task-id]",
      "  exoframe resume <task-id>",
      "  exoframe evidence show <gate-id>",
      "  exoframe gate run --task <task-id> --gate <gate-id>",
      "  exoframe surfaces explain <path>",
      "  exoframe policy check",
      "  exoframe risk-bootstrap",
      "  exoframe --help",
      "  exoframe --version",
    ].join("\n"),
  ]);
});

test("--version prints the package version", async () => {
  const capture = captureIo();

  const exitCode = await runCli(["--version"], capture.io);

  assert.equal(exitCode, 0);
  assert.deepEqual(capture.stderr, []);
  assert.deepEqual(capture.stdout, ["0.0.0"]);
});

test("unknown arguments fail with an actionable message", async () => {
  const capture = captureIo();

  const exitCode = await runCli(["unknown"], capture.io);

  assert.equal(exitCode, 2);
  assert.deepEqual(capture.stdout, []);
  assert.deepEqual(capture.stderr, [
    "Unknown argument: unknown\nRun exoframe --help for usage.",
  ]);
});

test("risk-bootstrap rejects extra arguments before touching a checkout", async () => {
  const capture = captureIo();

  const exitCode = await runCli(["risk-bootstrap", "extra"], capture.io);

  assert.equal(exitCode, 2);
  assert.deepEqual(capture.stdout, []);
  assert.match(
    capture.stderr.join("\n"),
    /risk-bootstrap does not take arguments/u,
  );
});
