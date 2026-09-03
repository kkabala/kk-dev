import assert from "node:assert/strict";
import test from "node:test";

import { evaluateOperations } from "../src/index.ts";

const leak = "EXPIRED_EVIDENCE_BODY_MUST_NOT_LEAK";
const scope = "src/orders/**";

function operate(overrides: Record<string, unknown> = {}) {
  return evaluateOperations({
    retention: {
      now: "2026-09-03T00:00:00.000Z",
      recorded_at: "2026-09-01T00:00:00.000Z",
      retention_days: 30,
      body: "evidence-ok",
    },
    audit: {
      authenticated: true,
      actor: {
        kind: "control_plane",
        identity: "exoframe",
      },
      action: "append",
    },
    metrics: {
      active_human_minutes: 12,
      cycle_time_minutes: 40,
      flake_rate: 4,
      escape_count: 1,
      autonomy_rate: 80,
    },
    kill_switch: {
      engaged: false,
      actor_kind: "operator",
    },
    incident: {
      trust_boundary_failure: false,
      severity_1_or_2_escape: false,
      affected_scope: scope,
    },
    ...overrides,
  });
}

test("expired evidence is not retained and audit records are append-only from authenticated writers", () => {
  const kept = operate();
  assert.equal(kept.retention_keep, true);
  assert.equal(kept.audit_accepted, true);
  assert.equal(JSON.stringify(kept).includes("evidence-ok"), false);

  const expired = operate({
    retention: {
      now: "2026-09-03T00:00:00.000Z",
      recorded_at: "2026-07-01T00:00:00.000Z",
      retention_days: 30,
      body: leak,
    },
  });
  assert.equal(expired.retention_keep, false);
  assert.equal(JSON.stringify(expired).includes(leak), false);

  const rewrite = operate({
    audit: {
      authenticated: true,
      actor: {
        kind: "control_plane",
        identity: "exoframe",
      },
      action: "rewrite",
    },
  });
  assert.equal(rewrite.audit_accepted, false);

  assert.throws(
    () =>
      operate({
        audit: {
          authenticated: false,
          actor: {
            kind: "control_plane",
            identity: "exoframe",
          },
          action: "append",
        },
      }),
    { name: "TypeError", message: "Invalid operations input" },
  );
  assert.throws(
    () =>
      operate({
        audit: {
          authenticated: true,
          actor: {
            kind: "agent",
            identity: "pstack",
          },
          action: "append",
        },
      }),
    { name: "TypeError", message: "Invalid operations input" },
  );
});

test("active human time, cycle time, flake, escape, and autonomy metrics are recorded instead of invented zeros", () => {
  const recorded = operate();
  assert.deepEqual(recorded.metrics.active_human_minutes, {
    status: "recorded",
    value: 12,
  });
  assert.deepEqual(recorded.metrics.cycle_time_minutes, {
    status: "recorded",
    value: 40,
  });
  assert.deepEqual(recorded.metrics.flake_rate, {
    status: "recorded",
    value: 4,
  });
  assert.deepEqual(recorded.metrics.escape_count, {
    status: "recorded",
    value: 1,
  });
  assert.deepEqual(recorded.metrics.autonomy_rate, {
    status: "recorded",
    value: 80,
  });

  const unknown = operate({
    metrics: {
      active_human_minutes: null,
      cycle_time_minutes: null,
      flake_rate: null,
      escape_count: null,
      autonomy_rate: null,
    },
  });
  assert.deepEqual(unknown.metrics.active_human_minutes, { status: "unknown" });
  assert.deepEqual(unknown.metrics.cycle_time_minutes, { status: "unknown" });
  assert.deepEqual(unknown.metrics.flake_rate, { status: "unknown" });
  assert.deepEqual(unknown.metrics.escape_count, { status: "unknown" });
  assert.deepEqual(unknown.metrics.autonomy_rate, { status: "unknown" });
  assert.equal(JSON.stringify(unknown.metrics).includes('"value"'), false);
});

test("an emergency kill switch, trust-boundary failure, or severity-1/2 escape disables R0/R1 auto-merge for the affected scope", () => {
  const idle = operate();
  assert.equal(idle.kill_switch_engaged, false);
  assert.equal(idle.auto_merge_disabled, false);
  assert.equal(idle.affected_scope, scope);
  assert.equal(idle.agent_direct_merge, false);
  assert.equal(idle.run_complete, false);

  const kill = operate({
    kill_switch: {
      engaged: true,
      actor_kind: "operator",
    },
  });
  assert.equal(kill.kill_switch_engaged, true);
  assert.equal(kill.auto_merge_disabled, true);
  assert.equal(kill.affected_scope, scope);
  assert.equal(kill.agent_direct_merge, false);

  const trust = operate({
    incident: {
      trust_boundary_failure: true,
      severity_1_or_2_escape: false,
      affected_scope: scope,
    },
  });
  assert.equal(trust.kill_switch_engaged, false);
  assert.equal(trust.auto_merge_disabled, true);

  const escape = operate({
    incident: {
      trust_boundary_failure: false,
      severity_1_or_2_escape: true,
      affected_scope: "src/billing/**",
    },
  });
  assert.equal(escape.auto_merge_disabled, true);
  assert.equal(escape.affected_scope, "src/billing/**");

  assert.throws(
    () =>
      operate({
        kill_switch: {
          engaged: true,
          actor_kind: "agent",
        },
      }),
    { name: "TypeError", message: "Invalid operations input" },
  );
});
