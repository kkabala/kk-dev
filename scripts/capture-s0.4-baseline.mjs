import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const BASELINE_ID = "s0.4";
const METRIC_NAMES = [
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
];
const REQUIRED_OPTIONS = [
  "--contract",
  "--plugin-root",
  "--base-sha",
  "--observed-at",
];
const SUPPORTED_MANIFEST_DECLARATIONS = new Set([
  "agents",
  "apps",
  "hooks",
  "mcp",
  "skills",
]);

function parseOptions(arguments_) {
  const options = new Map();

  for (let index = 0; index < arguments_.length; index += 2) {
    const option = arguments_[index];
    const value = arguments_[index + 1];
    if (!REQUIRED_OPTIONS.includes(option) || value === undefined) {
      throw new Error(
        `usage: capture-s0.4-baseline ${REQUIRED_OPTIONS.join(" <value> ")} <value>`,
      );
    }
    if (options.has(option)) {
      throw new Error(`duplicate option: ${option}`);
    }
    options.set(option, value);
  }

  for (const option of REQUIRED_OPTIONS) {
    if (!options.has(option)) {
      throw new Error(`missing required option: ${option}`);
    }
  }

  return Object.fromEntries(
    REQUIRED_OPTIONS.map((option) => [option.slice(2), options.get(option)]),
  );
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`invalid ${label}`);
  }
}

function requireObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function requireStringArray(value, label) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== "string" || item.length === 0)
  ) {
    throw new Error(`${label} must be a non-empty string array`);
  }
  return value;
}

function validateContract(untrustedContract) {
  const contract = requireObject(untrustedContract, "contract");
  if (contract.schema_version !== 1) {
    throw new Error("contract.schema_version must be 1");
  }
  requireString(contract.contract_id, "contract.contract_id");
  requireString(contract.implementation_engine, "contract.implementation_engine");
  requireObject(contract.reference, "contract.reference");
  requireString(contract.reference.name, "contract.reference.name");
  requireString(contract.reference.version, "contract.reference.version");
  const mainEntrySkill = requireString(
    contract.reference.main_entry_skill,
    "contract.reference.main_entry_skill",
  );
  requireStringArray(
    contract.accepted_manifest_paths,
    "contract.accepted_manifest_paths",
  );
  const requiredManifestDeclarations = requireStringArray(
    contract.required_manifest_declarations,
    "contract.required_manifest_declarations",
  );
  const unknownDeclarations = requiredManifestDeclarations.filter(
    (declaration) => !SUPPORTED_MANIFEST_DECLARATIONS.has(declaration),
  );
  if (unknownDeclarations.length > 0) {
    throw new Error(
      "contract.required_manifest_declarations contains an unknown declaration; supported declarations are agents, apps, hooks, mcp, and skills",
    );
  }
  const requiredSkillIds = requireStringArray(
    contract.required_skill_ids,
    "contract.required_skill_ids",
  );
  if (!requiredSkillIds.includes(mainEntrySkill)) {
    throw new Error(
      "contract.reference.main_entry_skill must be included in contract.required_skill_ids",
    );
  }
  requireStringArray(contract.required_agent_ids, "contract.required_agent_ids");
  return contract;
}

function resolveDeclaredPath(pluginRoot, declaration, label) {
  const relativePath = requireString(declaration, label);
  if (path.isAbsolute(relativePath)) {
    throw new Error(`${label} must be relative to the explicit plugin root`);
  }

  const resolvedRoot = path.resolve(pluginRoot);
  const resolvedPath = path.resolve(resolvedRoot, relativePath);
  const rootPrefix = `${resolvedRoot}${path.sep}`;
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(rootPrefix)) {
    throw new Error(`${label} escapes the explicit plugin root`);
  }
  return resolvedPath;
}

function isWithinRoot(canonicalRoot, canonicalPath) {
  const relativePath = path.relative(canonicalRoot, canonicalPath);
  return (
    relativePath === "" ||
    (!path.isAbsolute(relativePath) &&
      relativePath !== ".." &&
      !relativePath.startsWith(`..${path.sep}`))
  );
}

async function canonicalizePluginRoot(pluginRoot) {
  const displayName = path.basename(path.resolve(pluginRoot));
  let canonicalRoot;
  try {
    canonicalRoot = await realpath(pluginRoot);
  } catch {
    throw new Error(`explicit plugin root "${displayName}" cannot be resolved`);
  }

  const rootStat = await stat(canonicalRoot).catch(() => undefined);
  if (!rootStat?.isDirectory()) {
    throw new Error(`explicit plugin root "${displayName}" is not a directory`);
  }
  return { canonicalRoot, displayName };
}

async function findManifest(
  canonicalRoot,
  pluginRootDisplayName,
  acceptedManifestPaths,
) {
  const matches = [];
  for (const manifestPath of acceptedManifestPaths) {
    const declaredPath = resolveDeclaredPath(
      canonicalRoot,
      manifestPath,
      "contract accepted manifest path",
    );
    let canonicalManifestPath;
    try {
      canonicalManifestPath = await realpath(declaredPath);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw new Error(`plugin manifest ${manifestPath} cannot be inspected`);
      }
      continue;
    }

    if (!isWithinRoot(canonicalRoot, canonicalManifestPath)) {
      throw new Error(
        `plugin manifest ${manifestPath} resolves outside the explicit plugin root`,
      );
    }
    const manifestStat = await stat(canonicalManifestPath).catch(() => undefined);
    if (!manifestStat?.isFile()) {
      throw new Error(`plugin manifest ${manifestPath} is not a regular file`);
    }
    try {
      const manifestBytes = await readFile(canonicalManifestPath);
      matches.push({ manifestBytes, manifestPath });
    } catch {
      throw new Error(`plugin manifest ${manifestPath} cannot be read`);
    }
  }

  if (matches.length === 0) {
    throw new Error(
      `plugin manifest not found in explicit plugin root "${pluginRootDisplayName}"`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `multiple accepted plugin manifests found in explicit plugin root "${pluginRootDisplayName}"`,
    );
  }
  return matches[0];
}

function declarationIsPresent(manifest, declarationName) {
  return (
    Object.hasOwn(manifest, declarationName) &&
    manifest[declarationName] !== null &&
    manifest[declarationName] !== false
  );
}

async function readDeclaredIds(canonicalRoot, manifest, declarationName) {
  if (!declarationIsPresent(manifest, declarationName)) {
    return [];
  }

  const declaredPath = resolveDeclaredPath(
    canonicalRoot,
    manifest[declarationName],
    `plugin manifest ${declarationName}`,
  );
  let declaredRoot;
  try {
    declaredRoot = await realpath(declaredPath);
  } catch {
    throw new Error(
      `plugin manifest ${declarationName} directory cannot be resolved`,
    );
  }
  if (!isWithinRoot(canonicalRoot, declaredRoot)) {
    throw new Error(
      `plugin manifest ${declarationName} resolves outside the explicit plugin root`,
    );
  }
  const declaredStat = await stat(declaredRoot).catch(() => undefined);
  if (!declaredStat?.isDirectory()) {
    throw new Error(`plugin manifest ${declarationName} is not a directory`);
  }

  let entries;
  try {
    entries = await readdir(declaredRoot, { withFileTypes: true });
  } catch {
    throw new Error(
      `plugin manifest ${declarationName} directory cannot be read`,
    );
  }

  const publicEntries = entries.filter((entry) => !entry.name.startsWith("."));
  if (declarationName === "skills") {
    const skillIds = [];
    for (const entry of publicEntries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const skillRoot = path.join(declaredRoot, entry.name);
      const [skillRootStat, skillFileStat] = await Promise.all([
        lstat(skillRoot).catch(() => undefined),
        lstat(path.join(skillRoot, "SKILL.md")).catch(() => undefined),
      ]);
      if (skillRootStat?.isDirectory() && skillFileStat?.isFile()) {
        skillIds.push(entry.name);
      }
    }
    return skillIds.sort();
  }
  return publicEntries
    .filter((entry) => entry.isFile() && path.extname(entry.name) === ".md")
    .map((entry) => entry.name.slice(0, -".md".length))
    .sort();
}

function readDeclarations(manifest) {
  return {
    agents: declarationIsPresent(manifest, "agents"),
    apps: declarationIsPresent(manifest, "apps"),
    hooks: declarationIsPresent(manifest, "hooks"),
    mcp:
      declarationIsPresent(manifest, "mcp") ||
      declarationIsPresent(manifest, "mcpServers") ||
      declarationIsPresent(manifest, "mcp_servers"),
    skills: declarationIsPresent(manifest, "skills"),
  };
}

function assessCompatibility(
  contract,
  pluginIdentity,
  declarations,
  skillIds,
  agentIds,
) {
  const missingIdentity = [];
  if (pluginIdentity.name !== contract.reference.name) {
    missingIdentity.push("plugin.name");
  }
  if (pluginIdentity.version !== contract.reference.version) {
    missingIdentity.push("plugin.version");
  }
  const missingDeclarations = contract.required_manifest_declarations
    .filter(
      (name) =>
        !Object.hasOwn(declarations, name) || declarations[name] !== true,
    )
    .map((name) => `manifest.${name}`);
  const missingSkills = contract.required_skill_ids
    .filter((skillId) => !skillIds.includes(skillId))
    .map((skillId) => `skills.${skillId}`);
  const missingAgents = contract.required_agent_ids
    .filter((agentId) => !agentIds.includes(agentId))
    .map((agentId) => `agents.${agentId}`);
  const missingRequirements = [
    ...missingIdentity,
    ...missingDeclarations,
    ...missingSkills,
    ...missingAgents,
  ];
  const compatible = missingRequirements.length === 0;

  return {
    status: compatible ? "compatible" : "incompatible",
    implementation_engine_status: compatible ? "available" : "unavailable",
    missing_requirements: missingRequirements,
  };
}

function emptyMetrics() {
  return Object.fromEntries(
    METRIC_NAMES.map((metricName) => [
      metricName,
      { sample_count: 0, value: null },
    ]),
  );
}

function validateObservation(baseSha, observedAt) {
  if (!/^[0-9a-f]{40}$/.test(baseSha)) {
    throw new Error("--base-sha must be a lowercase 40-character Git SHA");
  }
  const parsedObservedAt = new Date(observedAt);
  if (
    !Number.isFinite(parsedObservedAt.valueOf()) ||
    parsedObservedAt.toISOString() !== observedAt
  ) {
    throw new Error(
      "--observed-at must be a canonical UTC ISO-8601 timestamp",
    );
  }
}

async function capture(options) {
  validateObservation(options["base-sha"], options["observed-at"]);

  const contractBytes = await readFile(options.contract).catch(() => {
    throw new Error("contract cannot be read");
  });
  const contract = validateContract(parseJson(contractBytes, "contract JSON"));
  const pluginRoot = await canonicalizePluginRoot(options["plugin-root"]);
  const locatedManifest = await findManifest(
    pluginRoot.canonicalRoot,
    pluginRoot.displayName,
    contract.accepted_manifest_paths,
  );
  const manifest = requireObject(
    parseJson(
      locatedManifest.manifestBytes,
      `plugin manifest ${locatedManifest.manifestPath}`,
    ),
    `plugin manifest ${locatedManifest.manifestPath}`,
  );
  const pluginIdentity = {
    name: requireString(manifest.name, "plugin manifest name"),
    version: requireString(manifest.version, "plugin manifest version"),
  };
  const declarations = readDeclarations(manifest);
  const [skillIds, agentIds] = await Promise.all([
    readDeclaredIds(pluginRoot.canonicalRoot, manifest, "skills"),
    readDeclaredIds(pluginRoot.canonicalRoot, manifest, "agents"),
  ]);

  return {
    schema_version: 1,
    baseline_id: BASELINE_ID,
    observed_at: options["observed-at"],
    base_sha: options["base-sha"],
    contract: {
      id: contract.contract_id,
      sha256: createHash("sha256").update(contractBytes).digest("hex"),
    },
    plugin: {
      declarations,
      manifest_path: locatedManifest.manifestPath,
      manifest_sha256: createHash("sha256")
        .update(locatedManifest.manifestBytes)
        .digest("hex"),
      name: pluginIdentity.name,
      version: pluginIdentity.version,
      skill_ids: skillIds,
      agent_ids: agentIds,
    },
    compatibility: assessCompatibility(
      contract,
      pluginIdentity,
      declarations,
      skillIds,
      agentIds,
    ),
    metrics: emptyMetrics(),
  };
}

try {
  const baseline = await capture(parseOptions(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(baseline, null, 2)}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`S0.4 baseline capture failed: ${message}\n`);
  process.exitCode = 1;
}
