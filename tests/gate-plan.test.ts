import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyRisk,
  deriveGates,
  GATE_CLASSES,
  matchSurfaces,
  PATH_CATEGORIES,
  RISK_TIERS,
  serializeCanonical,
} from "../src/index.ts";
import type { GatePlan, RiskDecision, SurfaceDecision } from "../src/index.ts";

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

const localValidate = {
  schema_version: 1 as const,
  id: "local-validate",
  paths: ["src/local/**"],
  consumption: "cli",
  risk_floor: RISK_TIERS.R1,
  exercises: ["g1.local-validate"],
  hypotheses: ["validation-is-local"],
  publishes_artifact: false,
};

const preview = {
  schema_version: 1 as const,
  id: "orders-preview",
  paths: ["src/preview/**"],
  consumption: "browser",
  risk_floor: RISK_TIERS.R2,
  exercises: ["g4.orders-preview-browser"],
  hypotheses: ["preview-is-isolated"],
  publishes_artifact: true,
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

const surfacePolicy = {
  schema_version: 1 as const,
  path_rules: pathRules,
  surfaces: [ordersExport, localValidate, preview],
};

const gatePolicy = {
  schema_version: 1 as const,
  integrity_gate_id: "g0.integrity",
  required_g1: ["g1.lint", "g1.typecheck", "g1.unit"],
  governance_gate_id: "g6.governance",
  merge_candidate_gate_id: "g7.merge-candidate",
};

function surfacesFor(paths: readonly string[], proposal: unknown = null): SurfaceDecision {
  return matchSurfaces({
    base_policy: surfacePolicy,
    diff: { paths },
    proposal,
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
      task_id: "task-184",
      requested_tier: null,
    },
    diff: {
      paths,
      trust_boundary: false,
    },
    surfaces,
  });
}

function derive(
  paths: readonly string[],
  overrides: Record<string, unknown> = {},
): GatePlan {
  const surfaces = surfacesFor(paths);
  return deriveGates({
    base_policy: gatePolicy,
    risk: riskFor(paths, surfaces),
    surfaces,
    contracts: {
      schema_version: 1,
      user_visible: false,
      pacs: [],
    },
    delivery: {
      schema_version: 1,
      delivery_gate_id: null,
      learning_gate_id: null,
    },
    ...overrides,
  });
}

function gateIds(plan: GatePlan): readonly string[] {
  return plan.gates.map((gate) => gate.gate_id);
}

test("gate derivation is identical for identical policy, surfaces, contracts, and delivery", () => {
  const paths = ["src/orders/export.ts"];
  const surfaces = surfacesFor(paths);
  const input = {
    base_policy: gatePolicy,
    risk: riskFor(paths, surfaces),
    surfaces,
    contracts: {
      schema_version: 1 as const,
      user_visible: true,
      pacs: [
        {
          id: "orders-export-empty",
          surface_id: "orders-export",
          template_id: "g2.orders-export",
        },
      ],
    },
    delivery: {
      schema_version: 1 as const,
      delivery_gate_id: "g8.release",
      learning_gate_id: null,
    },
  };
  const first = deriveGates(input);
  const second = deriveGates(JSON.parse(JSON.stringify(input)) as typeof input);
  assert.equal(serializeCanonical(first), serializeCanonical(second));
  assert.deepEqual(gateIds(first), [
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
  ]);
  assert.equal(first.independent_verifier, true);
  assert.equal(first.gates[0]?.gate_class, GATE_CLASSES.G0);
});

test("an R2/R3 hypothesis cannot disappear because an implementation agent edits a proposal", () => {
  const paths = ["src/orders/export.ts"];
  const surfaces = surfacesFor(paths, {
    schema_version: 1,
    surfaces: [
      {
        ...ordersExport,
        hypotheses: ["empty-export-is-valid"],
        risk_floor: RISK_TIERS.R1,
      },
    ],
  });
  assert.equal(surfaces.policy_weakening, true);
  const plan = deriveGates({
    base_policy: gatePolicy,
    risk: riskFor(paths, surfaces),
    surfaces,
    contracts: {
      schema_version: 1,
      user_visible: true,
      pacs: [
        {
          id: "orders-export-empty",
          surface_id: "orders-export",
          template_id: "g2.orders-export",
        },
      ],
    },
    delivery: {
      schema_version: 1,
      delivery_gate_id: null,
      learning_gate_id: null,
    },
  });
  assert.equal(plan.independent_verifier, true);
  assert.equal(gateIds(plan).includes("g3.authorization-is-enforced"), true);
  assert.equal(gateIds(plan).includes("g3.empty-export-is-valid"), true);
});

test("G0 and required G1 always apply; G2–G9 follow surfaces, contracts, and delivery", () => {
  const docs = derive(["README.md"]);
  assert.deepEqual(gateIds(docs), [
    "g0.integrity",
    "g1.lint",
    "g1.typecheck",
    "g1.unit",
    "g6.governance",
    "g7.merge-candidate",
  ]);
  assert.equal(docs.independent_verifier, false);

  const local = derive(["src/local/check.ts"]);
  assert.equal(gateIds(local).includes("g2.orders-export"), false);
  assert.equal(gateIds(local).includes("g3.validation-is-local"), false);
  assert.equal(local.independent_verifier, false);

  const published = derive(["src/preview/panel.ts"], {
    contracts: {
      schema_version: 1,
      user_visible: true,
      pacs: [
        {
          id: "orders-preview-empty",
          surface_id: "orders-preview",
          template_id: "g2.orders-preview",
        },
      ],
    },
    delivery: {
      schema_version: 1,
      delivery_gate_id: null,
      learning_gate_id: "g9.escaped-defect",
    },
  });
  assert.equal(gateIds(published).includes("g5.orders-preview"), true);
  assert.equal(gateIds(published).includes("g4.orders-preview-browser"), true);
  assert.equal(gateIds(published).includes("g9.escaped-defect"), true);
  assert.equal(published.independent_verifier, true);

  assert.throws(
    () =>
      derive(["src/orders/export.ts"], {
        contracts: {
          schema_version: 1,
          user_visible: true,
          pacs: [],
        },
      }),
    { name: "TypeError", message: "Invalid gate-plan input" },
  );
});
