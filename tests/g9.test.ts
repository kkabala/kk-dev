import assert from "node:assert/strict";
import test from "node:test";

import {
  GATE_RESULTS,
  RISK_TIERS,
  RUN_STATES,
  evaluateG9,
} from "../src/index.ts";

function evaluate(overrides: Record<string, unknown> = {}) {
  return evaluateG9({
    original_task_id: "task-184",
    original_run_state: RUN_STATES.DONE,
    linked_learning_task_id: "task-184-learn",
    defective_snapshot_sha: "defective184",
    durable_fix: true,
    defective_snapshot_result: GATE_RESULTS.FAIL,
    repaired_snapshot_result: GATE_RESULTS.PASS,
    missed_gate_id: "g3.empty-export-is-valid",
    risk_tier: RISK_TIERS.R2,
    ...overrides,
  });
}

test("an escaped defect after DONE creates a new linked learning run", () => {
  const decision = evaluate();
  assert.equal(decision.linked_learning_task_id, "task-184-learn");
  assert.notEqual(decision.linked_learning_task_id, decision.original_task_id);
  assert.equal(decision.original_run_state, RUN_STATES.DONE);
  assert.equal(decision.g9_result, GATE_RESULTS.PASS);
  assert.equal(decision.run_complete, false);
});

test("G9 cannot pass unless the defective snapshot fails under the new protection", () => {
  const decision = evaluate({
    defective_snapshot_result: GATE_RESULTS.PASS,
  });
  assert.equal(decision.g9_result, GATE_RESULTS.FAIL);
  assert.equal(decision.run_complete, false);
});

test("G9 needs a durable fix, repaired PASS, and recorded missed gate and risk", () => {
  const missingFix = evaluate({ durable_fix: false });
  assert.equal(missingFix.g9_result, GATE_RESULTS.FAIL);

  const repairedFail = evaluate({
    repaired_snapshot_result: GATE_RESULTS.FAIL,
  });
  assert.equal(repairedFail.g9_result, GATE_RESULTS.FAIL);

  const pass = evaluate();
  assert.equal(pass.g9_result, GATE_RESULTS.PASS);
  assert.equal(pass.missed_gate_id, "g3.empty-export-is-valid");
  assert.equal(pass.risk_tier, RISK_TIERS.R2);
  assert.equal(pass.run_complete, false);
});
