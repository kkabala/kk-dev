import assert from "node:assert/strict";
import test from "node:test";

import {
  PATH_CATEGORIES,
  reevaluateRisk,
  RISK_TIERS,
} from "../src/index.ts";
import type { PathCategory, RiskTier } from "../src/index.ts";

function pathRisk(
  filePath: string,
  tier: RiskTier,
  category: PathCategory = PATH_CATEGORIES.PRODUCTION,
) {
  return {
    path: filePath,
    category,
    tier,
  };
}

test("an extra actual path sets escalated true", () => {
  const result = reevaluateRisk({
    planned: {
      schema_version: 1,
      overall: RISK_TIERS.R1,
      paths: [pathRisk("src/local/check.ts", RISK_TIERS.R1)],
      policy_weakening: false,
    },
    actual: {
      schema_version: 1,
      overall: RISK_TIERS.R1,
      paths: [
        pathRisk("src/local/check.ts", RISK_TIERS.R1),
        pathRisk("src/local/extra.ts", RISK_TIERS.R1),
      ],
      policy_weakening: false,
    },
  });
  assert.equal(result.schema_version, 1);
  assert.equal(result.planned, RISK_TIERS.R1);
  assert.equal(result.actual, RISK_TIERS.R1);
  assert.equal(result.overall, RISK_TIERS.R1);
  assert.equal(result.escalated, true);
  assert.deepEqual(result.extra_paths, ["src/local/extra.ts"]);
  assert.deepEqual(result.missing_paths, []);
});

test("actual R3 versus planned R1 yields overall R3 and escalated true", () => {
  const result = reevaluateRisk({
    planned: {
      schema_version: 1,
      overall: RISK_TIERS.R1,
      paths: [pathRisk("src/local/check.ts", RISK_TIERS.R1)],
      policy_weakening: false,
    },
    actual: {
      schema_version: 1,
      overall: RISK_TIERS.R3,
      paths: [pathRisk("src/payments/ledger.ts", RISK_TIERS.R3)],
      policy_weakening: false,
    },
  });
  assert.equal(result.overall, RISK_TIERS.R3);
  assert.equal(result.planned, RISK_TIERS.R1);
  assert.equal(result.actual, RISK_TIERS.R3);
  assert.equal(result.escalated, true);
});

test("missing planned paths do not lower overall", () => {
  const result = reevaluateRisk({
    planned: {
      schema_version: 1,
      overall: RISK_TIERS.R3,
      paths: [
        pathRisk("src/payments/ledger.ts", RISK_TIERS.R3),
        pathRisk("README.md", RISK_TIERS.R0, PATH_CATEGORIES.UNTRACKED_OK),
      ],
      policy_weakening: false,
    },
    actual: {
      schema_version: 1,
      overall: RISK_TIERS.R1,
      paths: [pathRisk("README.md", RISK_TIERS.R0, PATH_CATEGORIES.UNTRACKED_OK)],
      policy_weakening: false,
    },
  });
  assert.equal(result.overall, RISK_TIERS.R3);
  assert.equal(result.escalated, false);
  assert.deepEqual(result.extra_paths, []);
  assert.deepEqual(result.missing_paths, ["src/payments/ledger.ts"]);
});

test("identical planned and actual is not escalated", () => {
  const decision = {
    schema_version: 1,
    overall: RISK_TIERS.R2,
    paths: [pathRisk("src/orders/export.ts", RISK_TIERS.R2)],
    policy_weakening: false,
  };
  const result = reevaluateRisk({
    planned: decision,
    actual: decision,
  });
  assert.equal(result.escalated, false);
  assert.deepEqual(result.extra_paths, []);
  assert.deepEqual(result.missing_paths, []);
  assert.equal(result.overall, RISK_TIERS.R2);
  assert.equal(Object.isFrozen(result), true);
});

test("planned R3 plus actual R1 subset keeps decision overall R3 and actual paths", () => {
  const actualPaths = [
    pathRisk("README.md", RISK_TIERS.R0, PATH_CATEGORIES.UNTRACKED_OK),
  ];
  const result = reevaluateRisk({
    planned: {
      schema_version: 1,
      overall: RISK_TIERS.R3,
      paths: [
        pathRisk("src/payments/ledger.ts", RISK_TIERS.R3),
        pathRisk("README.md", RISK_TIERS.R0, PATH_CATEGORIES.UNTRACKED_OK),
      ],
      policy_weakening: false,
    },
    actual: {
      schema_version: 1,
      overall: RISK_TIERS.R1,
      paths: actualPaths,
      policy_weakening: false,
    },
  });
  assert.equal(result.decision.schema_version, 1);
  assert.equal(result.decision.overall, RISK_TIERS.R3);
  assert.deepEqual(result.decision.paths, actualPaths);
  assert.equal(result.decision.policy_weakening, false);
  assert.equal(result.overall, RISK_TIERS.R3);
});
