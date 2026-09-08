import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { bootstrapRiskPolicy, RISK_TIERS } from "../src/index.ts";

type CommandResult = Readonly<{
  exitCode: number;
  stderr: string;
  stdout: string;
}>;

const binPath = fileURLToPath(new URL("../src/bin.ts", import.meta.url));

function invokeCli(
  stateRoot: string,
  workingDirectory: string,
  args: readonly string[],
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [binPath, ...args], {
      cwd: workingDirectory,
      env: {
        ...process.env,
        EXOFRAME_STATE_ROOT: stateRoot,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (exitCode) => {
      if (exitCode === null) {
        reject(new Error("Exoframe CLI exited without a numeric status"));
        return;
      }
      resolve({ exitCode, stderr, stdout });
    });
  });
}

async function representativeCheckout(root: string): Promise<string> {
  const checkout = join(root, "checkout");
  await mkdir(join(checkout, "src", "payments"), { recursive: true });
  await mkdir(join(checkout, "src", "auth"), { recursive: true });
  await mkdir(join(checkout, "tests", "payments"), { recursive: true });
  await writeFile(
    join(checkout, "src", "payments", "ledger.ts"),
    "export const balance = 0;\n",
  );
  await writeFile(
    join(checkout, "src", "auth", "session.ts"),
    "export function issueToken() {}\n",
  );
  await writeFile(
    join(checkout, "tests", "payments", "ledger.test.ts"),
    "import test from \"node:test\";\ntest(\"ledger\", () => {});\n",
  );
  return checkout;
}

test("risk-bootstrap writes the proposed policy from deterministic discovery", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "exoframe-risk-bootstrap-cli-"));
  t.after(async () => rm(sandbox, { recursive: true, force: true }));
  const stateRoot = join(sandbox, "state");
  const checkout = await representativeCheckout(sandbox);

  const result = await invokeCli(stateRoot, checkout, ["risk-bootstrap"]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");

  const body = JSON.parse(result.stdout) as {
    schema_version: number;
    policy_path: string;
    yaml: string;
    policy: Readonly<{
      unknown_production_floor: string;
      trust_boundary_floor: string;
      paths: readonly Readonly<{
        pattern: string;
        minimum_risk: string;
      }>[];
    }>;
    facts: Readonly<{
      domains: readonly Readonly<{
        root_path: string;
        criticality: string;
        minimum_risk: string;
      }>[];
    }>;
  };

  assert.equal(body.schema_version, 1);
  assert.equal(body.policy_path, ".pstack-risk.yml");
  assert.match(body.yaml, /^version: 1\n/u);

  const expected = await bootstrapRiskPolicy(checkout);
  assert.equal(body.yaml, expected.yaml);
  assert.equal(body.policy.unknown_production_floor, RISK_TIERS.R2);
  assert.equal(body.policy.trust_boundary_floor, RISK_TIERS.R3);

  const payments = body.facts.domains.find(
    (domain) => domain.root_path === "src/payments",
  );
  assert.ok(payments);
  assert.equal(payments.criticality, "financial");
  assert.equal(payments.minimum_risk, RISK_TIERS.R3);

  const written = await readFile(join(checkout, ".pstack-risk.yml"), "utf8");
  assert.equal(written, expected.yaml);
});
