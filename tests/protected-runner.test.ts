import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  FileEvidenceStore,
  GATE_RESULTS,
  parseRunnerAttempt,
  parseSha256Digest,
  ProtectedRunner,
  resolveProtectedTemplate,
  RUNNER_ATTEMPTS,
} from "../src/index.ts";
import type {
  ParsedRunnerAttempt,
  ProtectedRunRequest,
  ResolvedProtectedCommand,
  RunnerObservation,
} from "../src/index.ts";

const digestA = parseSha256Digest(
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
);
const digestB = parseSha256Digest(
  "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
);
const digestC = parseSha256Digest(
  "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
);
const digestD = parseSha256Digest(
  "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
);

const catalog = {
  schema_version: 1,
  templates: [
    {
      schema_version: 1,
      id: "g2.orders-export",
      gate_class: "G2",
      command: {
        argv: ["npm", "test", "--", "tests/acceptance/orders-export.test.ts"],
      },
      timeout_seconds: 300,
      network: "none",
      writable_roots: ["tmp"],
      result_schema: "schemas/orders-export-result.json",
      artifact_allowlist: ["screenshots/**", "traces/**"],
    },
  ],
} as const;

const command = resolveProtectedTemplate(catalog, {
  gate_id: "g2.orders-export",
});

const secret = "super-secret-token";

function observation(
  overrides: Partial<RunnerObservation> = {},
): RunnerObservation {
  return {
    stdout: '{"outcome":"PRODUCT_PASS"}',
    stderr: "",
    exit_code: 0,
    timed_out: false,
    sandbox_error: null,
    artifacts: [],
    ...overrides,
  };
}

function policy(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    artifact_allowlist: ["screenshots/**", "traces/**"],
    writable_roots: ["tmp"],
    sandbox_root: "/sandbox",
    max_artifact_bytes: 1024,
    runner_identity: "github-actions:exoframe-gates",
    measured_sha: "def456",
    gate_id: "g2.orders-export",
    ...overrides,
  };
}

function artifact(overrides: Record<string, unknown> = {}) {
  return {
    relative_path: "screenshots/empty-export.png",
    bytes: "fake-png",
    symlink_target: null,
    runner_identity: "github-actions:exoframe-gates",
    measured_sha: "def456",
    gate_id: "g2.orders-export",
    ...overrides,
  };
}

async function sandbox(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), "exoframe-runner-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const directory = join(root, "store");
  await mkdir(directory, { recursive: true });
  return {
    directory,
    store: new FileEvidenceStore(directory),
    sandboxRoot: join(root, "sandbox"),
  };
}

function runRequest(
  store: FileEvidenceStore,
  execute: (resolved: ResolvedProtectedCommand) => Promise<RunnerObservation>,
  overrides: Partial<ProtectedRunRequest> = {},
): ProtectedRunRequest {
  return {
    task_id: "TASK-184",
    measured_sha: "def456",
    base_sha: "abc123",
    policy_digest: digestA,
    runner_digest: digestA,
    template_digest: digestA,
    input_digest: digestB,
    environment_digest: digestC,
    oracle_digest: digestD,
    sandbox_root: "/sandbox",
    evidence_store: store,
    execute,
    secrets: [secret],
    infrastructure_retries: 2,
    max_artifact_bytes: 1024,
    runner_identity: "github-actions:exoframe-gates",
    ...overrides,
  };
}

test("structured output is parsed into product attempts; sandbox failure is INFRA_ERROR; secrets are redacted before hashing", () => {
  const passed = parseRunnerAttempt(observation(), policy(), []);
  assert.equal(passed.outcome, RUNNER_ATTEMPTS.PRODUCT_PASS);
  assert.equal(passed.redacted_stdout, '{"outcome":"PRODUCT_PASS"}');
  assert.deepEqual(passed.artifacts, []);
  assert.equal(Object.isFrozen(passed), true);

  const failed = parseRunnerAttempt(
    observation({
      stdout: '{"outcome":"PRODUCT_FAIL"}',
      exit_code: 1,
    }),
    policy(),
    [],
  );
  assert.equal(failed.outcome, RUNNER_ATTEMPTS.PRODUCT_FAIL);

  const timedOut = parseRunnerAttempt(
    observation({
      stdout: "",
      exit_code: null,
      timed_out: true,
    }),
    policy(),
    [],
  );
  assert.equal(timedOut.outcome, RUNNER_ATTEMPTS.PRODUCT_TIMEOUT);

  const infra = parseRunnerAttempt(
    observation({
      stdout: '{"outcome":"PRODUCT_PASS"}',
      exit_code: null,
      sandbox_error: "container failed to start",
    }),
    policy(),
    [],
  );
  assert.equal(infra.outcome, RUNNER_ATTEMPTS.INFRA_ERROR);

  const leaked = parseRunnerAttempt(
    observation({
      stdout: `{"outcome":"PRODUCT_PASS","token":"${secret}"}`,
      stderr: `debug ${secret}`,
      artifacts: [
        artifact({
          bytes: `png ${secret}`,
        }),
      ],
    }),
    policy(),
    [secret],
  );
  assert.equal(leaked.outcome, RUNNER_ATTEMPTS.PRODUCT_PASS);
  assert.equal(leaked.redacted_stdout.includes(secret), false);
  assert.equal(leaked.redacted_stderr.includes(secret), false);
  assert.match(leaked.redacted_stdout, /\[REDACTED\]/);
  assert.equal(leaked.artifacts.length, 1);
  const bound = leaked.artifacts[0];
  assert.ok(bound);
  assert.equal(bound.path, "screenshots/empty-export.png");
  assert.notEqual(bound.digest, leaked.output_digest);

  const unredacted = parseRunnerAttempt(
    observation({
      stdout: `{"outcome":"PRODUCT_PASS","token":"${secret}"}`,
      stderr: `debug ${secret}`,
      artifacts: [
        artifact({
          bytes: `png ${secret}`,
        }),
      ],
    }),
    policy(),
    [],
  );
  assert.notEqual(leaked.output_digest, unredacted.output_digest);
  assert.equal(unredacted.redacted_stdout.includes(secret), true);

  const claimedInfra = parseRunnerAttempt(
    observation({
      stdout: '{"outcome":"INFRA_ERROR"}',
      exit_code: 0,
    }),
    policy(),
    [],
  );
  assert.equal(claimedInfra.outcome, RUNNER_ATTEMPTS.PRODUCT_FAIL);

  const claimedTimeout = parseRunnerAttempt(
    observation({
      stdout: '{"outcome":"PRODUCT_TIMEOUT"}',
      exit_code: 0,
      timed_out: false,
    }),
    policy(),
    [],
  );
  assert.equal(claimedTimeout.outcome, RUNNER_ATTEMPTS.PRODUCT_FAIL);

  const unparseable = [
    "",
    "not-json",
    "{}",
    "[]",
  ];
  for (const stdout of unparseable) {
    const parsed = parseRunnerAttempt(
      observation({
        stdout,
        exit_code: 0,
      }),
      policy(),
      [],
    );
    assert.equal(
      parsed.outcome,
      RUNNER_ATTEMPTS.PRODUCT_FAIL,
      `completed process stdout ${JSON.stringify(stdout)} must not mint INFRA_ERROR`,
    );
  }
});

test("screenshots and video without runner and commit provenance remain advisory", () => {
  const unbound = parseRunnerAttempt(
    observation({
      artifacts: [
        artifact({
          runner_identity: null,
          measured_sha: null,
          gate_id: null,
        }),
        artifact({
          relative_path: "screenshots/flow.webm",
          bytes: "fake-webm",
          runner_identity: "github-actions:exoframe-gates",
          measured_sha: null,
          gate_id: "g2.orders-export",
        }),
      ],
    }),
    policy(),
    [],
  ) as ParsedRunnerAttempt;

  assert.equal(unbound.outcome, RUNNER_ATTEMPTS.PRODUCT_PASS);
  assert.deepEqual(unbound.artifacts, []);
  assert.equal(unbound.advisory_artifacts.length, 2);
  assert.equal(unbound.advisory_artifacts[0]?.reason, "missing_provenance");
  assert.equal(unbound.advisory_artifacts[0]?.path, "screenshots/empty-export.png");
  assert.equal(unbound.advisory_artifacts[1]?.path, "screenshots/flow.webm");

  const bound = parseRunnerAttempt(
    observation({
      artifacts: [artifact()],
    }),
    policy(),
    [],
  );
  assert.equal(bound.artifacts.length, 1);
  assert.deepEqual(bound.advisory_artifacts, []);
  assert.equal(bound.artifacts[0]?.runner_identity, "github-actions:exoframe-gates");
  assert.equal(bound.artifacts[0]?.measured_sha, "def456");
  assert.equal(bound.artifacts[0]?.gate_id, "g2.orders-export");
});

test("symlink escapes, writes outside sandbox roots, and oversized artifacts fail the gate", () => {
  const escaped = parseRunnerAttempt(
    observation({
      artifacts: [
        artifact({
          relative_path: "../outside.png",
          bytes: "png",
        }),
      ],
    }),
    policy(),
    [],
  );
  assert.equal(escaped.outcome, RUNNER_ATTEMPTS.PRODUCT_FAIL);
  assert.deepEqual(escaped.artifacts, []);
  assert.deepEqual(escaped.advisory_artifacts, []);

  const symlink = parseRunnerAttempt(
    observation({
      artifacts: [
        artifact({
          symlink_target: "/etc/passwd",
        }),
      ],
    }),
    policy(),
    [],
  );
  assert.equal(symlink.outcome, RUNNER_ATTEMPTS.PRODUCT_FAIL);

  const outsideWritable = parseRunnerAttempt(
    observation({
      artifacts: [
        artifact({
          relative_path: "src/secret.ts",
          bytes: "export {}",
        }),
      ],
    }),
    policy(),
    [],
  );
  assert.equal(outsideWritable.outcome, RUNNER_ATTEMPTS.PRODUCT_FAIL);

  const oversized = parseRunnerAttempt(
    observation({
      artifacts: [
        artifact({
          bytes: "x".repeat(2048),
        }),
      ],
    }),
    policy({ max_artifact_bytes: 16 }),
    [],
  );
  assert.equal(oversized.outcome, RUNNER_ATTEMPTS.PRODUCT_FAIL);
});

test("two exhausted infrastructure retries produce BLOCKED rather than a product bounce", async (t) => {
  const { store } = await sandbox(t);
  const executions: string[][] = [];
  const runner = new ProtectedRunner();
  const result = await runner.run(
    command,
    runRequest(store, async (resolved) => {
      executions.push([...resolved.argv]);
      return observation({
        stdout: "",
        exit_code: null,
        sandbox_error: "runner image missing",
      });
    }),
  );

  assert.equal(result.status, "blocked");
  assert.equal(result.gate_result, GATE_RESULTS.BLOCKED);
  assert.equal(result.bounce, null);
  assert.equal(result.measurements.length, 3);
  assert.equal(executions.length, 3);
  assert.deepEqual(executions[0], catalog.templates[0].command.argv);
  for (const measurement of result.measurements) {
    assert.equal(measurement.outcome, RUNNER_ATTEMPTS.INFRA_ERROR);
    assert.equal(measurement.authoritative, true);
  }
  assert.equal(result.measurements[0]?.deliberate_attempt, 1);
  assert.equal(result.measurements[1]?.deliberate_attempt, 2);
  assert.equal(result.measurements[2]?.deliberate_attempt, 3);
  assert.equal(result.redacted_stdout.includes(secret), false);
});

test("raw commands cannot run; a product failure is not retried as infrastructure", async (t) => {
  const { store } = await sandbox(t);
  const runner = new ProtectedRunner();
  const forged = {
    gate_id: "g2.orders-export",
    template: catalog.templates[0],
    argv: ["curl", "https://example.invalid"],
  };

  await assert.rejects(
    () => runner.run(forged, runRequest(store, async () => observation())),
    {
      name: "TypeError",
      message: "Raw command is not allowed",
    },
  );

  let executes = 0;
  const failed = await runner.run(
    command,
    runRequest(store, async () => {
      executes += 1;
      return observation({
        stdout: '{"outcome":"PRODUCT_FAIL"}',
        exit_code: 1,
      });
    }),
  );

  assert.equal(failed.status, "measured");
  assert.equal(failed.bounce, null);
  assert.equal(failed.gate_result, null);
  assert.equal(failed.measurements.length, 1);
  assert.equal(failed.measurements[0]?.outcome, RUNNER_ATTEMPTS.PRODUCT_FAIL);
  assert.equal(failed.measurements[0]?.authoritative, true);
  assert.equal(executes, 1);

  let claimedInfraExecutes = 0;
  const claimedInfra = await runner.run(
    command,
    runRequest(store, async () => {
      claimedInfraExecutes += 1;
      return observation({
        stdout: '{"outcome":"INFRA_ERROR"}',
        exit_code: 0,
      });
    }),
  );
  assert.equal(claimedInfra.status, "measured");
  assert.equal(claimedInfra.gate_result, null);
  assert.equal(claimedInfra.bounce, null);
  assert.equal(claimedInfra.measurements.length, 1);
  assert.equal(
    claimedInfra.measurements[0]?.outcome,
    RUNNER_ATTEMPTS.PRODUCT_FAIL,
  );
  assert.equal(claimedInfraExecutes, 1);

  let unparseableExecutes = 0;
  const unparseable = await runner.run(
    command,
    runRequest(store, async () => {
      unparseableExecutes += 1;
      return observation({
        stdout: "not-json",
        exit_code: 0,
      });
    }),
  );
  assert.equal(unparseable.status, "measured");
  assert.equal(unparseable.gate_result, null);
  assert.equal(unparseable.bounce, null);
  assert.equal(unparseable.measurements.length, 1);
  assert.equal(unparseable.measurements[0]?.outcome, RUNNER_ATTEMPTS.PRODUCT_FAIL);
  assert.equal(unparseableExecutes, 1);
});
