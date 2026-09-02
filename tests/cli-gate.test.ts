import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { RUNNER_ATTEMPTS } from "../src/index.ts";

type CommandResult = Readonly<{
  exitCode: number;
  stderr: string;
  stdout: string;
}>;

const binPath = fileURLToPath(new URL("../src/bin.ts", import.meta.url));
const probeSource =
  'process.stdout.write(JSON.stringify({ outcome: "PRODUCT_PASS" }));\n';

function invokeCli(
  stateRoot: string,
  workingDirectory: string,
  args: readonly string[],
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [binPath, ...args], {
      cwd: workingDirectory,
      env: {
        ...process.env,
        EXOFRAME_STATE_ROOT: stateRoot,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (exitCode) => {
      if (exitCode === null) {
        reject(new Error("Exoframe CLI exited without a numeric status"));
        return;
      }
      resolve({ exitCode, stderr, stdout });
    });
  });
}

async function measurementNames(stateRoot: string): Promise<string[]> {
  try {
    const names = await readdir(join(stateRoot, "evidence", "measurements"));
    return names.filter((name) => name.endsWith(".json")).sort();
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return [];
    }
    throw error;
  }
}

async function decisionNames(stateRoot: string): Promise<string[]> {
  try {
    const names = await readdir(join(stateRoot, "evidence", "decisions"));
    return names.filter((name) => name.endsWith(".json")).sort();
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return [];
    }
    throw error;
  }
}

async function writeProtectedCatalog(checkout: string): Promise<void> {
  await mkdir(join(checkout, ".exoframe"), { recursive: true });
  await writeFile(join(checkout, "probe.mjs"), probeSource, "utf8");
  await writeFile(
    join(checkout, ".exoframe", "templates.json"),
    JSON.stringify({
      schema_version: 1,
      templates: [
        {
          schema_version: 1,
          id: "g1.probe",
          gate_class: "G1",
          command: {
            argv: [process.execPath, join(checkout, "probe.mjs")],
          },
          timeout_seconds: 30,
          network: "none",
          writable_roots: [],
          result_schema: "schemas/g1-probe-result.json",
          artifact_allowlist: [],
        },
      ],
    }),
    "utf8",
  );
}

test("raw command text and caller argv cannot create authoritative evidence", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "exoframe-cli-gate-raw-"));
  t.after(async () => rm(sandbox, { recursive: true, force: true }));
  const stateRoot = join(sandbox, "state");
  const checkout = join(sandbox, "checkout");
  await mkdir(checkout);
  await writeProtectedCatalog(checkout);
  await mkdir(stateRoot);

  for (const args of [
    ["gate", "run", "--cmd", "true"],
    ["gate", "run", "--task", "task-1", "--gate", "g1.probe", "--cmd", "rm"],
    ["gate", "run", "--task", "task-1", "--gate", "g1.probe", "--command", "npm"],
    ["gate", "run", "--task", "task-1", "--gate", "g1.probe", "bash", "-c", "true"],
    ["evidence", "show", "--cmd", "true"],
  ] as const) {
    const result = await invokeCli(stateRoot, checkout, args);
    assert.equal(result.exitCode, 2, args.join(" "));
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /Raw command is not allowed/u);
    assert.deepEqual(await readdir(stateRoot), []);
    assert.deepEqual(await measurementNames(stateRoot), []);
  }
});

test("gate run looks up a protected template by gate ID and writes authoritative evidence", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "exoframe-cli-gate-run-"));
  t.after(async () => rm(sandbox, { recursive: true, force: true }));
  const stateRoot = join(sandbox, "state");
  const checkout = join(sandbox, "checkout");
  await mkdir(checkout);
  await writeProtectedCatalog(checkout);

  const started = await invokeCli(stateRoot, checkout, [
    "run",
    "Add CSV export to the orders page",
  ]);
  assert.equal(started.exitCode, 0, started.stderr);
  const view = JSON.parse(started.stdout) as {
    task: { task_id: string };
  };

  const result = await invokeCli(stateRoot, checkout, [
    "gate",
    "run",
    "--task",
    view.task.task_id,
    "--gate",
    "g1.probe",
  ]);
  assert.equal(result.exitCode, 0, result.stderr);
  const session = JSON.parse(result.stdout) as {
    status: string;
    measurements: readonly {
      authoritative: boolean;
      gate_id: string;
      outcome: string;
      task_id: string;
    }[];
  };
  assert.equal(session.status, "measured");
  assert.equal(session.measurements.length, 1);
  assert.equal(session.measurements[0]?.authoritative, true);
  assert.equal(session.measurements[0]?.gate_id, "g1.probe");
  assert.equal(session.measurements[0]?.task_id, view.task.task_id);
  assert.equal(session.measurements[0]?.outcome, RUNNER_ATTEMPTS.PRODUCT_PASS);
  assert.equal((await measurementNames(stateRoot)).length, 1);
});

test("evidence show displays stored measurements without writing", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "exoframe-cli-evidence-show-"));
  t.after(async () => rm(sandbox, { recursive: true, force: true }));
  const stateRoot = join(sandbox, "state");
  const checkout = join(sandbox, "checkout");
  await mkdir(checkout);
  await writeProtectedCatalog(checkout);

  const started = await invokeCli(stateRoot, checkout, [
    "run",
    "Add CSV export to the orders page",
  ]);
  assert.equal(started.exitCode, 0, started.stderr);
  const view = JSON.parse(started.stdout) as {
    task: { task_id: string };
  };
  const ran = await invokeCli(stateRoot, checkout, [
    "gate",
    "run",
    "--gate",
    "g1.probe",
    "--task",
    view.task.task_id,
  ]);
  assert.equal(ran.exitCode, 0, ran.stderr);
  const beforeMeasurements = await measurementNames(stateRoot);
  const beforeDecisions = await decisionNames(stateRoot);
  assert.equal(beforeMeasurements.length, 1);

  const shown = await invokeCli(stateRoot, checkout, [
    "evidence",
    "show",
    "g1.probe",
  ]);
  assert.equal(shown.exitCode, 0, shown.stderr);
  const display = JSON.parse(shown.stdout) as {
    advisory: boolean;
    gate_id: string;
    measurements: readonly {
      authoritative: boolean;
      gate_id: string;
    }[];
    schema_version: number;
  };
  assert.equal(display.schema_version, 1);
  assert.equal(display.advisory, true);
  assert.equal(display.gate_id, "g1.probe");
  assert.equal(display.measurements.length, 1);
  assert.equal(display.measurements[0]?.authoritative, true);
  assert.equal(display.measurements[0]?.gate_id, "g1.probe");
  assert.deepEqual(await measurementNames(stateRoot), beforeMeasurements);
  assert.deepEqual(await decisionNames(stateRoot), beforeDecisions);
});
