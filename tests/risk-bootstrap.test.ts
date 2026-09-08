import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  bootstrapRiskPolicy,
  bootstrapSurfaces,
  classifyRisk,
  matchSurfaces,
  renderRiskPolicyYaml,
  resolvePathMinimumRisk,
  RISK_TIERS,
  writeBootstrapProposals,
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

async function writeTree(
  root: string,
  files: readonly string[],
): Promise<void> {
  for (const relative of files) {
    const absolute = path.join(root, relative);
    await mkdir(path.join(absolute, ".."), { recursive: true });
    await writeFile(absolute, "export {};\n");
  }
}

test("bootstrapSurfaces discovers payments, auth, app-team, and migrations", async (context) => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "exoframe-risk-bootstrap-"));
  context.after(async () => rm(sandbox, { recursive: true, force: true }));
  await writeTree(sandbox, [
    "src/payments/ledger.ts",
    "src/auth/session.ts",
    "src/app-team/widget.ts",
    "tests/payments/ledger.test.ts",
    "database/migrations/001.sql",
  ]);

  const result = await bootstrapSurfaces(sandbox);
  assert.equal(result.schema_version, 1);
  const payments = result.domains.find(
    (domain) => domain.root_path === "src/payments",
  );
  const auth = result.domains.find((domain) => domain.root_path === "src/auth");
  const appTeam = result.domains.find(
    (domain) => domain.root_path === "src/app-team",
  );
  assert.equal(payments?.criticality, "financial");
  assert.equal(payments?.risk_floor, RISK_TIERS.R3);
  assert.equal(auth?.criticality, "security");
  assert.equal(auth?.risk_floor, RISK_TIERS.R3);
  assert.notEqual(appTeam?.risk_floor, RISK_TIERS.R0);
  assert.ok(
    appTeam?.risk_floor === RISK_TIERS.R1 ||
      appTeam?.risk_floor === RISK_TIERS.R2,
  );

  const matched = matchSurfaces({
    base_policy: result.catalog,
    diff: { paths: ["src/payments/ledger.ts"] },
    proposal: null,
  });
  const classified = classifyRisk({
    base_policy: {
      schema_version: 1,
      unknown_production_floor: RISK_TIERS.R2,
      trust_boundary_floor: RISK_TIERS.R3,
    },
    intent: {
      schema_version: 1,
      task_id: "task-bootstrap",
      requested_tier: null,
    },
    diff: {
      paths: ["src/payments/ledger.ts"],
      trust_boundary: false,
    },
    surfaces: matched,
  });
  assert.equal(classified.overall, RISK_TIERS.R3);
  assert.equal(classified.paths[0]?.tier, RISK_TIERS.R3);
  assert.match(result.yaml, /schema_version/u);
  assert.match(result.yaml, /surfaces/u);

  const proposal = {
    schema_version: 1 as const,
    surfaces: result.catalog.surfaces,
  };
  const accepted = matchSurfaces({
    base_policy: result.catalog,
    diff: { paths: ["src/payments/ledger.ts"] },
    proposal,
  });
  assert.equal(accepted.schema_version, 1);
});

test("bootstrapSurfaces rejects an empty checkout root", async () => {
  await assert.rejects(() => bootstrapSurfaces(""), {
    name: "TypeError",
    message: "Invalid risk-bootstrap input",
  });
});

test("writeBootstrapProposals writes matchSurfaces proposal JSON and full catalog JSON", async (context) => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "exoframe-bootstrap-proposals-"));
  context.after(async () => rm(sandbox, { recursive: true, force: true }));
  await writeTree(sandbox, ["src/payments/ledger.ts"]);
  const result = await bootstrapSurfaces(sandbox);
  await writeBootstrapProposals(sandbox, result.catalog, result.yaml);

  const proposalPath = path.join(sandbox, ".exoframe", "proposals", "surfaces.json");
  const catalogPath = path.join(sandbox, ".exoframe", "proposals", "catalog.json");
  const yamlPath = path.join(sandbox, ".exoframe", "proposals", "surfaces.yaml");
  const proposal = JSON.parse(await readFile(proposalPath, "utf8")) as {
    schema_version: number;
    surfaces: unknown;
  };
  const catalog = JSON.parse(await readFile(catalogPath, "utf8")) as {
    schema_version: number;
    path_rules: unknown;
    surfaces: unknown;
  };
  assert.deepEqual(Object.keys(proposal).sort(), ["schema_version", "surfaces"]);
  assert.equal(proposal.schema_version, 1);
  assert.deepEqual(proposal.surfaces, result.catalog.surfaces);
  assert.deepEqual(Object.keys(catalog).sort(), [
    "path_rules",
    "schema_version",
    "surfaces",
  ]);
  assert.deepEqual(catalog, result.catalog);
  assert.equal(await readFile(yamlPath, "utf8"), result.yaml);
  await assert.rejects(
    () => readFile(path.join(sandbox, ".exoframe", "surfaces.json")),
    { code: "ENOENT" },
  );
  await assert.rejects(
    () => readFile(path.join(sandbox, ".exoframe", "surfaces.yaml")),
    { code: "ENOENT" },
  );
  const matched = matchSurfaces({
    base_policy: catalog,
    diff: { paths: ["src/payments/ledger.ts"] },
    proposal,
  });
  assert.equal(matched.schema_version, 1);
});
