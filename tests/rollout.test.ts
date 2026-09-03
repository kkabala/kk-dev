import assert from "node:assert/strict";
import test from "node:test";

import { evaluateRollout } from "../src/index.ts";

function roll(overrides: Record<string, unknown> = {}) {
  return evaluateRollout({
    bank: {
      required_task_ids: ["task-bank-intake", "task-bank-g8"],
      passed_task_ids: ["task-bank-intake", "task-bank-g8"],
    },
    rollout: {
      current_stage: "canary",
      requested_stage: "subset",
      current_stage_healthy: true,
    },
    rehearsal: {
      trust_boundary_failure: false,
      severity_1_or_2_escape: false,
      unreplayed_escape_count_30d: 0,
      flake_rate_30d: 5,
      production_mutated: false,
    },
    ...overrides,
  });
}

test("the evaluation bank is complete only when every representative task has passed", () => {
  const complete = roll();
  assert.equal(complete.bank_complete, true);

  const missing = roll({
    bank: {
      required_task_ids: ["task-bank-intake", "task-bank-g8"],
      passed_task_ids: ["task-bank-intake"],
    },
  });
  assert.equal(missing.bank_complete, false);
  assert.equal(missing.rollout_advanced, false);
  assert.equal(missing.rollout_stage, "canary");
});

test("staged production rollout advances one healthy stage at a time and cannot skip", () => {
  const advanced = roll();
  assert.equal(advanced.bank_complete, true);
  assert.equal(advanced.rollout_advanced, true);
  assert.equal(advanced.rollout_stage, "subset");
  assert.equal(advanced.production_mutated, false);
  assert.equal(advanced.run_complete, false);

  const skipped = roll({
    rollout: {
      current_stage: "canary",
      requested_stage: "production",
      current_stage_healthy: true,
    },
  });
  assert.equal(skipped.rollout_advanced, false);
  assert.equal(skipped.rollout_stage, "canary");

  const unhealthy = roll({
    rollout: {
      current_stage: "canary",
      requested_stage: "subset",
      current_stage_healthy: false,
    },
  });
  assert.equal(unhealthy.rollout_advanced, false);
  assert.equal(unhealthy.rollout_stage, "canary");
});

test("demotion rehearsal decreases autonomy when quality worsens without mutating production", () => {
  const healthy = roll();
  assert.equal(healthy.autonomy_decreased, false);
  assert.equal(healthy.rehearsal_only, false);

  const trust = roll({
    rehearsal: {
      trust_boundary_failure: true,
      severity_1_or_2_escape: false,
      unreplayed_escape_count_30d: 0,
      flake_rate_30d: 5,
      production_mutated: false,
    },
  });
  assert.equal(trust.autonomy_decreased, true);
  assert.equal(trust.rehearsal_only, true);
  assert.equal(trust.rollout_advanced, false);
  assert.equal(trust.production_mutated, false);

  const flake = roll({
    rehearsal: {
      trust_boundary_failure: false,
      severity_1_or_2_escape: false,
      unreplayed_escape_count_30d: 0,
      flake_rate_30d: 16,
      production_mutated: false,
    },
  });
  assert.equal(flake.autonomy_decreased, true);
  assert.equal(flake.rehearsal_only, true);

  assert.throws(
    () =>
      roll({
        rehearsal: {
          trust_boundary_failure: false,
          severity_1_or_2_escape: false,
          unreplayed_escape_count_30d: 0,
          flake_rate_30d: 5,
          production_mutated: true,
        },
      }),
    { name: "TypeError", message: "Invalid rollout input" },
  );
});
