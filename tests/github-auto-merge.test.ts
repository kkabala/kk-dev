import assert from "node:assert/strict";
import test from "node:test";

import {
  MERGE_MODES,
  RISK_TIERS,
  evaluateAutoMerge,
} from "../src/index.ts";

function evaluate(overrides: Record<string, unknown> = {}) {
  return evaluateAutoMerge({
    risk_tier: RISK_TIERS.R0,
    has_live_exception: false,
    history: {
      eligible_merge_count: 20,
      window_days: 14,
      severity_1_or_2_escape: false,
      replayed_lower_escape_count: 0,
      p90_human_time_minutes: 2,
      flake_rate: 5,
    },
    demotion: {
      trust_boundary_failure: false,
      severity_1_or_2_escape: false,
      unreplayed_escape_count_30d: 0,
      flake_rate_30d: 5,
    },
    ...overrides,
  });
}

test("eligible promoted R0/R1 work uses GitHub auto-merge, never an agent operation", () => {
  const r0 = evaluate();
  assert.equal(r0.mode, MERGE_MODES.GITHUB_AUTO_MERGE);
  assert.equal(r0.action, "enable_github_auto_merge");
  assert.equal(r0.agent_direct_merge, false);
  assert.equal(r0.run_complete, false);

  const r1 = evaluate({
    risk_tier: RISK_TIERS.R1,
    history: {
      eligible_merge_count: 30,
      window_days: 21,
      severity_1_or_2_escape: false,
      replayed_lower_escape_count: 1,
      p90_human_time_minutes: 5,
      flake_rate: 5,
    },
  });
  assert.equal(r1.mode, MERGE_MODES.GITHUB_AUTO_MERGE);
  assert.equal(r1.action, "enable_github_auto_merge");
  assert.equal(r1.agent_direct_merge, false);
});

test("R2/R3 and exception-bearing tasks cannot enter automatic merge", () => {
  const r2 = evaluate({ risk_tier: RISK_TIERS.R2 });
  assert.equal(r2.mode, MERGE_MODES.HUMAN_MERGE);
  assert.equal(r2.action, "require_human_merge");
  assert.equal(r2.agent_direct_merge, false);

  const r3 = evaluate({ risk_tier: RISK_TIERS.R3 });
  assert.equal(r3.mode, MERGE_MODES.HUMAN_MERGE);

  const exception = evaluate({ has_live_exception: true });
  assert.equal(exception.mode, MERGE_MODES.HUMAN_MERGE);
  assert.equal(exception.agent_direct_merge, false);
  assert.equal(exception.run_complete, false);
});

test("a trust-boundary failure or severity-1/2 escape disables R0/R1 auto-merge", () => {
  const trust = evaluate({
    demotion: {
      trust_boundary_failure: true,
      severity_1_or_2_escape: false,
      unreplayed_escape_count_30d: 0,
      flake_rate_30d: 5,
    },
  });
  assert.equal(trust.mode, MERGE_MODES.HUMAN_MERGE);
  assert.equal(trust.action, "require_human_merge");
  assert.equal(trust.agent_direct_merge, false);

  const escape = evaluate({
    demotion: {
      trust_boundary_failure: false,
      severity_1_or_2_escape: true,
      unreplayed_escape_count_30d: 0,
      flake_rate_30d: 5,
    },
  });
  assert.equal(escape.mode, MERGE_MODES.HUMAN_MERGE);

  const unreplayed = evaluate({
    demotion: {
      trust_boundary_failure: false,
      severity_1_or_2_escape: false,
      unreplayed_escape_count_30d: 2,
      flake_rate_30d: 5,
    },
  });
  assert.equal(unreplayed.mode, MERGE_MODES.HUMAN_MERGE);

  const flake = evaluate({
    demotion: {
      trust_boundary_failure: false,
      severity_1_or_2_escape: false,
      unreplayed_escape_count_30d: 0,
      flake_rate_30d: 16,
    },
  });
  assert.equal(flake.mode, MERGE_MODES.HUMAN_MERGE);
  assert.equal(flake.run_complete, false);
});
