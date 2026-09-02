import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyRisk,
  matchSurfaces,
  PATH_CATEGORIES,
  RISK_TIERS,
} from "../src/index.ts";
import type { RiskTier, SurfaceDecision } from "../src/index.ts";

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

function surfacesFor(paths: readonly string[]): SurfaceDecision {
  return matchSurfaces({
    base_policy: {
      schema_version: 1,
      path_rules: pathRules,
      surfaces: [ordersExport, localValidate],
    },
    diff: { paths },
    proposal: null,
  });
}

function classify(
  paths: readonly string[],
  overrides: Record<string, unknown> = {},
) {
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
    surfaces: surfacesFor(paths),
    ...overrides,
  });
}

test("risk classification follows the fail-up decision table", () => {
  const cases: readonly {
    name: string;
    paths: readonly string[];
    trust_boundary?: boolean;
    requested_tier?: RiskTier | null;
    expected_overall: RiskTier;
    expected_by_path: Readonly<Record<string, RiskTier>>;
  }[] = [
    {
      name: "declared untracked_ok documentation remains R0",
      paths: ["README.md"],
      expected_overall: RISK_TIERS.R0,
      expected_by_path: { "README.md": RISK_TIERS.R0 },
    },
    {
      name: "ordinary local production remains R1",
      paths: ["src/local/check.ts"],
      expected_overall: RISK_TIERS.R1,
      expected_by_path: { "src/local/check.ts": RISK_TIERS.R1 },
    },
    {
      name: "declared public-contract production is R2",
      paths: ["src/orders/export.ts"],
      expected_overall: RISK_TIERS.R2,
      expected_by_path: { "src/orders/export.ts": RISK_TIERS.R2 },
    },
    {
      name: "verification inherits the affected surface floor",
      paths: ["tests/orders/export.test.ts"],
      expected_overall: RISK_TIERS.R2,
      expected_by_path: { "tests/orders/export.test.ts": RISK_TIERS.R2 },
    },
    {
      name: "unknown production is provisional R2",
      paths: ["mystery.bin"],
      expected_overall: RISK_TIERS.R2,
      expected_by_path: { "mystery.bin": RISK_TIERS.R2 },
    },
    {
      name: "control-plane changes are R3",
      paths: [".exoframe/templates.json"],
      expected_overall: RISK_TIERS.R3,
      expected_by_path: { ".exoframe/templates.json": RISK_TIERS.R3 },
    },
    {
      name: "trust-boundary raises every path to R3",
      paths: ["README.md", "src/local/check.ts"],
      trust_boundary: true,
      expected_overall: RISK_TIERS.R3,
      expected_by_path: {
        "README.md": RISK_TIERS.R3,
        "src/local/check.ts": RISK_TIERS.R3,
      },
    },
    {
      name: "the highest path wins overall",
      paths: ["README.md", "src/orders/export.ts", ".exoframe/templates.json"],
      expected_overall: RISK_TIERS.R3,
      expected_by_path: {
        "README.md": RISK_TIERS.R0,
        "src/orders/export.ts": RISK_TIERS.R2,
        ".exoframe/templates.json": RISK_TIERS.R3,
      },
    },
    {
      name: "a higher requested tier may raise overall",
      paths: ["README.md"],
      requested_tier: RISK_TIERS.R2,
      expected_overall: RISK_TIERS.R2,
      expected_by_path: { "README.md": RISK_TIERS.R0 },
    },
  ];

  for (const scenario of cases) {
    const decision = classify(scenario.paths, {
      intent: {
        schema_version: 1,
        task_id: "task-184",
        requested_tier: scenario.requested_tier ?? null,
      },
      diff: {
        paths: scenario.paths,
        trust_boundary: scenario.trust_boundary === true,
      },
    });
    assert.equal(
      decision.overall,
      scenario.expected_overall,
      scenario.name,
    );
    for (const [path, tier] of Object.entries(scenario.expected_by_path)) {
      assert.equal(
        decision.paths.find((item) => item.path === path)?.tier,
        tier,
        `${scenario.name}: ${path}`,
      );
    }
  }
});

test("an implementation agent cannot lower a computed risk tier", () => {
  const decision = classify(["src/orders/export.ts"], {
    intent: {
      schema_version: 1,
      task_id: "task-184",
      requested_tier: RISK_TIERS.R0,
    },
  });
  assert.equal(decision.overall, RISK_TIERS.R2);
  assert.equal(decision.paths[0]?.tier, RISK_TIERS.R2);
  assert.equal(decision.paths[0]?.category, PATH_CATEGORIES.PRODUCTION);
});
