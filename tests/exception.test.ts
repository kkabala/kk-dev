import assert from "node:assert/strict";
import test from "node:test";

import {
  ENGINEERING_STATUSES,
  evaluateTask,
  GATE_CLASSES,
  GATE_RESULTS,
  MERGE_MODES,
  parseSha256Digest,
  resolveExceptions,
  RUN_EVENTS,
  RUN_STATES,
  RUNNER_ATTEMPTS,
  transitionRunState,
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

const failedKey = {
  schema_version: 1,
  gate_id: "g3.orders-export-authorization",
  template_digest: digestA,
  input_digest: digestB,
  environment_digest: digestC,
  oracle_digest: digestD,
} as const satisfies EvidenceKey;

const compensatingKey = {
  schema_version: 1,
  gate_id: "g1.required",
  template_digest: digestA,
  input_digest: digestB,
  environment_digest: digestC,
  oracle_digest: digestD,
} as const satisfies EvidenceKey;

const now = "2026-09-02T12:00:00.000Z";
const later = "2026-09-03T12:00:00.000Z";

function overlap() {
  return {
    schema_version: 1 as const,
    id: "ex-20260902-001",
    gate_id: "g3.orders-export-authorization",
    owner: "owner@example.test",
    reason: "authorization probe cannot run in this environment",
    expires_at: later,
    compensating_evidence_key: compensatingKey,
    decision: "approved" as const,
    approved_by: "approver@example.test",
  };
}

function acceptedGap(overrides: Record<string, unknown> = {}) {
  return {
    kind: "accepted_gap",
    ...overlap(),
    ...overrides,
  };
}

function overrideException(overrides: Record<string, unknown> = {}) {
  return {
    kind: "override",
    evidence_key: failedKey,
    independent_approver: "approver@example.test",
    ...overlap(),
    reason: "false positive on a known harness mismatch",
    ...overrides,
  };
}

function gate(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    gate_id: "g3.orders-export-authorization",
    result: GATE_RESULTS.FAIL,
    gate_class: GATE_CLASSES.G3,
    trust_boundary: false,
    ...overrides,
  };
}

function failMeasurement(): Measurement {
  return {
    schema_version: 1,
    id: "run-20260831-100",
    task_id: "TASK-184",
    gate_id: failedKey.gate_id,
    measured_sha: "def456",
    base_sha: "abc123",
    policy_digest: digestA,
    runner_digest: digestA,
    template_digest: failedKey.template_digest,
    input_digest: failedKey.input_digest,
    environment_digest: failedKey.environment_digest,
    oracle_digest: failedKey.oracle_digest,
    deliberate_attempt: 1,
    outcome: RUNNER_ATTEMPTS.PRODUCT_FAIL,
    structured_observations: {},
    artifacts: [],
    runner_identity: "github-actions:exoframe-gates",
    authoritative: true,
  };
}

function evaluatedWithCoverage() {
  return evaluateTask({
    task: { task_id: "TASK-184" },
    required_gates: [
      {
        gate_id: "g3.orders-export-authorization",
        evidence_key: failedKey,
        covered_by_live_exception: true,
      },
    ],
    measurements: [failMeasurement()],
    github_state: { agent_success_claim: false },
    now,
    needs_human: false,
  });
}

function resolve(overrides: Record<string, unknown> = {}) {
  return resolveExceptions({
    exceptions: [acceptedGap()],
    now,
    gates: [gate()],
    compensating_evidence: [compensatingKey],
    ...overrides,
  });
}

test("exceptions cannot cover G0, G2, G7, G8, FLAKY evidence, or a trust-boundary failure", () => {
  const forbidden = [
    { gate_id: "g0.integrity", gate_class: GATE_CLASSES.G0 },
    { gate_id: "g2.orders-export", gate_class: GATE_CLASSES.G2 },
    { gate_id: "g7.merge-candidate", gate_class: GATE_CLASSES.G7 },
    { gate_id: "g8.delivery", gate_class: GATE_CLASSES.G8 },
  ];
  for (const target of forbidden) {
    assert.throws(
      () =>
        resolve({
          exceptions: [
            acceptedGap({
              gate_id: target.gate_id,
            }),
          ],
          gates: [
            gate({
              gate_id: target.gate_id,
              gate_class: target.gate_class,
            }),
          ],
        }),
      {
        name: "TypeError",
        message: "Exception cannot cover this gate",
      },
    );
  }

  assert.throws(
    () =>
      resolve({
        gates: [gate({ result: GATE_RESULTS.FLAKY })],
      }),
    {
      name: "TypeError",
      message: "Exception cannot cover this gate",
    },
  );
  assert.throws(
    () =>
      resolve({
        gates: [gate({ trust_boundary: true })],
      }),
    {
      name: "TypeError",
      message: "Exception cannot cover this gate",
    },
  );
});

test("an override requires an independent approver and never rewrites FAIL to PASS", () => {
  assert.throws(
    () =>
      resolve({
        exceptions: [
          overrideException({
            independent_approver: "owner@example.test",
            approved_by: "owner@example.test",
          }),
        ],
      }),
    {
      name: "TypeError",
      message: "Override requires an independent approver",
    },
  );
  assert.throws(
    () =>
      resolve({
        exceptions: [
          overrideException({
            evidence_key: compensatingKey,
          }),
        ],
      }),
    {
      name: "TypeError",
      message: "Invalid exception input",
    },
  );

  const resolved = resolve({
    exceptions: [overrideException()],
  });
  assert.equal(resolved.coverage[0]?.covered_by_live_exception, true);
  assert.equal(resolved.merge_mode, MERGE_MODES.HUMAN_MERGE);
  assert.equal(resolved.run_event, RUN_EVENTS.EXCEPTION_ACCEPTED);

  const decision = evaluatedWithCoverage();
  assert.equal(decision.gates[0]?.result, GATE_RESULTS.FAIL);
  assert.notEqual(decision.gates[0]?.result, GATE_RESULTS.PASS);
  assert.equal(
    decision.engineering_status,
    ENGINEERING_STATUSES.ENGINEERING_READY_WITH_EXCEPTION,
  );
});

test("an approved exception with compensating evidence is live and forces human merge", () => {
  const resolved = resolve();
  assert.equal(resolved.coverage[0]?.covered_by_live_exception, true);
  assert.equal(resolved.merge_mode, MERGE_MODES.HUMAN_MERGE);
  assert.equal(resolved.run_event, RUN_EVENTS.EXCEPTION_ACCEPTED);
  assert.equal(resolved.needs_human, false);
  assert.equal(
    transitionRunState(
      RUN_STATES.WAITING_FOR_EXCEPTION,
      RUN_EVENTS.EXCEPTION_ACCEPTED,
    ),
    RUN_STATES.ENGINEERING_READY_WITH_EXCEPTION,
  );

  const decision = evaluatedWithCoverage();
  assert.equal(decision.gates[0]?.result, GATE_RESULTS.FAIL);
  assert.notEqual(decision.gates[0]?.result, GATE_RESULTS.PASS);
  assert.equal(
    decision.engineering_status,
    ENGINEERING_STATUSES.ENGINEERING_READY_WITH_EXCEPTION,
  );
});

test("rejection, expiry, or missing compensating evidence returns to verification", () => {
  const expired = resolve({
    now: "2026-09-04T00:00:00.000Z",
  });
  assert.equal(expired.coverage[0]?.covered_by_live_exception, false);
  assert.equal(expired.run_event, RUN_EVENTS.EXCEPTION_NOT_ACCEPTED);
  assert.equal(expired.merge_mode, MERGE_MODES.GITHUB_AUTO_MERGE);

  const rejected = resolve({
    exceptions: [acceptedGap({ decision: "rejected", approved_by: null })],
  });
  assert.equal(rejected.coverage[0]?.covered_by_live_exception, false);
  assert.equal(rejected.run_event, RUN_EVENTS.EXCEPTION_NOT_ACCEPTED);

  const missing = resolve({
    compensating_evidence: [],
  });
  assert.equal(missing.coverage[0]?.covered_by_live_exception, false);
  assert.equal(missing.run_event, RUN_EVENTS.EXCEPTION_NOT_ACCEPTED);

  assert.equal(
    transitionRunState(
      RUN_STATES.WAITING_FOR_EXCEPTION,
      RUN_EVENTS.EXCEPTION_NOT_ACCEPTED,
    ),
    RUN_STATES.VERIFYING,
  );

  const pending = resolve({
    exceptions: [acceptedGap({ decision: "pending", approved_by: null })],
  });
  assert.equal(pending.coverage[0]?.covered_by_live_exception, false);
  assert.equal(pending.run_event, RUN_EVENTS.EXCEPTION_PROPOSED);
  assert.equal(pending.merge_mode, MERGE_MODES.HUMAN_MERGE);
  assert.equal(pending.needs_human, true);
});
