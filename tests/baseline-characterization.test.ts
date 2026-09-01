import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const captureScript = path.join(
  packageRoot,
  "scripts",
  "capture-s0.4-baseline.mjs",
);
const baseSha = "1111111111111111111111111111111111111111";
const observedAt = "2026-09-01T10:15:30.000Z";
const installedManifestSha256 =
  "704427d8c5236a780e5d8276bbdf4abdb71ace132bf14f798a815d232b6f8d58";

const requiredMetricNames = [
  "active_human_minutes_per_task",
  "automatic_merge_rate_eligible_r0_r1",
  "bounce_cycles_per_task",
  "escaped_defect_rate_r0",
  "escaped_defect_rate_r1",
  "escaped_defect_rate_r2",
  "escaped_defect_rate_r3",
  "flaky_verification_rate",
  "repeated_failure_fingerprint_rate",
  "risk_underclassification_rate",
  "rollback_rate_r0",
  "rollback_rate_r1",
  "rollback_rate_r2",
  "rollback_rate_r3",
  "runner_cost_usd_per_task",
  "runner_duration_seconds_per_task",
  "task_to_engineering_ready_seconds_per_task",
  "task_to_merge_seconds_per_task",
  "token_cost_usd_per_task",
  "token_usage_per_task",
  "uninterrupted_completion_rate",
] as const;

const installedPortSkillIds = [
  "architect",
  "blast-radius",
  "bro",
  "how",
  "principle-boundary-discipline",
  "principle-build-the-lever",
  "principle-encode-lessons-in-structure",
  "principle-exhaust-the-design-space",
  "principle-experience-first",
  "principle-fix-root-causes",
  "principle-foundational-thinking",
  "principle-make-operations-idempotent",
  "principle-migrate-callers-then-delete-legacy-apis",
  "principle-minimize-reader-load",
  "principle-model-the-domain",
  "principle-prove-it-works",
  "principle-redesign-from-first-principles",
  "principle-separate-before-serializing-shared-state",
  "principle-subtract-before-you-add",
  "principle-type-system-discipline",
  "recall",
  "teach",
  "technical-writing",
  "typescript-best-practices",
  "unslop",
  "why",
] as const;

type CaptureResult = Readonly<{
  status: number | null;
  stderr: string;
  stdout: string;
}>;

type BaselineMetric = Readonly<{
  sample_count: number;
  value: number | null;
}>;

type Baseline = Readonly<{
  base_sha: string;
  baseline_id: string;
  compatibility: {
    implementation_engine_status: string;
    missing_requirements: string[];
    status: string;
  };
  contract: {
    id: string;
    sha256: string;
  };
  metrics: Record<string, BaselineMetric>;
  observed_at: string;
  plugin: {
    agent_ids: string[];
    declarations: {
      agents: boolean;
      apps: boolean;
      hooks: boolean;
      mcp: boolean;
      skills: boolean;
    };
    manifest_path: string;
    manifest_sha256: string;
    name: string;
    skill_ids: string[];
    version: string;
  };
  schema_version: number;
}>;

function invokeCapture(
  arguments_: readonly string[],
  options: Readonly<{
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  }> = {},
): CaptureResult {
  const result = spawnSync(process.execPath, [captureScript, ...arguments_], {
    cwd: options.cwd ?? packageRoot,
    encoding: "utf8",
    env: options.env ?? process.env,
  });

  return {
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
  };
}

function publicContract(): Readonly<Record<string, unknown>> {
  return {
    schema_version: 1,
    contract_id: "exoframe.pstack.implementation-engine",
    implementation_engine: "pstack",
    reference: {
      name: "pstack",
      version: "0.14.5",
      main_entry_skill: "poteto-mode",
    },
    accepted_manifest_paths: [
      ".cursor-plugin/plugin.json",
      ".codex-plugin/plugin.json",
    ],
    required_manifest_declarations: ["skills", "agents"],
    required_skill_ids: ["poteto-mode"],
    required_agent_ids: ["poteto-agent"],
  };
}

async function writeContract(root: string): Promise<string> {
  const contractPath = path.join(root, "pstack-contract.json");
  await writeFile(
    contractPath,
    `${JSON.stringify(publicContract(), null, 2)}\n`,
  );
  return contractPath;
}

async function writeManifest(
  pluginRoot: string,
  manifestPath: string,
  manifest: Readonly<Record<string, unknown>>,
): Promise<void> {
  const absoluteManifestPath = path.join(pluginRoot, manifestPath);
  await mkdir(path.dirname(absoluteManifestPath), { recursive: true });
  await writeFile(
    absoluteManifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

async function writeNamedDirectories(
  root: string,
  names: readonly string[],
): Promise<void> {
  await Promise.all(
    names.map(async (name) => {
      const entryRoot = path.join(root, name);
      await mkdir(entryRoot, { recursive: true });
      await writeFile(
        path.join(entryRoot, "SKILL.md"),
        "This content is deliberately not valid structured metadata.\n",
      );
    }),
  );
}

async function writeCompatiblePlugin(pluginRoot: string): Promise<void> {
  await writeManifest(pluginRoot, ".cursor-plugin/plugin.json", {
    name: "pstack",
    version: "0.14.5",
    skills: "./skills/",
    agents: "./agents/",
    hooks: "./hooks/preflight.mjs",
  });
  await writeNamedDirectories(path.join(pluginRoot, "skills"), [
    "poteto-mode",
    "how",
  ]);
  await mkdir(path.join(pluginRoot, "agents"), { recursive: true });
  await Promise.all([
    writeFile(
      path.join(pluginRoot, "agents", "poteto-agent.md"),
      "This content must not be parsed during capability capture.\n",
    ),
    writeFile(
      path.join(pluginRoot, "agents", "reviewer.md"),
      "This content must not be parsed during capability capture.\n",
    ),
    mkdir(path.join(pluginRoot, "hooks"), { recursive: true }),
  ]);
  await writeFile(
    path.join(pluginRoot, "hooks", "preflight.mjs"),
    [
      'import { writeFileSync } from "node:fs";',
      'writeFileSync(new URL("../executed.txt", import.meta.url), "executed\n");',
      "",
    ].join("\n"),
  );
}

async function writeInstalledPortLikePlugin(pluginRoot: string): Promise<void> {
  await writeManifest(pluginRoot, ".codex-plugin/plugin.json", {
    author: { name: "FetchUpstream" },
    description: "An unofficial ChatGPT port of pstack workflows.",
    interface: {
      capabilities: [],
      category: "Developer Tools",
      composerIcon: "./.codex-plugin/assets/composer-icon.svg",
      defaultPrompt: [
        "Explain how this subsystem works. Trace the code flow and flag the parts most likely to confuse developers.",
        "Review this PR for blast radius. Find what could break outside the diff and what still needs verification.",
        "Rewrite this to sound human. Keep the meaning and tone, but remove AI tells, filler, and generic phrasing.",
      ],
      developerName: "FetchUpstream",
      displayName: "pstack",
      logo: "./.codex-plugin/assets/logo.svg",
      longDescription:
        "An unofficial ChatGPT port of pstack, providing rigorous reusable workflows for engineering, reasoning, review, and writing.",
      shortDescription: "Engineering agent workflows",
      supportURL: "https://github.com/FetchUpstream/pstack-plugin",
      websiteURL: "https://github.com/FetchUpstream/pstack-plugin",
    },
    keywords: ["pstack", "workflow", "engineering", "writing", "unslop"],
    license: "MIT",
    name: "pstack-plugin",
    skills: "./skills/",
    version: "0.2.0",
  });
  await writeNamedDirectories(
    path.join(pluginRoot, "skills"),
    installedPortSkillIds,
  );

  // These undeclared entries prove that capture follows the manifest instead of
  // inferring capabilities from attractive names elsewhere in the plugin root.
  await writeNamedDirectories(path.join(pluginRoot, "undeclared-skills"), [
    "poteto-mode",
  ]);
  await mkdir(path.join(pluginRoot, "agents", "implementation-engine"), {
    recursive: true,
  });
}

function capture(
  contractPath: string,
  pluginRoot: string,
  options: Readonly<{
    baseSha?: string;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    observedAt?: string;
  }> = {},
): CaptureResult {
  return invokeCapture(
    [
      "--contract",
      contractPath,
      "--plugin-root",
      pluginRoot,
      "--base-sha",
      options.baseSha ?? baseSha,
      "--observed-at",
      options.observedAt ?? observedAt,
    ],
    {
      cwd: options.cwd ?? packageRoot,
      env: options.env ?? process.env,
    },
  );
}

function parseSuccessfulCapture(result: CaptureResult): Baseline {
  assert.equal(
    result.status,
    0,
    `capture must succeed; stderr was:\n${result.stderr}`,
  );
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /\n$/, "stdout must end with one newline");
  return JSON.parse(result.stdout) as Baseline;
}

async function digestFile(filePath: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}

async function digestTree(root: string): Promise<string> {
  const entries: string[] = [];

  async function visit(currentRoot: string): Promise<void> {
    const names = await readdir(currentRoot);
    names.sort();
    for (const name of names) {
      const absolutePath = path.join(currentRoot, name);
      const relativePath = path.relative(root, absolutePath);
      const fileStat = await stat(absolutePath);
      if (fileStat.isDirectory()) {
        entries.push(`directory:${relativePath}`);
        await visit(absolutePath);
      } else {
        entries.push(
          `file:${relativePath}:${createHash("sha256")
            .update(await readFile(absolutePath))
            .digest("hex")}`,
        );
      }
    }
  }

  await visit(root);
  return createHash("sha256").update(entries.join("\n")).digest("hex");
}

async function makeFixture(context: test.TestContext): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "exoframe-s0.4-acceptance-"));
  context.after(async () => rm(root, { force: true, recursive: true }));
  return root;
}

test("a compatible public pstack manifest produces deterministic read-only capability evidence", async (context) => {
  const fixtureRoot = await makeFixture(context);
  const contractPath = await writeContract(fixtureRoot);
  const firstPluginRoot = path.join(fixtureRoot, "first-plugin-location");
  const secondPluginRoot = path.join(fixtureRoot, "second-plugin-location");
  const unrelatedCwd = path.join(fixtureRoot, "unrelated-cwd");
  await Promise.all([
    writeCompatiblePlugin(firstPluginRoot),
    writeCompatiblePlugin(secondPluginRoot),
    mkdir(unrelatedCwd),
  ]);
  const contractBefore = await digestFile(contractPath);
  const firstPluginBefore = await digestTree(firstPluginRoot);
  const secondPluginBefore = await digestTree(secondPluginRoot);

  const firstResult = capture(contractPath, firstPluginRoot, {
    cwd: unrelatedCwd,
  });
  const secondResult = capture(contractPath, secondPluginRoot, {
    cwd: unrelatedCwd,
  });
  const baseline = parseSuccessfulCapture(firstResult);
  const compatibleManifestSha256 = await digestFile(
    path.join(firstPluginRoot, ".cursor-plugin", "plugin.json"),
  );

  assert.equal(
    firstResult.stdout,
    secondResult.stdout,
    "equivalent explicit plugin roots must serialize identically without leaking absolute paths",
  );
  assert.deepEqual(
    {
      schema_version: baseline.schema_version,
      baseline_id: baseline.baseline_id,
      observed_at: baseline.observed_at,
      base_sha: baseline.base_sha,
      plugin: baseline.plugin,
      compatibility: baseline.compatibility,
    },
    {
      schema_version: 1,
      baseline_id: "s0.4",
      observed_at: observedAt,
      base_sha: baseSha,
      plugin: {
        declarations: {
          agents: true,
          apps: false,
          hooks: true,
          mcp: false,
          skills: true,
        },
        manifest_path: ".cursor-plugin/plugin.json",
        manifest_sha256: compatibleManifestSha256,
        name: "pstack",
        version: "0.14.5",
        skill_ids: ["how", "poteto-mode"],
        agent_ids: ["poteto-agent", "reviewer"],
      },
      compatibility: {
        status: "compatible",
        implementation_engine_status: "available",
        missing_requirements: [],
      },
    },
  );
  assert.deepEqual(baseline.contract, {
    id: "exoframe.pstack.implementation-engine",
    sha256: await digestFile(contractPath),
  });
  assert.equal(await digestFile(contractPath), contractBefore);
  assert.equal(await digestTree(firstPluginRoot), firstPluginBefore);
  assert.equal(await digestTree(secondPluginRoot), secondPluginBefore);
  await assert.rejects(access(path.join(firstPluginRoot, "executed.txt")), {
    code: "ENOENT",
  });
});

test("an explicitly supplied plugin-root symlink uses its canonical target as the confinement root", async (context) => {
  const fixtureRoot = await makeFixture(context);
  const contractPath = await writeContract(fixtureRoot);
  const canonicalPluginRoot = path.join(fixtureRoot, "canonical-plugin");
  const pluginRootAlias = path.join(fixtureRoot, "plugin-root-alias");
  await writeCompatiblePlugin(canonicalPluginRoot);
  await symlink(canonicalPluginRoot, pluginRootAlias);

  const baseline = parseSuccessfulCapture(
    capture(contractPath, pluginRootAlias),
  );

  assert.equal(baseline.compatibility.status, "compatible");
  assert.deepEqual(baseline.plugin.skill_ids, ["how", "poteto-mode"]);
  assert.deepEqual(baseline.plugin.agent_ids, ["poteto-agent", "reviewer"]);
});

test("engine compatibility requires the exact reference name and version", async (context) => {
  const fixtureRoot = await makeFixture(context);
  const contractPath = await writeContract(fixtureRoot);
  const mismatches = [
    {
      name: "not-pstack",
      version: "0.14.5",
      missingRequirement: "plugin.name",
    },
    {
      name: "pstack",
      version: "0.14.6",
      missingRequirement: "plugin.version",
    },
  ] as const;

  for (const mismatch of mismatches) {
    const pluginRoot = path.join(
      fixtureRoot,
      `plugin-${mismatch.missingRequirement}`,
    );
    await writeCompatiblePlugin(pluginRoot);
    await writeManifest(pluginRoot, ".cursor-plugin/plugin.json", {
      name: mismatch.name,
      version: mismatch.version,
      skills: "./skills/",
      agents: "./agents/",
      hooks: "./hooks/preflight.mjs",
    });

    const baseline = parseSuccessfulCapture(capture(contractPath, pluginRoot));

    assert.equal(baseline.compatibility.status, "incompatible");
    assert.equal(
      baseline.compatibility.implementation_engine_status,
      "unavailable",
    );
    assert.deepEqual(baseline.compatibility.missing_requirements, [
      mismatch.missingRequirement,
    ]);
  }
});

test("poteto-mode is a capability only with a direct regular SKILL.md", async (context) => {
  const fixtureRoot = await makeFixture(context);
  const contractPath = await writeContract(fixtureRoot);

  for (const invalidShape of ["missing", "symlink", "directory"] as const) {
    const pluginRoot = path.join(fixtureRoot, `plugin-${invalidShape}`);
    await writeCompatiblePlugin(pluginRoot);
    const skillFile = path.join(
      pluginRoot,
      "skills",
      "poteto-mode",
      "SKILL.md",
    );
    await rm(skillFile);
    if (invalidShape === "symlink") {
      await symlink(path.join(pluginRoot, "skills", "how", "SKILL.md"), skillFile);
    } else if (invalidShape === "directory") {
      await mkdir(skillFile);
    }

    const baseline = parseSuccessfulCapture(capture(contractPath, pluginRoot));

    assert.deepEqual(baseline.plugin.skill_ids, ["how"]);
    assert.deepEqual(baseline.compatibility.missing_requirements, [
      "skills.poteto-mode",
    ]);
    assert.equal(baseline.compatibility.status, "incompatible");
  }
});

test("the required implementation agent must be present", async (context) => {
  const fixtureRoot = await makeFixture(context);
  const contractPath = await writeContract(fixtureRoot);
  const pluginRoot = path.join(fixtureRoot, "plugin");
  await writeCompatiblePlugin(pluginRoot);
  await rm(path.join(pluginRoot, "agents", "poteto-agent.md"));

  const baseline = parseSuccessfulCapture(capture(contractPath, pluginRoot));

  assert.deepEqual(baseline.plugin.agent_ids, ["reviewer"]);
  assert.deepEqual(baseline.compatibility.missing_requirements, [
    "agents.poteto-agent",
  ]);
  assert.equal(baseline.compatibility.status, "incompatible");
});

test("the installed skills-only ChatGPT port is incompatible and unavailable as Exoframe's engine", async (context) => {
  const fixtureRoot = await makeFixture(context);
  const contractPath = await writeContract(fixtureRoot);
  const pluginRoot = path.join(fixtureRoot, "pstack-plugin-0.2.0");
  await writeInstalledPortLikePlugin(pluginRoot);
  const pluginBefore = await digestTree(pluginRoot);
  assert.equal(
    await digestFile(
      path.join(pluginRoot, ".codex-plugin", "plugin.json"),
    ),
    installedManifestSha256,
  );

  const baseline = parseSuccessfulCapture(capture(contractPath, pluginRoot));

  assert.deepEqual(baseline.plugin, {
    declarations: {
      agents: false,
      apps: false,
      hooks: false,
      mcp: false,
      skills: true,
    },
    manifest_path: ".codex-plugin/plugin.json",
    manifest_sha256: installedManifestSha256,
    name: "pstack-plugin",
    version: "0.2.0",
    skill_ids: [...installedPortSkillIds],
    agent_ids: [],
  });
  assert.deepEqual(baseline.compatibility, {
    status: "incompatible",
    implementation_engine_status: "unavailable",
    missing_requirements: [
      "plugin.name",
      "plugin.version",
      "manifest.agents",
      "skills.poteto-mode",
      "agents.poteto-agent",
    ],
  });
  assert.equal(
    await digestTree(pluginRoot),
    pluginBefore,
    "characterization must neither patch nor otherwise mutate the third-party port",
  );
});

test("a baseline with no Exoframe run history reports unknown metrics instead of invented zero success", async (context) => {
  const fixtureRoot = await makeFixture(context);
  const contractPath = await writeContract(fixtureRoot);
  const pluginRoot = path.join(fixtureRoot, "plugin");
  await writeInstalledPortLikePlugin(pluginRoot);

  const baseline = parseSuccessfulCapture(capture(contractPath, pluginRoot));

  assert.deepEqual(Object.keys(baseline.metrics).sort(), requiredMetricNames);
  for (const metricName of requiredMetricNames) {
    assert.deepEqual(
      baseline.metrics[metricName],
      { sample_count: 0, value: null },
      `${metricName} must remain unknown until a real Exoframe run is observed`,
    );
  }
});

test("an explicit root without a manifest fails without searching hidden home or cache locations", async (context) => {
  const fixtureRoot = await makeFixture(context);
  const contractPath = await writeContract(fixtureRoot);
  const explicitEmptyRoot = path.join(fixtureRoot, "explicit-empty-root");
  const fakeHome = path.join(fixtureRoot, "fake-home");
  const hiddenPluginRoot = path.join(
    fakeHome,
    ".codex",
    "plugins",
    "cache",
    "pstack-plugin",
    "0.2.0",
  );
  await Promise.all([
    mkdir(explicitEmptyRoot, { recursive: true }),
    writeCompatiblePlugin(hiddenPluginRoot),
  ]);
  const hiddenPluginBefore = await digestTree(hiddenPluginRoot);

  const result = capture(contractPath, explicitEmptyRoot, {
    env: {
      ...process.env,
      CODEX_HOME: path.join(fakeHome, ".codex"),
      HOME: fakeHome,
      XDG_CACHE_HOME: path.join(fakeHome, ".cache"),
    },
  });

  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /plugin manifest/i);
  assert.match(result.stderr, /explicit-empty-root/);
  assert.doesNotMatch(
    result.stderr,
    /pstack-plugin[/\\]0\.2\.0/,
    "the diagnostic must not reveal or imply discovery of a hidden cached plugin",
  );
  assert.equal(await digestTree(hiddenPluginRoot), hiddenPluginBefore);
});

test("a malformed explicit manifest fails clearly and preserves every inspected byte", async (context) => {
  const fixtureRoot = await makeFixture(context);
  const contractPath = await writeContract(fixtureRoot);
  const pluginRoot = path.join(fixtureRoot, "malformed-plugin");
  const manifestPath = path.join(pluginRoot, ".codex-plugin", "plugin.json");
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, '{ "name": "pstack-plugin",\n');
  await writeFile(path.join(pluginRoot, "keep.txt"), "preserve me\n");
  const pluginBefore = await digestTree(pluginRoot);

  const result = capture(contractPath, pluginRoot);

  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /invalid plugin manifest/i);
  assert.match(result.stderr, /\.codex-plugin[/\\]plugin\.json/);
  assert.equal(await digestTree(pluginRoot), pluginBefore);
});

test("an unknown contract capability requirement cannot be satisfied through the object prototype", async (context) => {
  const fixtureRoot = await makeFixture(context);
  const contractPath = path.join(fixtureRoot, "malicious-contract.json");
  const pluginRoot = path.join(fixtureRoot, "plugin");
  await writeFile(
    contractPath,
    `${JSON.stringify(
      {
        ...publicContract(),
        required_manifest_declarations: ["__proto__"],
      },
      null,
      2,
    )}\n`,
  );
  await writeCompatiblePlugin(pluginRoot);
  const pluginBefore = await digestTree(pluginRoot);

  const result = capture(contractPath, pluginRoot);

  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /required_manifest_declarations/i);
  assert.match(result.stderr, /supported|unknown/i);
  assert.equal(await digestTree(pluginRoot), pluginBefore);
});

test("the main entry skill must be one of the contract's required skills", async (context) => {
  const fixtureRoot = await makeFixture(context);
  const contractPath = path.join(fixtureRoot, "inconsistent-contract.json");
  const pluginRoot = path.join(fixtureRoot, "plugin");
  await writeFile(
    contractPath,
    `${JSON.stringify(
      {
        ...publicContract(),
        required_skill_ids: ["how"],
      },
      null,
      2,
    )}\n`,
  );
  await writeCompatiblePlugin(pluginRoot);

  const result = capture(contractPath, pluginRoot);

  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /reference\.main_entry_skill/i);
  assert.match(result.stderr, /required_skill_ids/i);
});

test("multiple accepted manifests fail closed without selecting one by precedence", async (context) => {
  const fixtureRoot = await makeFixture(context);
  const contractPath = await writeContract(fixtureRoot);
  const pluginRoot = path.join(fixtureRoot, "ambiguous-plugin");
  await writeCompatiblePlugin(pluginRoot);
  await writeManifest(pluginRoot, ".codex-plugin/plugin.json", {
    name: "pstack-plugin",
    version: "0.2.0",
    skills: "./skills/",
    agents: "./agents/",
  });
  const pluginBefore = await digestTree(pluginRoot);

  const result = capture(contractPath, pluginRoot);

  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /multiple accepted plugin manifests/i);
  assert.match(result.stderr, /ambiguous-plugin/);
  assert.equal(await digestTree(pluginRoot), pluginBefore);
});

test("a missing manifest-declared capability directory fails without partial output or mutation", async (context) => {
  const fixtureRoot = await makeFixture(context);
  const contractPath = await writeContract(fixtureRoot);
  const pluginRoot = path.join(fixtureRoot, "missing-capability-root");
  await writeManifest(pluginRoot, ".codex-plugin/plugin.json", {
    name: "pstack",
    version: "0.14.5",
    skills: "./missing-skills/",
    agents: "./agents/",
  });
  await mkdir(path.join(pluginRoot, "agents"));
  const pluginBefore = await digestTree(pluginRoot);

  const result = capture(contractPath, pluginRoot);

  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /plugin manifest skills/i);
  assert.match(result.stderr, /cannot be resolved/i);
  assert.ok(!result.stderr.includes(fixtureRoot));
  assert.equal(await digestTree(pluginRoot), pluginBefore);
});

test("malformed CLI arguments and candidate identifiers fail before producing evidence", async (context) => {
  const fixtureRoot = await makeFixture(context);
  const contractPath = await writeContract(fixtureRoot);
  const pluginRoot = path.join(fixtureRoot, "plugin");
  await writeCompatiblePlugin(pluginRoot);
  const pluginBefore = await digestTree(pluginRoot);

  const malformedInvocations = [
    {
      expectedDiagnostic: /missing required option|usage/i,
      result: invokeCapture(["--contract", contractPath]),
    },
    {
      expectedDiagnostic: /usage/i,
      result: invokeCapture([
        "--contract",
        contractPath,
        "--plugin-root",
        pluginRoot,
        "--base-sha",
        baseSha,
        "--observed-at",
        observedAt,
        "--unexpected",
        "value",
      ]),
    },
    {
      expectedDiagnostic: /base-sha.*lowercase 40-character Git SHA/i,
      result: capture(contractPath, pluginRoot, {
        baseSha: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      }),
    },
  ];

  for (const { expectedDiagnostic, result } of malformedInvocations) {
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, expectedDiagnostic);
  }
  assert.equal(await digestTree(pluginRoot), pluginBefore);
});

test("contract manifest paths cannot escape the explicit root or disclose an external target", async (context) => {
  const fixtureRoot = await makeFixture(context);
  const contractPath = path.join(fixtureRoot, "escaping-contract.json");
  const pluginRoot = path.join(fixtureRoot, "plugin");
  const externalRoot = path.join(fixtureRoot, "do-not-disclose-external");
  const externalMarker = "external-manifest-secret-marker";
  await mkdir(pluginRoot);
  await mkdir(externalRoot);
  await writeFile(
    path.join(externalRoot, "plugin.json"),
    `${JSON.stringify({ name: externalMarker, version: "9.9.9" })}\n`,
  );
  await writeFile(
    contractPath,
    `${JSON.stringify(
      {
        ...publicContract(),
        accepted_manifest_paths: ["../do-not-disclose-external/plugin.json"],
      },
      null,
      2,
    )}\n`,
  );
  const externalBefore = await digestTree(externalRoot);

  const result = capture(contractPath, pluginRoot);

  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /contract accepted manifest path/i);
  assert.match(result.stderr, /escape|explicit plugin root/i);
  assert.ok(!result.stderr.includes(externalRoot));
  assert.ok(!result.stderr.includes(externalMarker));
  assert.equal(await digestTree(externalRoot), externalBefore);
});

test("a manifest symlink cannot escape the explicit plugin root", async (context) => {
  const fixtureRoot = await makeFixture(context);
  const contractPath = await writeContract(fixtureRoot);
  const pluginRoot = path.join(fixtureRoot, "plugin");
  const externalManifestPath = path.join(fixtureRoot, "external-manifest.json");
  const externalMarker = "external-plugin-must-not-be-disclosed";
  await mkdir(path.join(pluginRoot, ".codex-plugin"), { recursive: true });
  await writeFile(
    externalManifestPath,
    `${JSON.stringify({ name: externalMarker, version: "9.9.9" })}\n`,
  );
  await symlink(
    externalManifestPath,
    path.join(pluginRoot, ".codex-plugin", "plugin.json"),
  );

  const result = capture(contractPath, pluginRoot);

  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /plugin manifest/i);
  assert.match(result.stderr, /explicit plugin root|escape|outside/i);
  assert.ok(!result.stderr.includes(externalManifestPath));
  assert.ok(!result.stderr.includes(externalMarker));
});

test("manifest-declared capability directories cannot escape through symlinks", async (context) => {
  const fixtureRoot = await makeFixture(context);
  const contractPath = await writeContract(fixtureRoot);

  for (const declarationName of ["skills", "agents"] as const) {
    const pluginRoot = path.join(fixtureRoot, `${declarationName}-plugin`);
    const externalRoot = path.join(fixtureRoot, `${declarationName}-external`);
    const externalMarker = `${declarationName}-outside-marker`;
    await writeManifest(pluginRoot, ".codex-plugin/plugin.json", {
      name: "pstack",
      version: "0.14.5",
      skills: "./skills/",
      agents: "./agents/",
    });
    await mkdir(externalRoot, { recursive: true });
    if (declarationName === "skills") {
      await mkdir(path.join(pluginRoot, "agents"), { recursive: true });
      await mkdir(path.join(externalRoot, externalMarker));
      await symlink(externalRoot, path.join(pluginRoot, "skills"));
    } else {
      await mkdir(path.join(pluginRoot, "skills", "poteto-mode"), {
        recursive: true,
      });
      await writeFile(path.join(externalRoot, `${externalMarker}.md`), "x\n");
      await symlink(externalRoot, path.join(pluginRoot, "agents"));
    }

    const result = capture(contractPath, pluginRoot);

    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, new RegExp(`plugin manifest ${declarationName}`, "i"));
    assert.match(result.stderr, /explicit plugin root|escape|outside/i);
    assert.ok(!result.stderr.includes(externalRoot));
    assert.ok(!result.stderr.includes(externalMarker));
  }
});

test("capability inventory includes only direct public entry shapes", async (context) => {
  const fixtureRoot = await makeFixture(context);
  const contractPath = await writeContract(fixtureRoot);
  const pluginRoot = path.join(fixtureRoot, "plugin");
  await writeCompatiblePlugin(pluginRoot);
  await Promise.all([
    mkdir(path.join(pluginRoot, "skills", ".hidden-skill")),
    writeFile(path.join(pluginRoot, "skills", "notes.txt"), "not a skill\n"),
    symlink(
      path.join(pluginRoot, "skills", "how"),
      path.join(pluginRoot, "skills", "linked-skill"),
    ),
    mkdir(path.join(pluginRoot, "agents", "directory-agent")),
    writeFile(path.join(pluginRoot, "agents", ".hidden-agent.md"), "hidden\n"),
    writeFile(path.join(pluginRoot, "agents", "notes.txt"), "not an agent\n"),
    writeFile(path.join(pluginRoot, "agents", "uppercase.MD"), "not public\n"),
    symlink(
      path.join(pluginRoot, "agents", "reviewer.md"),
      path.join(pluginRoot, "agents", "linked-agent.md"),
    ),
  ]);

  const baseline = parseSuccessfulCapture(capture(contractPath, pluginRoot));

  assert.deepEqual(baseline.plugin.skill_ids, ["how", "poteto-mode"]);
  assert.deepEqual(baseline.plugin.agent_ids, ["poteto-agent", "reviewer"]);
});

test("observed-at requires the canonical UTC ISO-8601 representation", async (context) => {
  const fixtureRoot = await makeFixture(context);
  const contractPath = await writeContract(fixtureRoot);
  const pluginRoot = path.join(fixtureRoot, "plugin");
  await writeInstalledPortLikePlugin(pluginRoot);

  const result = capture(contractPath, pluginRoot, {
    observedAt: "September 1, 2026 10:15:30 UTC",
  });

  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /observed-at/i);
  assert.match(result.stderr, /canonical|UTC|ISO-8601/i);
});

test("the documented npm entry point emits the same evidence as the collector", async (context) => {
  const fixtureRoot = await makeFixture(context);
  const contractPath = await writeContract(fixtureRoot);
  const pluginRoot = path.join(fixtureRoot, "plugin");
  await writeCompatiblePlugin(pluginRoot);

  const npmResult = spawnSync(
    "npm",
    [
      "run",
      "--silent",
      "baseline:s0.4",
      "--",
      "--contract",
      contractPath,
      "--plugin-root",
      pluginRoot,
      "--base-sha",
      baseSha,
      "--observed-at",
      observedAt,
    ],
    {
      cwd: packageRoot,
      encoding: "utf8",
    },
  );

  assert.equal(npmResult.status, 0, npmResult.stderr);
  assert.equal(npmResult.stderr, "");
  assert.equal(
    npmResult.stdout,
    capture(contractPath, pluginRoot).stdout,
    "the documented wrapper must preserve the collector's deterministic output",
  );
});

test("the committed contract, machine baseline, and human report describe one reproducible observation", async (context) => {
  const committedContractPath = path.join(
    packageRoot,
    "docs",
    "baselines",
    "s0.4-pstack-contract.json",
  );
  const committedBaselinePath = path.join(
    packageRoot,
    "docs",
    "baselines",
    "s0.4-baseline.json",
  );
  const committedReportPath = path.join(
    packageRoot,
    "docs",
    "baselines",
    "s0.4-characterization.md",
  );
  const [contractText, baselineText, report] = await Promise.all([
    readFile(committedContractPath, "utf8"),
    readFile(committedBaselinePath, "utf8"),
    readFile(committedReportPath, "utf8"),
  ]);
  const contract = JSON.parse(contractText) as Readonly<Record<string, unknown>>;
  const baseline = JSON.parse(baselineText) as Baseline;

  assert.deepEqual(contract, publicContract());
  assert.equal(baseline.schema_version, 1);
  assert.equal(baseline.baseline_id, "s0.4");
  assert.equal(baseline.contract.id, "exoframe.pstack.implementation-engine");
  assert.equal(
    baseline.contract.sha256,
    createHash("sha256").update(contractText).digest("hex"),
  );
  assert.deepEqual(baseline.plugin, {
    declarations: {
      agents: false,
      apps: false,
      hooks: false,
      mcp: false,
      skills: true,
    },
    manifest_path: ".codex-plugin/plugin.json",
    manifest_sha256: installedManifestSha256,
    name: "pstack-plugin",
    version: "0.2.0",
    skill_ids: [...installedPortSkillIds],
    agent_ids: [],
  });
  assert.deepEqual(baseline.compatibility, {
    status: "incompatible",
    implementation_engine_status: "unavailable",
    missing_requirements: [
      "plugin.name",
      "plugin.version",
      "manifest.agents",
      "skills.poteto-mode",
      "agents.poteto-agent",
    ],
  });
  assert.deepEqual(Object.keys(baseline.metrics).sort(), requiredMetricNames);
  for (const metricName of requiredMetricNames) {
    assert.deepEqual(baseline.metrics[metricName], {
      sample_count: 0,
      value: null,
    });
  }

  const fixtureRoot = await makeFixture(context);
  const pluginRoot = path.join(fixtureRoot, "installed-port-observation");
  await writeInstalledPortLikePlugin(pluginRoot);
  assert.equal(
    await digestFile(
      path.join(pluginRoot, ".codex-plugin", "plugin.json"),
    ),
    installedManifestSha256,
  );
  assert.equal(baseline.plugin.manifest_sha256, installedManifestSha256);
  const replayResult = capture(committedContractPath, pluginRoot, {
    baseSha: baseline.base_sha,
    observedAt: baseline.observed_at,
  });
  const replayedBaseline = parseSuccessfulCapture(replayResult);
  assert.deepEqual(
    replayedBaseline,
    baseline,
    "the committed machine baseline must be reproducible from its public contract and observed port shape",
  );
  assert.equal(
    replayResult.stdout,
    baselineText,
    "replay must reproduce the committed canonical baseline bytes",
  );

  for (const requiredReportFact of [
    "pstack-plugin",
    "0.2.0",
    "incompatible",
    "unavailable",
    "manifest.agents",
    "skills.poteto-mode",
    "agents.poteto-agent",
    baseline.base_sha,
    baseline.observed_at,
    baseline.contract.sha256,
    baseline.plugin.manifest_sha256,
  ]) {
    assert.ok(
      report.includes(requiredReportFact),
      `the human report must include ${requiredReportFact}`,
    );
  }
  assert.match(
    report,
    /no Exoframe run history|no completed Exoframe runs/i,
  );
  assert.match(report, /sample_count[^\n]*0/i);
  assert.match(report, /value[^\n]*null/i);
  assert.match(
    report,
    /exact supported reference identity\/version[^\n]*pstack[^\n]*0\.14\.5/i,
  );
  assert.match(report, /risk[^\n]*R0[^\n]*R1[^\n]*R2[^\n]*R3/i);
  assert.match(
    report,
    /task-to-engineering-ready[^\n]*task-to-merge/i,
  );
  assert.match(
    report,
    /npm run --silent baseline:s0\.4 -- --contract docs\/baselines\/s0\.4-pstack-contract\.json/,
  );
  assert.match(
    report,
    /`--silent` suppresses npm's banner so stdout\s+equals the JSON artifact\./i,
  );
});
