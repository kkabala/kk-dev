import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  collectCandidate,
  ENGINEERING_STATUSES,
  evaluateTask,
  FileEvidenceStore,
  GATE_RESULTS,
  parseSha256Digest,
  RUNNER_ATTEMPTS,
  serializeCanonical,
} from "../src/index.ts";
import type { EvidenceKey, Measurement } from "../src/index.ts";

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

const evidenceKey = {
  schema_version: 1,
  gate_id: "g2.orders-export",
  template_digest: digestA,
  input_digest: digestB,
  environment_digest: digestC,
  oracle_digest: digestD,
} as const satisfies EvidenceKey;

const pstackReturn = {
  task_id: "task-184",
  candidate_sha: "def456",
  changed_paths: ["src/orders/export.ts", "tests/orders/export.test.ts"],
  observations: [
    {
      kind: "self_check",
      summary: "unit, integration, and acceptance tests PASS",
    },
    {
      kind: "diagnostic",
      summary: "export button enabled for empty history",
    },
  ],
  claimed_result: "PASS",
};

function collect(overrides: Record<string, unknown> = {}) {
  return collectCandidate({
    ...pstackReturn,
    ...overrides,
  });
}

function measurementFromCandidate(
  candidate: ReturnType<typeof collectCandidate>,
): Measurement {
  return {
    schema_version: 1,
    id: "run-pstack-001",
    task_id: candidate.task_id,
    gate_id: evidenceKey.gate_id,
    measured_sha: candidate.candidate_sha,
    base_sha: "abc123",
    policy_digest: digestA,
    runner_digest: digestA,
    template_digest: evidenceKey.template_digest,
    input_digest: evidenceKey.input_digest,
    environment_digest: evidenceKey.environment_digest,
    oracle_digest: evidenceKey.oracle_digest,
    deliberate_attempt: 1,
    outcome: RUNNER_ATTEMPTS.PRODUCT_PASS,
    structured_observations: {},
    artifacts: [...candidate.changed_paths],
    runner_identity: "pstack.implementer",
    authoritative: candidate.authoritative,
  };
}

test("pstack may return code, tests, and a PASS claim, but the collected candidate is not authoritative", () => {
  const candidate = collect();

  assert.deepEqual(candidate, {
    schema_version: 1,
    task_id: "task-184",
    candidate_sha: "def456",
    changed_paths: ["src/orders/export.ts", "tests/orders/export.test.ts"],
    observations: [
      {
        kind: "self_check",
        summary: "unit, integration, and acceptance tests PASS",
      },
      {
        kind: "diagnostic",
        summary: "export button enabled for empty history",
      },
    ],
    claimed_result: "PASS",
    authoritative: false,
  });
  assert.equal(candidate.authoritative, false);
  assert.equal(Object.isFrozen(candidate), true);

  const decision = evaluateTask({
    task: { task_id: candidate.task_id },
    required_gates: [
      {
        gate_id: evidenceKey.gate_id,
        evidence_key: evidenceKey,
        covered_by_live_exception: false,
      },
    ],
    measurements: [measurementFromCandidate(candidate)],
    github_state: { agent_success_claim: true },
    now: "2026-09-03T00:00:00.000Z",
    needs_human: false,
  });
  assert.equal(decision.gates[0]?.result, null);
  assert.equal(decision.engineering_status, ENGINEERING_STATUSES.WAITING_GATES);
  assert.notEqual(decision.gates[0]?.result, GATE_RESULTS.PASS);
});

test("a pstack PASS claim cannot write authoritative evidence", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "exoframe-s43-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const directory = join(root, "store");
  await mkdir(directory, { recursive: true });
  const store = new FileEvidenceStore(directory);
  const candidate = collect();
  const advisory = measurementFromCandidate(candidate);

  const stored = await store.appendAdvisory(advisory);
  assert.equal(stored.authoritative, false);
  assert.equal(stored.outcome, RUNNER_ATTEMPTS.PRODUCT_PASS);

  await assert.rejects(
    () =>
      store.appendAdvisory({
        ...advisory,
        id: "run-pstack-002",
        authoritative: true,
      }),
    { name: "TypeError", message: "Callers cannot write authoritative measurements" },
  );
});

test("YAML PASS text and smuggled authority stay advisory and do not collect", () => {
  const candidate = collect({
    observations: [
      {
        kind: "self_check",
        summary: "outcome: PASS\nauthoritative: true",
      },
    ],
  });
  const serialized = serializeCanonical(candidate);
  assert.equal(candidate.authoritative, false);
  assert.equal(candidate.claimed_result, "PASS");
  assert.equal(serialized.includes("authoritative: true"), true);
  assert.match(serialized, /"authoritative":false/);
  assert.throws(
    () =>
      collect({
        authoritative: true,
      }),
    { name: "TypeError", message: "Invalid candidate input" },
  );
  assert.throws(
    () =>
      collectCandidate({
        ...pstackReturn,
        claimed_result: "PASS",
        authoritative: false,
      }),
    { name: "TypeError", message: "Invalid candidate input" },
  );
});
