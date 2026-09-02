import assert from "node:assert/strict";
import test from "node:test";

import {
  ENGINEERING_STATUSES,
  evaluateTask,
  GATE_RESULTS,
  parseSha256Digest,
  RUNNER_ATTEMPTS,
} from "../src/index.ts";
import type {
  EvidenceKey,
  Measurement,
  UncertainEvidenceKey,
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

const evidenceKey = {
  schema_version: 1,
  gate_id: "g2.orders-export",
  template_digest: digestA,
  input_digest: digestB,
  environment_digest: digestC,
  oracle_digest: digestD,
} as const satisfies EvidenceKey;

function measurement(
  id: string,
  overrides: Partial<Measurement> = {},
): Measurement {
  return {
    schema_version: 1,
    id,
    task_id: "TASK-184",
    gate_id: evidenceKey.gate_id,
    measured_sha: "def456",
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
    artifacts: [],
    runner_identity: "github-actions:exoframe-gates",
    authoritative: true,
    ...overrides,
  };
}

function evaluate(overrides: Record<string, unknown> = {}) {
  return evaluateTask({
    task: { task_id: "TASK-184" },
    required_gates: [
      {
        gate_id: "g2.orders-export",
        evidence_key: evidenceKey,
        covered_by_live_exception: false,
      },
    ],
    measurements: [],
    github_state: { agent_success_claim: false },
    now: "2026-09-02T00:00:00.000Z",
    needs_human: false,
    ...overrides,
  });
}

test("the same authoritative measurements produce the same engineering status", () => {
  const first = evaluate({
    measurements: [measurement("run-20260831-001")],
  });
  const second = evaluate({
    measurements: [measurement("run-20260831-001")],
  });

  assert.equal(first.engineering_status, ENGINEERING_STATUSES.ENGINEERING_READY);
  assert.deepEqual(first, second);
  assert.equal(first.gates[0]?.result, GATE_RESULTS.PASS);
  assert.equal(first.bounce, null);
  assert.equal(Object.isFrozen(first), true);
});

test("advisory PASS and agent prose cannot satisfy a required gate or override FAIL", () => {
  const advisoryOnly = evaluate({
    measurements: [
      measurement("run-20260831-002", {
        authoritative: false,
        outcome: RUNNER_ATTEMPTS.PRODUCT_PASS,
      }),
    ],
    github_state: { agent_success_claim: true },
  });
  assert.equal(advisoryOnly.gates[0]?.result, null);
  assert.equal(advisoryOnly.engineering_status, ENGINEERING_STATUSES.WAITING_GATES);

  const mechanicalFail = evaluate({
    measurements: [
      measurement("run-20260831-003", {
        outcome: RUNNER_ATTEMPTS.PRODUCT_FAIL,
      }),
    ],
    github_state: { agent_success_claim: true },
  });
  assert.equal(mechanicalFail.gates[0]?.result, GATE_RESULTS.FAIL);
  assert.equal(mechanicalFail.engineering_status, ENGINEERING_STATUSES.FAIL);
});

test("uncertain selection and mismatched keys cannot satisfy a gate", () => {
  const uncertain: UncertainEvidenceKey = {
    kind: "uncertain",
    reason: "uncertain_dependency_selection",
  };
  const stale = evaluate({
    required_gates: [
      {
        gate_id: "g2.orders-export",
        evidence_key: uncertain,
        covered_by_live_exception: false,
      },
    ],
    measurements: [measurement("run-20260831-004")],
  });
  assert.equal(stale.gates[0]?.result, GATE_RESULTS.STALE);
  assert.equal(stale.engineering_status, ENGINEERING_STATUSES.WAITING_GATES);

  const mismatched = evaluate({
    measurements: [
      measurement("run-20260831-005", {
        template_digest: digestC,
      }),
    ],
  });
  assert.equal(mismatched.gates[0]?.result, null);
  assert.equal(mismatched.engineering_status, ENGINEERING_STATUSES.WAITING_GATES);
});

test("mixed product outcomes are FLAKY and later green cannot clear them", () => {
  const mixed = evaluate({
    measurements: [
      measurement("run-20260831-010", {
        deliberate_attempt: 1,
        outcome: RUNNER_ATTEMPTS.PRODUCT_PASS,
      }),
      measurement("run-20260831-011", {
        deliberate_attempt: 2,
        outcome: RUNNER_ATTEMPTS.PRODUCT_FAIL,
      }),
      measurement("run-20260831-012", {
        deliberate_attempt: 3,
        outcome: RUNNER_ATTEMPTS.PRODUCT_PASS,
      }),
    ],
  });
  assert.equal(mixed.gates[0]?.result, GATE_RESULTS.FLAKY);
  assert.equal(mixed.engineering_status, ENGINEERING_STATUSES.FAIL);
});

test("exhausted infrastructure errors produce BLOCKED rather than a product bounce", () => {
  const blocked = evaluate({
    measurements: [
      measurement("run-20260831-020", {
        deliberate_attempt: 1,
        outcome: RUNNER_ATTEMPTS.INFRA_ERROR,
      }),
      measurement("run-20260831-021", {
        deliberate_attempt: 2,
        outcome: RUNNER_ATTEMPTS.INFRA_ERROR,
      }),
      measurement("run-20260831-022", {
        deliberate_attempt: 3,
        outcome: RUNNER_ATTEMPTS.INFRA_ERROR,
      }),
    ],
  });
  assert.equal(blocked.gates[0]?.result, GATE_RESULTS.BLOCKED);
  assert.equal(blocked.engineering_status, ENGINEERING_STATUSES.BLOCKED);
  assert.equal(blocked.bounce, null);

  const stillRetrying = evaluate({
    measurements: [
      measurement("run-20260831-023", {
        outcome: RUNNER_ATTEMPTS.INFRA_ERROR,
      }),
    ],
  });
  assert.equal(stillRetrying.gates[0]?.result, null);
  assert.equal(
    stillRetrying.engineering_status,
    ENGINEERING_STATUSES.WAITING_GATES,
  );
});

test("PRODUCT_TIMEOUT is a finished failure and displaces an earlier PASS", () => {
  const timedOut = evaluate({
    measurements: [
      measurement("run-20260831-030", {
        outcome: RUNNER_ATTEMPTS.PRODUCT_TIMEOUT,
      }),
    ],
  });
  assert.equal(timedOut.gates[0]?.result, GATE_RESULTS.FAIL);
  assert.equal(timedOut.engineering_status, ENGINEERING_STATUSES.FAIL);

  const timeoutAfterPass = evaluate({
    measurements: [
      measurement("run-20260831-031", {
        deliberate_attempt: 1,
        outcome: RUNNER_ATTEMPTS.PRODUCT_PASS,
      }),
      measurement("run-20260831-032", {
        deliberate_attempt: 2,
        outcome: RUNNER_ATTEMPTS.PRODUCT_TIMEOUT,
      }),
    ],
  });
  assert.equal(timeoutAfterPass.gates[0]?.result, GATE_RESULTS.FAIL);
  assert.equal(timeoutAfterPass.engineering_status, ENGINEERING_STATUSES.FAIL);
});

test("a live exception covers progression without rewriting FAIL to PASS", () => {
  const covered = evaluate({
    required_gates: [
      {
        gate_id: "g2.orders-export",
        evidence_key: evidenceKey,
        covered_by_live_exception: true,
      },
    ],
    measurements: [
      measurement("run-20260831-040", {
        outcome: RUNNER_ATTEMPTS.PRODUCT_FAIL,
      }),
    ],
  });
  assert.equal(covered.gates[0]?.result, GATE_RESULTS.FAIL);
  assert.equal(
    covered.engineering_status,
    ENGINEERING_STATUSES.ENGINEERING_READY_WITH_EXCEPTION,
  );
});

test("a required gate id must match its evidence key", () => {
  assert.throws(
    () =>
      evaluate({
        required_gates: [
          {
            gate_id: "g0.integrity",
            evidence_key: evidenceKey,
            covered_by_live_exception: false,
          },
        ],
        measurements: [measurement("run-20260831-041")],
      }),
    {
      name: "TypeError",
      message: "Invalid evaluator input",
    },
  );
});
