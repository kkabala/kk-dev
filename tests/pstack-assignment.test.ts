import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAssignment,
  classifyRisk,
  deriveGates,
  matchSurfaces,
  PATH_CATEGORIES,
  RISK_TIERS,
  serializeCanonical,
} from "../src/index.ts";
import type {
  GatePlan,
  Intent,
  RiskDecision,
  SurfaceDecision,
} from "../src/index.ts";

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

const secretConstraint = "API_TOKEN=sk-live-secret-value";
const requestedGoal = "Add CSV export to the orders page by calling the billing API";
const excludedNonGoal = "Rewrite the billing engine";

const intent: Intent = {
  schema_version: 1,
  intent_id: "intent-task-184",
  task_id: "task-184",
  goals: [requestedGoal],
  non_goals: [excludedNonGoal],
  constraints: [
    "Do not ask a human for discoverable repository facts.",
    secretConstraint,
  ],
  unresolved_decisions: [],
};

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

function surfacesFor(paths: readonly string[]): SurfaceDecision {
  return matchSurfaces({
    base_policy: {
      schema_version: 1,
      path_rules: pathRules,
      surfaces: [ordersExport],
    },
    diff: { paths },
    proposal: null,
  });
}

function riskFor(paths: readonly string[], surfaces: SurfaceDecision): RiskDecision {
  return classifyRisk({
    base_policy: {
      schema_version: 1,
      unknown_production_floor: RISK_TIERS.R2,
      trust_boundary_floor: RISK_TIERS.R3,
    },
    intent: {
      schema_version: 1,
      task_id: intent.task_id,
      requested_tier: null,
    },
    diff: {
      paths,
      trust_boundary: false,
    },
    surfaces,
  });
}

function planFor(paths: readonly string[]): {
  gates: GatePlan;
  risk: RiskDecision;
  surfaces: SurfaceDecision;
} {
  const surfaces = surfacesFor(paths);
  const risk = riskFor(paths, surfaces);
  return {
    surfaces,
    risk,
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

function assignmentInput(
  paths: readonly string[] = ["src/orders/export.ts"],
  overrides: Record<string, unknown> = {},
) {
  const prepared = planFor(paths);
  return {
    intent,
    risk: prepared.risk,
    surfaces: prepared.surfaces,
    contracts,
    gates: prepared.gates,
    ...overrides,
  };
}

test("intent, risk, surfaces, contracts, and gates translate into the pstack assignment contract", () => {
  const assignment = buildAssignment(assignmentInput());

  assert.deepEqual(assignment, {
    schema_version: 1,
    task_id: "task-184",
    intent_ref: "intent://task-184",
    contract_ids: ["orders-export-empty"],
    tier: RISK_TIERS.R2,
    surfaces: ["orders-export"],
    hypotheses: ["authorization-is-enforced", "empty-export-is-valid"],
    required_gate_ids: [
      "g0.integrity",
      "g1.lint",
      "g1.typecheck",
      "g1.unit",
      "g2.orders-export",
      "g3.authorization-is-enforced",
      "g3.empty-export-is-valid",
      "g4.orders-export-browser",
      "g6.governance",
      "g7.merge-candidate",
      "g8.release",
    ],
    writable_scope: [
      ".exoframe/proposals/**",
      "src/orders/**",
      "tests/orders/**",
    ],
    capabilities: {
      network: "repository-policy",
      secrets: "none",
    },
  });
  assert.equal(Reflect.ownKeys(assignment).includes("goals"), false);
  assert.equal(assignment.capabilities.secrets, "none");
});

test("secrets, goals, and implementation recipes never enter a pstack assignment", () => {
  const assignment = buildAssignment(assignmentInput());
  const serialized = serializeCanonical(assignment);

  assert.equal(serialized.includes(secretConstraint), false);
  assert.equal(serialized.includes("sk-live"), false);
  assert.equal(serialized.includes("billing API"), false);
  assert.equal(serialized.includes(requestedGoal), false);
  assert.equal(serialized.includes(excludedNonGoal), false);
  assert.equal(serialized.includes(intent.intent_id), false);
  assert.equal(serialized.includes("PASS"), false);
  assert.throws(
    () =>
      buildAssignment(
        assignmentInput(["src/orders/export.ts"], {
          intent: {
            ...intent,
            unresolved_decisions: ["Choose CSV or XLSX"],
          },
        }),
      ),
    { name: "TypeError", message: "Invalid assignment input" },
  );
});

test("identical assignment inputs serialize to the same pstack assignment", () => {
  const input = assignmentInput();
  const first = buildAssignment(input);
  const second = buildAssignment(JSON.parse(JSON.stringify(input)) as typeof input);
  const shuffled = buildAssignment(
    assignmentInput(["src/orders/export.ts"], {
      gates: {
        ...input.gates,
        gates: [...input.gates.gates].reverse(),
      },
    }),
  );

  assert.equal(serializeCanonical(first), serializeCanonical(second));
  assert.equal(serializeCanonical(first), serializeCanonical(shuffled));
  assert.equal(first.intent_ref, "intent://task-184");
  assert.deepEqual(first.capabilities, {
    network: "repository-policy",
    secrets: "none",
  });
});
