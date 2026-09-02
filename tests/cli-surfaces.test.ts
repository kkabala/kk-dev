import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

type CommandResult = Readonly<{
  exitCode: number;
  stderr: string;
  stdout: string;
}>;

const binPath = fileURLToPath(new URL("../src/bin.ts", import.meta.url));

const surfaceCatalog = {
  schema_version: 1,
  path_rules: [
    {
      category: "control_plane",
      patterns: [".exoframe/**", ".github/workflows/**"],
    },
    {
      category: "verification",
      patterns: ["tests/**"],
    },
    {
      category: "untracked_ok",
      patterns: ["*.md", "docs/**"],
    },
    {
      category: "production",
      patterns: ["src/**"],
    },
  ],
  surfaces: [
    {
      schema_version: 1,
      id: "orders-export",
      paths: ["src/orders/**", "tests/orders/**"],
      consumption: "browser",
      risk_floor: "R2",
      exercises: ["g4.orders-export-browser"],
      hypotheses: ["authorization-is-enforced", "empty-export-is-valid"],
      publishes_artifact: false,
    },
  ],
};

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

async function writeCatalog(checkout: string, catalog: unknown): Promise<void> {
  await mkdir(join(checkout, ".exoframe"), { recursive: true });
  await writeFile(
    join(checkout, ".exoframe", "surfaces.json"),
    `${JSON.stringify(catalog)}\n`,
  );
}

test("surfaces explain reports the covering surface and path category", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "exoframe-surfaces-explain-"));
  t.after(async () => rm(sandbox, { recursive: true, force: true }));
  const stateRoot = join(sandbox, "state");
  const checkout = join(sandbox, "checkout");
  await mkdir(checkout);
  await writeCatalog(checkout, surfaceCatalog);

  const result = await invokeCli(stateRoot, checkout, [
    "surfaces",
    "explain",
    "src/orders/export.ts",
  ]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  const body = JSON.parse(result.stdout) as {
    path: string;
    category: string;
    surfaces: readonly { id: string; kind: string; risk_floor: string }[];
  };
  assert.equal(body.path, "src/orders/export.ts");
  assert.equal(body.category, "production");
  assert.equal(body.surfaces[0]?.id, "orders-export");
  assert.equal(body.surfaces[0]?.kind, "declared");
  assert.equal(body.surfaces[0]?.risk_floor, "R2");
});

test("policy check reports weakening and remains clean when coverage is not dropped", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "exoframe-policy-check-"));
  t.after(async () => rm(sandbox, { recursive: true, force: true }));
  const stateRoot = join(sandbox, "state");
  const checkout = join(sandbox, "checkout");
  await mkdir(checkout);
  await writeCatalog(checkout, surfaceCatalog);

  const clean = await invokeCli(stateRoot, checkout, ["policy", "check"]);
  assert.equal(clean.exitCode, 0);
  assert.equal(clean.stderr, "");
  assert.equal(JSON.parse(clean.stdout).policy_weakening, false);

  await mkdir(join(checkout, ".exoframe", "proposals"), { recursive: true });
  await writeFile(
    join(checkout, ".exoframe", "proposals", "surfaces.json"),
    `${JSON.stringify({
      schema_version: 1,
      surfaces: [
        {
          ...surfaceCatalog.surfaces[0],
          risk_floor: "R1",
          hypotheses: ["empty-export-is-valid"],
        },
      ],
    })}\n`,
  );
  const weakened = await invokeCli(stateRoot, checkout, ["policy", "check"]);
  assert.equal(weakened.exitCode, 1);
  assert.equal(weakened.stderr, "");
  const report = JSON.parse(weakened.stdout) as {
    policy_weakening: boolean;
    surfaces: readonly { hypotheses: readonly string[]; risk_floor: string }[];
  };
  assert.equal(report.policy_weakening, true);
  assert.equal(report.surfaces[0]?.risk_floor, "R2");
  assert.deepEqual(report.surfaces[0]?.hypotheses, [
    "authorization-is-enforced",
    "empty-export-is-valid",
  ]);
});
