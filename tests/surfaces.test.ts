import assert from "node:assert/strict";
import test from "node:test";

import {
  matchSurfaces,
  PATH_CATEGORIES,
  RISK_TIERS,
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

function policy(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1 as const,
    path_rules: pathRules,
    surfaces: [ordersExport],
    ...overrides,
  };
}

function match(overrides: Record<string, unknown> = {}) {
  return matchSurfaces({
    base_policy: policy(),
    diff: {
      paths: [
        "README.md",
        "src/orders/export.ts",
        "mystery.bin",
      ],
    },
    proposal: null,
    ...overrides,
  });
}

test("a declared untracked_ok documentation change may remain R0, while an uncertain path is production", () => {
  const decision = match();
  assert.equal(
    decision.classifications.find((item) => item.path === "README.md")
      ?.category,
    PATH_CATEGORIES.UNTRACKED_OK,
  );
  assert.equal(
    decision.classifications.find((item) => item.path === "mystery.bin")
      ?.category,
    PATH_CATEGORIES.PRODUCTION,
  );
  assert.equal(
    decision.classifications.find((item) => item.path === "src/orders/export.ts")
      ?.category,
    PATH_CATEGORIES.PRODUCTION,
  );
  assert.equal(decision.policy_weakening, false);
});

test("unknown changed production code receives provisional R2 coverage", () => {
  for (const filePath of [
    "src/unknown/widget.ts",
    "src/foo_bar.ts",
    "src/HTTP.ts",
    ".gitignore",
  ]) {
    const decision = match({
      diff: { paths: [filePath] },
    });
    assert.equal(decision.classifications[0]?.category, PATH_CATEGORIES.PRODUCTION);
    const provisional = decision.surfaces.find(
      (surface) => surface.kind === "provisional",
    );
    assert.equal(provisional?.risk_floor, RISK_TIERS.R2);
    assert.match(provisional?.id ?? "", /^provisional\.[0-9a-f]{64}$/u);
    assert.deepEqual(provisional?.paths, [filePath]);
    assert.equal(
      decision.surfaces.find((surface) => surface.id === "orders-export"),
      undefined,
    );
  }
});

test("a proposal cannot drop R2 hypotheses or coverage; additions remain", () => {
  const weakened = match({
    diff: { paths: ["src/orders/export.ts"] },
    proposal: {
      schema_version: 1,
      surfaces: [
        {
          ...ordersExport,
          paths: ["src/orders/export.ts"],
          risk_floor: RISK_TIERS.R1,
          hypotheses: ["empty-export-is-valid"],
        },
      ],
    },
  });
  const surface = weakened.surfaces.find((item) => item.id === "orders-export");
  assert.equal(weakened.policy_weakening, true);
  assert.equal(surface?.kind, "declared");
  assert.equal(surface?.risk_floor, RISK_TIERS.R2);
  assert.deepEqual(surface?.paths, [
    "src/orders/**",
    "src/orders/export.ts",
    "tests/orders/**",
  ]);
  assert.deepEqual(surface?.hypotheses, [
    "authorization-is-enforced",
    "empty-export-is-valid",
  ]);

  const added = match({
    diff: { paths: ["src/orders/export.ts", "src/preview/panel.ts"] },
    proposal: {
      schema_version: 1,
      surfaces: [
        {
          ...ordersExport,
          hypotheses: [
            "authorization-is-enforced",
            "empty-export-is-valid",
            "csv-is-utf8",
          ],
        },
        {
          schema_version: 1,
          id: "orders-preview",
          paths: ["src/preview/**"],
          consumption: "browser",
          risk_floor: RISK_TIERS.R2,
          exercises: ["g4.orders-preview-browser"],
          hypotheses: ["preview-is-isolated"],
          publishes_artifact: false,
        },
      ],
    },
  });
  assert.equal(added.policy_weakening, false);
  assert.deepEqual(
    added.surfaces.find((item) => item.id === "orders-export")?.hypotheses,
    ["authorization-is-enforced", "csv-is-utf8", "empty-export-is-valid"],
  );
  assert.equal(
    added.surfaces.some((item) => item.id === "orders-preview"),
    true,
  );
});
