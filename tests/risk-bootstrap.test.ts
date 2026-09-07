import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  bootstrapRiskPolicy,
  renderRiskPolicyYaml,
  resolvePathMinimumRisk,
  RISK_TIERS,
} from "../src/index.ts";

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "exoframe-risk-bootstrap-"));
  await mkdir(path.join(root, "src", "payments"), { recursive: true });
  await mkdir(path.join(root, "src", "app-team"), { recursive: true });
  await mkdir(path.join(root, "src", "auth"), { recursive: true });
  await mkdir(path.join(root, "tests", "payments"), { recursive: true });
  await writeFile(
    path.join(root, "src", "payments", "ledger.ts"),
    "export const balance = 0;\n",
  );
  await writeFile(
    path.join(root, "src", "app-team", "settings.ts"),
    "export const label = \"Save\";\n",
  );
  await writeFile(
    path.join(root, "src", "auth", "session.ts"),
    "export function issueToken() {}\n",
  );
  await writeFile(
    path.join(root, "tests", "payments", "ledger.test.ts"),
    "import test from \"node:test\";\ntest(\"ledger\", () => {});\n",
  );
  await mkdir(path.join(root, "database", "migrations"), { recursive: true });
  await writeFile(
    path.join(root, "database", "migrations", "001.sql"),
    "SELECT 1;\n",
  );
  return root;
}

test("bootstrap discovers domains and assigns deterministic floors", async () => {
  const root = await fixtureRoot();
  const result = await bootstrapRiskPolicy(root);

  assert.equal(result.schema_version, 1);
  assert.equal(result.policy.schema_version, 1);
  assert.equal(result.policy.unknown_production_floor, RISK_TIERS.R2);
  assert.equal(result.policy.trust_boundary_floor, RISK_TIERS.R3);

  const byPath = new Map(
    result.facts.domains.map((domain) => [domain.root_path, domain]),
  );

  const payments = byPath.get("src/payments");
  assert.ok(payments);
  assert.equal(payments.criticality, "financial");
  assert.equal(payments.minimum_risk, RISK_TIERS.R3);
  assert.equal(payments.testability.unit, true);

  const auth = byPath.get("src/auth");
  assert.ok(auth);
  assert.equal(auth.criticality, "security");
  assert.equal(auth.minimum_risk, RISK_TIERS.R3);

  const appTeam = byPath.get("src/app-team");
  assert.ok(appTeam);
  assert.equal(appTeam.criticality, "none");
  assert.ok(
    appTeam.minimum_risk === RISK_TIERS.R1 ||
      appTeam.minimum_risk === RISK_TIERS.R2,
  );

  const paymentsFloor = resolvePathMinimumRisk(
    result.policy,
    "src/payments/ledger.ts",
  );
  assert.equal(paymentsFloor, RISK_TIERS.R3);

  const migrationFloor = resolvePathMinimumRisk(
    result.policy,
    "database/migrations/001.sql",
  );
  assert.equal(migrationFloor, RISK_TIERS.R3);
});

test("AI-style fact extraction cannot lower a repository minimum floor", async () => {
  const root = await fixtureRoot();
  const result = await bootstrapRiskPolicy(root);
  const floor = resolvePathMinimumRisk(
    result.policy,
    "src/payments/ledger.ts",
  );
  assert.equal(floor, RISK_TIERS.R3);
  assert.notEqual(floor, RISK_TIERS.R0);
  assert.notEqual(floor, RISK_TIERS.R1);
});

test("renderRiskPolicyYaml emits a reviewable policy artifact", async () => {
  const root = await fixtureRoot();
  const result = await bootstrapRiskPolicy(root);
  const yaml = renderRiskPolicyYaml(result.policy);
  assert.match(yaml, /^version: 1\n/u);
  assert.match(yaml, /risk_levels:/u);
  assert.match(yaml, /paths:/u);
  assert.match(yaml, /minimum_risk: R3/u);
  assert.equal(result.yaml, yaml);
});

test("bootstrap rejects an empty checkout root", async () => {
  await assert.rejects(() => bootstrapRiskPolicy(""), TypeError);
});
