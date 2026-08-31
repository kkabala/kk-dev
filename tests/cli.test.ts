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

test("--help explains the available scaffold interface", () => {
  const capture = captureIo();

  const exitCode = runCli(["--help"], capture.io);

  assert.equal(exitCode, 0);
  assert.deepEqual(capture.stderr, []);
  assert.deepEqual(capture.stdout, [
    [
      "Exoframe — autonomous delivery around pstack",
      "",
      "Usage: exoframe [--help] [--version]",
      "",
      "Task commands are introduced by the Stage 1 run-state implementation.",
    ].join("\n"),
  ]);
});

test("--version prints the package version", () => {
  const capture = captureIo();

  const exitCode = runCli(["--version"], capture.io);

  assert.equal(exitCode, 0);
  assert.deepEqual(capture.stderr, []);
  assert.deepEqual(capture.stdout, ["0.0.0"]);
});

test("unknown arguments fail with an actionable message", () => {
  const capture = captureIo();

  const exitCode = runCli(["unknown"], capture.io);

  assert.equal(exitCode, 2);
  assert.deepEqual(capture.stdout, []);
  assert.deepEqual(capture.stderr, [
    "Unknown argument: unknown\nRun exoframe --help for usage.",
  ]);
});
