import assert from "node:assert/strict";
import test from "node:test";

import {
  ENGINEERING_STATUSES,
  GATE_RESULTS,
  PATH_CATEGORIES,
  RISK_TIERS,
  classifyRisk,
  deriveGates,
  evaluateEndToEnd,
  matchSurfaces,
} from "../src/index.ts";
import type { Intent } from "../src/index.ts";

const requestedOutcome = "Add CSV export to the orders page";
const taskId = "task-184";
const candidateSha = "def456";
const mergedSha = "merged184";

const intent: Intent = {
  schema_version: 1,
  intent_id: "intent-task-184",
  task_id: taskId,
  goals: [requestedOutcome],
  non_goals: ["Rewrite the billing engine"],
  constraints: ["Do not ask a human for discoverable repository facts."],
  unresolved_decisions: [],
};

const ordersExport = {
  schema_version: 1 as const,
  id: "orders-export",
  paths: ["src/orders/**", "tests/orders/**"],
  consumption: "browser",
  risk_floor: RISK_TIERS.R2,
  exercises: ["g4.orders-export-browser"],
  hypotheses: ["authorization-is-enforced", "empty-export-is-valid"],
  publishes_artifact: false,
};

const pathRules = [
  {
    category: PATH_CATEGORIES.CONTROL_PLANE,
    patterns: [".exoframe/**", ".github/workflows/**"],
  },
  {
    category: PATH_CATEGORIES.VERIFICATION,
    patterns: ["tests/**"],
  },
  {
    category: PATH_CATEGORIES.UNTRACKED_OK,
    patterns: ["*.md", "docs/**"],
  },
  {
    category: PATH_CATEGORIES.PRODUCTION,
    patterns: ["src/**"],
  },
];

const contracts = {
  schema_version: 1 as const,
  user_visible: true,
  pacs: [
    {
      id: "orders-export-empty",
      surface_id: "orders-export",
      template_id: "g2.orders-export",
    },
  ],
};

function assignmentInput() {
  const paths = ["src/orders/export.ts"];
  const surfaces = matchSurfaces({
    base_policy: {
      schema_version: 1,
      path_rules: pathRules,
      surfaces: [ordersExport],
    },
    diff: { paths },
    proposal: null,
  });
  const risk = classifyRisk({
    base_policy: {
      schema_version: 1,
      unknown_production_floor: RISK_TIERS.R2,
      trust_boundary_floor: RISK_TIERS.R3,
    },
    intent: {
      schema_version: 1,
      task_id: taskId,
      requested_tier: null,
    },
    diff: {
      paths,
      trust_boundary: false,
    },
    surfaces,
  });
  return {
    intent,
    risk,
    surfaces,
    contracts,
    gates: deriveGates({
      base_policy: {
        schema_version: 1,
        integrity_gate_id: "g0.integrity",
        required_g1: ["g1.lint", "g1.typecheck", "g1.unit"],
        governance_gate_id: "g6.governance",
        merge_candidate_gate_id: "g7.merge-candidate",
      },
      risk,
      surfaces,
      contracts,
      delivery: {
        schema_version: 1,
        delivery_gate_id: "g8.release",
        learning_gate_id: null,
      },
    }),
  };
}

function healthyDelivery() {
  return {
    authenticated: true,
    actor: {
      kind: "release_observer",
      identity: "github-actions:deploy",
    },
    expected_sha: mergedSha,
    expected_environment: "prod",
    expected_route: "orders.example.com",
    target: {
      environment: "prod",
      route: "orders.example.com",
      deployed_sha: mergedSha,
      healthy: true,
    },
  };
}

function pathInput(overrides: Record<string, unknown> = {}) {
  return {
    intake: {
      task_id: taskId,
      requested_outcome: requestedOutcome,
      now: "2026-09-03T08:00:00.000Z",
      facts: {
        schema_version: 1,
        checkout_root: "/tmp/checkout",
        base_ref: "main",
        instruction_paths: ["README.md"],
        test_command: "npm test",
        build_command: "npm run build",
      },
    },
    assignment: assignmentInput(),
    candidate: {
      task_id: taskId,
      candidate_sha: candidateSha,
      changed_paths: ["src/orders/export.ts", "tests/orders/export.test.ts"],
      observations: [
        {
          kind: "self_check",
          summary: "unit, integration, and acceptance tests PASS",
        },
      ],
      claimed_result: "PASS",
    },
    pull_request: {
      task_id: taskId,
      candidate_sha: candidateSha,
      base_sha: "abc123",
      assigned_number: 184,
      existing_pull_request: null,
      engineering_status: ENGINEERING_STATUSES.ENGINEERING_READY,
      merge_ready: true,
    },
    auto_merge: {
      risk_tier: RISK_TIERS.R2,
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
    },
    g7: {
      queue_present: true,
      queue_candidate_sha: "queue184",
      base_sha: null,
      head_sha: null,
      merge_method: null,
      candidate_tree_digest: null,
      bound: {
        kind: "queue",
        candidate_sha: "queue184",
      },
      g7_result: GATE_RESULTS.PASS,
      landed_tree_digest: null,
    },
    delivery: healthyDelivery(),
    ...overrides,
  };
}

test("a clear task proceeds through pstack, a draft PR, merge, and healthy G8", () => {
  const result = evaluateEndToEnd(pathInput());
  assert.equal(result.intake_normalized, true);
  assert.equal(result.assignment_secrets, "none");
  assert.equal(result.candidate_authoritative, false);
  assert.equal(result.pull_request_number, 184);
  assert.equal(result.agent_direct_merge, false);
  assert.equal(result.g8_result, GATE_RESULTS.PASS);
  assert.equal(result.path_complete, true);
  assert.equal(result.run_complete, true);
});

test("a pull request and green engineering check do not complete the run before G8", () => {
  const result = evaluateEndToEnd(
    pathInput({
      delivery: {
        authenticated: true,
        actor: {
          kind: "release_observer",
          identity: "github-actions:deploy",
        },
        expected_sha: mergedSha,
        expected_environment: "prod",
        expected_route: "orders.example.com",
        target: {
          environment: "prod",
          route: "orders.example.com",
          deployed_sha: "other999",
          healthy: true,
        },
      },
    }),
  );
  assert.equal(result.pull_request_number, 184);
  assert.equal(result.g8_result, GATE_RESULTS.FAIL);
  assert.equal(result.path_complete, false);
  assert.equal(result.run_complete, false);
});

test("pstack PASS is not authoritative and an agent cannot merge", () => {
  const result = evaluateEndToEnd(pathInput());
  assert.equal(result.candidate_authoritative, false);
  assert.equal(result.agent_direct_merge, false);

  const blocked = evaluateEndToEnd(
    pathInput({
      intake: {
        task_id: taskId,
        requested_outcome: "Ship CSV or keep the current PDF export",
        now: "2026-09-03T08:00:00.000Z",
        facts: {
          schema_version: 1,
          checkout_root: "/tmp/checkout",
          base_ref: "main",
          instruction_paths: ["README.md"],
          test_command: "npm test",
          build_command: "npm run build",
        },
      },
    }),
  );
  assert.equal(blocked.intake_normalized, false);
  assert.equal(blocked.path_complete, false);
  assert.equal(blocked.run_complete, false);
});
