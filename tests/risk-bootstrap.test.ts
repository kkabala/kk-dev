import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  applyPathMinimum,
  bootstrapRiskPolicy,
  findPathMinimum,
  RISK_TIERS,
} from "../src/index.ts";

async function makeFixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "exoframe-risk-bootstrap-"));
  await mkdir(path.join(root, "src", "payments"), { recursive: true });
  await mkdir(path.join(root, "src", "auth"), { recursive: true });
  await mkdir(path.join(root, "src", "app-team"), { recursive: true });
  await mkdir(path.join(root, "src", "settings"), { recursive: true });
  await mkdir(path.join(root, "src", "api"), { recursive: true });
  await mkdir(path.join(root, "tests", "src", "payments"), { recursive: true });
  await mkdir(path.join(root, "database", "migrations"), { recursive: true });
  await writeFile(path.join(root, "src", "payments", "ledger.ts"), "export {};\n");
  await writeFile(path.join(root, "README.md"), "# fixture\n");
  return root;
}

test("bootstrapRiskPolicy discovers domains and assigns floors", async () => {
  const root = await makeFixture();
  const proposal = await bootstrapRiskPolicy(root);

  assert.equal(proposal.schema_version, 1);
  assert.equal(proposal.checkout_root, await path.resolve(root));

  const byName = new Map(proposal.domains.map((domain) => [domain.name, domain]));
  assert.equal(byName.get("payments")?.minimum_risk, RISK_TIERS.R3);
  assert.equal(byName.get("payments")?.domain, "financial");
  assert.equal(byName.get("auth")?.minimum_risk, RISK_TIERS.R3);
  assert.equal(byName.get("auth")?.domain, "security");
  assert.equal(byName.get("api")?.minimum_risk, RISK_TIERS.R2);
  assert.equal(byName.get("app-team")?.minimum_risk, RISK_TIERS.R1);
  assert.equal(byName.get("settings")?.minimum_risk, RISK_TIERS.R1);
  assert.equal(byName.get("migrations")?.minimum_risk, RISK_TIERS.R3);

  assert.match(proposal.policy_yaml, /src\/payments\/\*\*:/);
  assert.match(proposal.policy_yaml, /minimum_risk: R3/);
  assert.match(proposal.summary, /Detected \d+ domains/);
});

test("path minimums cannot be lowered by computed tiers", () => {
  assert.equal(
    applyPathMinimum(RISK_TIERS.R0, RISK_TIERS.R3),
    RISK_TIERS.R3,
  );
  assert.equal(
    applyPathMinimum(RISK_TIERS.R3, RISK_TIERS.R1),
    RISK_TIERS.R3,
  );
  assert.equal(applyPathMinimum(RISK_TIERS.R1, null), RISK_TIERS.R1);
});

test("findPathMinimum matches proposed globs", async () => {
  const root = await makeFixture();
  const proposal = await bootstrapRiskPolicy(root);
  assert.equal(
    findPathMinimum("src/payments/ledger.ts", proposal.path_policies),
    RISK_TIERS.R3,
  );
  assert.equal(
    findPathMinimum("src/app-team/Screen.tsx", proposal.path_policies),
    RISK_TIERS.R1,
  );
  assert.equal(
    findPathMinimum("README.md", proposal.path_policies),
    RISK_TIERS.R0,
  );
});

test("bootstrapRiskPolicy rejects invalid roots", async () => {
  await assert.rejects(() => bootstrapRiskPolicy(""), TypeError);
});
