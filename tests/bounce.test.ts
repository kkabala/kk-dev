import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBounce,
  GATE_CLASSES,
  GATE_RESULTS,
  isReviewRequestPacket,
} from "../src/index.ts";

const requiredGates = [
  { gate_class: GATE_CLASSES.G0, gate_id: "g0.integrity" },
  { gate_class: GATE_CLASSES.G1, gate_id: "g1.lint" },
  { gate_class: GATE_CLASSES.G1, gate_id: "g1.typecheck" },
  { gate_class: GATE_CLASSES.G1, gate_id: "g1.unit" },
  { gate_class: GATE_CLASSES.G2, gate_id: "g2.orders-export" },
  { gate_class: GATE_CLASSES.G3, gate_id: "g3.empty-export-is-valid" },
  { gate_class: GATE_CLASSES.G4, gate_id: "g4.orders-export-browser" },
  { gate_class: GATE_CLASSES.G6, gate_id: "g6.governance" },
  { gate_class: GATE_CLASSES.G7, gate_id: "g7.merge-candidate" },
  { gate_class: GATE_CLASSES.G8, gate_id: "g8.release" },
];

const failure = {
  failed_gate: "g4.orders-export-browser",
  result: GATE_RESULTS.FAIL,
  summary: "Export button remains disabled for an empty order history.",
};

function bounceInput(overrides: Record<string, unknown> = {}) {
  return {
    task_id: "task-184",
    candidate_sha: "def456",
    failed_gate: failure.failed_gate,
    result: failure.result,
    summary: failure.summary,
    evidence_refs: ["evidence://task-184/run-22"],
    hypotheses: ["empty-export-is-valid"],
    allowed_paths: ["src/orders/**", "tests/orders/**", ".exoframe/proposals/**"],
    required_gates: requiredGates,
    fingerprint_history: [],
    repeated_fingerprint_limit: 3,
    source: "gate_failure",
    now: "2026-09-03T00:00:00.000Z",
    ...overrides,
  };
}

test("a failed gate creates a minimal bounce that reruns only affected gates", () => {
  const decision = buildBounce(bounceInput());
  assert.equal(decision.kind, "bounce");
  assert.equal(decision.packet, null);
  assert.deepEqual(decision.bounce, {
    task_id: "task-184",
    candidate_sha: "def456",
    failed_gate: "g4.orders-export-browser",
    result: GATE_RESULTS.FAIL,
    summary: failure.summary,
    evidence_refs: ["evidence://task-184/run-22"],
    hypotheses: ["empty-export-is-valid"],
    allowed_paths: [
      ".exoframe/proposals/**",
      "src/orders/**",
      "tests/orders/**",
    ],
    rerun_gate_ids: [
      "g1.lint",
      "g1.typecheck",
      "g1.unit",
      "g2.orders-export",
      "g4.orders-export-browser",
    ],
  });
  assert.equal(decision.bounce?.rerun_gate_ids.includes("g0.integrity"), false);
  assert.equal(decision.bounce?.rerun_gate_ids.includes("g6.governance"), false);
  assert.equal(decision.bounce?.rerun_gate_ids.includes("g8.release"), false);

  const passing = buildBounce(
    bounceInput({
      result: GATE_RESULTS.PASS,
    }),
  );
  assert.equal(passing.kind, "none");
  assert.equal(passing.bounce, null);

  const blocked = buildBounce(
    bounceInput({
      result: GATE_RESULTS.BLOCKED,
    }),
  );
  assert.equal(blocked.kind, "none");
});

test("three repeated equivalent failures create one human packet instead of another bounce", () => {
  const prior = [failure, failure];
  const second = buildBounce(
    bounceInput({
      fingerprint_history: prior,
    }),
  );
  assert.equal(second.kind, "bounce");

  const third = buildBounce(
    bounceInput({
      fingerprint_history: [...prior, failure],
    }),
  );
  assert.equal(third.kind, "packet");
  assert.equal(third.bounce, null);
  assert.equal(third.packet !== null, true);
  if (third.packet === null) {
    throw new Error("expected a packet");
  }
  assert.equal(isReviewRequestPacket(third.packet), true);
  assert.equal(third.packet.subject.kind, "candidate");
  assert.equal(third.packet.subject.candidate_sha, "def456");
  assert.equal(third.packet.task_id, "task-184");
  assert.deepEqual(third.packet.evidence_refs, ["evidence://task-184/run-22"]);
  assert.equal(
    third.packet.why_automation_cannot_decide.includes("repeated"),
    true,
  );

  const different = buildBounce(
    bounceInput({
      fingerprint_history: [...prior, failure],
      summary: "Authorization header is missing on the export request.",
    }),
  );
  assert.equal(different.kind, "bounce");
});

test("review-requested changes return to pstack and replay affected protected gates", () => {
  const decision = buildBounce(
    bounceInput({
      source: "review_request",
      summary: "Reviewer asked to keep export disabled for empty history.",
      fingerprint_history: [failure, failure, failure],
    }),
  );
  assert.equal(decision.kind, "bounce");
  assert.equal(decision.packet, null);
  assert.equal(decision.bounce?.failed_gate, "g4.orders-export-browser");
  assert.deepEqual(decision.bounce?.rerun_gate_ids, [
    "g1.lint",
    "g1.typecheck",
    "g1.unit",
    "g2.orders-export",
    "g4.orders-export-browser",
  ]);
});
