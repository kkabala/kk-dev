import { lstat, readdir, realpath } from "node:fs/promises";
import path from "node:path";

import { RISK_TIERS } from "./surfaces.ts";
import type { RiskTier } from "./surfaces.ts";

export type CriticalityDomain =
  | "financial"
  | "security"
  | "data_integrity"
  | "external_contract"
  | "operational"
  | "application"
  | "unknown";

export type TestPresence = "yes" | "partial" | "no" | "unknown";

export type DomainDiscovery = Readonly<{
  name: string;
  path_prefix: string;
  domain: CriticalityDomain;
  minimum_risk: RiskTier;
  reason: string;
  unit_tests: TestPresence;
  integration_tests: TestPresence;
  signals: readonly string[];
}>;

export type RiskBootstrapProposal = Readonly<{
  schema_version: 1;
  checkout_root: string;
  domains: readonly DomainDiscovery[];
  path_policies: readonly PathPolicyEntry[];
  policy_yaml: string;
  summary: string;
}>;

export type PathPolicyEntry = Readonly<{
  pattern: string;
  minimum_risk: RiskTier;
  reason: string;
}>;

const CODE_ROOTS = Object.freeze([
  "src",
  "lib",
  "app",
  "packages",
  "services",
  "server",
  "backend",
  "frontend",
]);

const SKIP_DIR_NAMES = Object.freeze(
  new Set([
    ".git",
    ".exoframe",
    "node_modules",
    "dist",
    "build",
    "coverage",
    ".next",
    "vendor",
    "__pycache__",
  ]),
);

const FINANCIAL_TOKENS = Object.freeze([
  "payment",
  "payments",
  "deposit",
  "deposits",
  "withdraw",
  "withdrawal",
  "transaction",
  "transactions",
  "billing",
  "invoice",
  "ledger",
  "balance",
  "settlement",
  "trade",
  "trades",
  "money",
  "wallet",
  "fee",
  "fees",
]);

const SECURITY_TOKENS = Object.freeze([
  "auth",
  "authentication",
  "authorization",
  "permission",
  "permissions",
  "role",
  "roles",
  "token",
  "tokens",
  "secret",
  "secrets",
  "oauth",
  "session",
  "sessions",
  "identity",
  "iam",
  "acl",
  "rbac",
]);

const DATA_TOKENS = Object.freeze([
  "migration",
  "migrations",
  "database",
  "db",
  "schema",
  "persistence",
  "repository",
  "repositories",
  "storage",
  "datastore",
]);

const API_TOKENS = Object.freeze([
  "api",
  "apis",
  "graphql",
  "grpc",
  "openapi",
  "contract",
  "contracts",
  "sdk",
  "public",
  "webhook",
  "webhooks",
]);

const OPS_TOKENS = Object.freeze([
  "infra",
  "infrastructure",
  "deploy",
  "deployment",
  "ci",
  "cd",
  "ops",
  "operations",
  "k8s",
  "kubernetes",
  "terraform",
  "helm",
  "pipeline",
  "pipelines",
  "feature-flag",
  "feature_flag",
  "featureflags",
]);

const riskRank: Readonly<Record<string, number>> = Object.freeze({
  [RISK_TIERS.R0]: 0,
  [RISK_TIERS.R1]: 1,
  [RISK_TIERS.R2]: 2,
  [RISK_TIERS.R3]: 3,
});

function higherRisk(left: RiskTier, right: RiskTier): RiskTier {
  return (riskRank[left] ?? 0) >= (riskRank[right] ?? 0) ? left : right;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

function isMissing(error: unknown): boolean {
  return hasErrorCode(error, "ENOENT");
}

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, "");
}

function tokenMatches(name: string, catalog: readonly string[]): boolean {
  const normalized = normalizeToken(name);
  for (let index = 0; index < catalog.length; index += 1) {
    const token = catalog[index];
    if (token === undefined) {
      continue;
    }
    const needle = normalizeToken(token);
    if (normalized === needle || normalized.includes(needle)) {
      return true;
    }
  }
  return false;
}

function classifyDomain(name: string): {
  domain: CriticalityDomain;
  minimum_risk: RiskTier;
  reason: string;
  signals: string[];
} {
  const signals: string[] = [];
  if (tokenMatches(name, FINANCIAL_TOKENS)) {
    signals.push("financial");
    return {
      domain: "financial",
      minimum_risk: RISK_TIERS.R3,
      reason: "Money movement or financial domain signals",
      signals,
    };
  }
  if (tokenMatches(name, SECURITY_TOKENS)) {
    signals.push("security");
    return {
      domain: "security",
      minimum_risk: RISK_TIERS.R3,
      reason: "Authentication / authorization / secrets signals",
      signals,
    };
  }
  if (tokenMatches(name, DATA_TOKENS)) {
    signals.push("data_integrity");
    return {
      domain: "data_integrity",
      minimum_risk: RISK_TIERS.R3,
      reason: "Persistence / migration / schema signals",
      signals,
    };
  }
  if (tokenMatches(name, API_TOKENS)) {
    signals.push("external_contract");
    return {
      domain: "external_contract",
      minimum_risk: RISK_TIERS.R2,
      reason: "External contract / public API signals",
      signals,
    };
  }
  if (tokenMatches(name, OPS_TOKENS)) {
    signals.push("operational");
    return {
      domain: "operational",
      minimum_risk: RISK_TIERS.R3,
      reason: "Infrastructure / CI/CD / operational signals",
      signals,
    };
  }
  return {
    domain: "application",
    minimum_risk: RISK_TIERS.R1,
    reason: "Default application feature surface",
    signals: Object.freeze(["application"]) as string[],
  };
}

async function isDirectory(candidate: string): Promise<boolean> {
  try {
    const metadata = await lstat(candidate);
    return metadata.isDirectory() && !metadata.isSymbolicLink();
  } catch (error) {
    if (isMissing(error)) {
      return false;
    }
    throw error;
  }
}

async function listImmediateChildren(
  directory: string,
): Promise<readonly string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const names: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        continue;
      }
      if (SKIP_DIR_NAMES.has(entry.name) || entry.name.startsWith(".")) {
        continue;
      }
      names.push(entry.name);
    }
    names.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
    return Object.freeze(names);
  } catch (error) {
    if (isMissing(error)) {
      return Object.freeze([]);
    }
    throw error;
  }
}

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await lstat(candidate);
    return true;
  } catch (error) {
    if (isMissing(error)) {
      return false;
    }
    throw error;
  }
}

async function detectTestPresence(
  checkoutRoot: string,
  pathPrefix: string,
): Promise<{ unit: TestPresence; integration: TestPresence }> {
  const relative = pathPrefix.replace(/\/\*\*$/u, "");
  const unitCandidates = [
    path.join(checkoutRoot, "tests", relative),
    path.join(checkoutRoot, "test", relative),
    path.join(checkoutRoot, relative, "__tests__"),
  ];
  let unit: TestPresence = "no";
  for (const candidate of unitCandidates) {
    if (await pathExists(candidate)) {
      unit = "yes";
      break;
    }
  }
  const integrationCandidates = [
    path.join(checkoutRoot, "tests", "integration"),
    path.join(checkoutRoot, "test", "integration"),
    path.join(checkoutRoot, "e2e"),
    path.join(checkoutRoot, "tests", "e2e"),
  ];
  let integration: TestPresence = "no";
  for (const candidate of integrationCandidates) {
    if (await pathExists(candidate)) {
      integration = "partial";
      break;
    }
  }
  return { unit, integration };
}

async function discoverCodeDomains(
  checkoutRoot: string,
): Promise<DomainDiscovery[]> {
  const domains: DomainDiscovery[] = [];
  const seenPrefixes = new Set<string>();

  for (const root of CODE_ROOTS) {
    const absoluteRoot = path.join(checkoutRoot, root);
    if (!(await isDirectory(absoluteRoot))) {
      continue;
    }
    const children = await listImmediateChildren(absoluteRoot);
    if (children.length === 0) {
      const classified = classifyDomain(root);
      const prefix = `${root}/**`;
      if (!seenPrefixes.has(prefix)) {
        seenPrefixes.add(prefix);
        const tests = await detectTestPresence(checkoutRoot, root);
        domains.push(
          Object.freeze({
            name: root,
            path_prefix: prefix,
            domain: classified.domain,
            minimum_risk: classified.minimum_risk,
            reason: classified.reason,
            unit_tests: tests.unit,
            integration_tests: tests.integration,
            signals: Object.freeze(classified.signals),
          }),
        );
      }
      continue;
    }
    for (const child of children) {
      const classified = classifyDomain(child);
      const prefix = `${root}/${child}/**`;
      if (seenPrefixes.has(prefix)) {
        continue;
      }
      seenPrefixes.add(prefix);
      const tests = await detectTestPresence(checkoutRoot, `${root}/${child}`);
      domains.push(
        Object.freeze({
          name: child,
          path_prefix: prefix,
          domain: classified.domain,
          minimum_risk: classified.minimum_risk,
          reason: classified.reason,
          unit_tests: tests.unit,
          integration_tests: tests.integration,
          signals: Object.freeze(classified.signals),
        }),
      );
    }
  }

  // Well-known non-src critical paths
  const wellKnown: readonly { name: string; prefix: string }[] = [
    { name: "migrations", prefix: "database/migrations/**" },
    { name: "migrations", prefix: "migrations/**" },
    { name: "infra", prefix: "infrastructure/**" },
    { name: "infra", prefix: "infra/**" },
    { name: "workflows", prefix: ".github/workflows/**" },
    { name: "exoframe-control", prefix: ".exoframe/**" },
  ];
  for (const item of wellKnown) {
    const absolute = path.join(
      checkoutRoot,
      item.prefix.replace(/\/\*\*$/u, ""),
    );
    if (!(await pathExists(absolute))) {
      continue;
    }
    if (seenPrefixes.has(item.prefix)) {
      continue;
    }
    seenPrefixes.add(item.prefix);
    const classified = classifyDomain(item.name);
    const tests = await detectTestPresence(
      checkoutRoot,
      item.prefix.replace(/\/\*\*$/u, ""),
    );
    domains.push(
      Object.freeze({
        name: item.name,
        path_prefix: item.prefix,
        domain: classified.domain,
        minimum_risk: higherRisk(classified.minimum_risk, RISK_TIERS.R3),
        reason: classified.reason,
        unit_tests: tests.unit,
        integration_tests: tests.integration,
        signals: Object.freeze(classified.signals),
      }),
    );
  }

  domains.sort((left, right) => {
    if (left.path_prefix < right.path_prefix) {
      return -1;
    }
    if (left.path_prefix > right.path_prefix) {
      return 1;
    }
    return 0;
  });
  return domains;
}

function buildPathPolicies(
  domains: readonly DomainDiscovery[],
): PathPolicyEntry[] {
  const entries: PathPolicyEntry[] = domains.map((domain) =>
    Object.freeze({
      pattern: domain.path_prefix,
      minimum_risk: domain.minimum_risk,
      reason: domain.reason,
    }),
  );
  // Stable documentation / untracked defaults
  entries.push(
    Object.freeze({
      pattern: "*.md",
      minimum_risk: RISK_TIERS.R0,
      reason: "Documentation and prose",
    }),
  );
  entries.push(
    Object.freeze({
      pattern: "docs/**",
      minimum_risk: RISK_TIERS.R0,
      reason: "Documentation tree",
    }),
  );
  entries.sort((left, right) => {
    if (left.pattern < right.pattern) {
      return -1;
    }
    if (left.pattern > right.pattern) {
      return 1;
    }
    return 0;
  });
  return entries;
}

function yamlEscape(value: string): string {
  if (/^[A-Za-z0-9_./\-*]+$/u.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}

function renderPolicyYaml(
  pathPolicies: readonly PathPolicyEntry[],
): string {
  const lines: string[] = [
    "# Generated by exoframe risk-bootstrap (suggestions.md Init Risk Skill).",
    "# Human review required before treating this as authoritative policy.",
    "# AI agents must not lower minimum_risk below these floors.",
    "version: 1",
    "",
    "risk_levels:",
    "  R0:",
    "    description: trivial",
    "  R1:",
    "    description: low",
    "  R2:",
    "    description: moderate",
    "  R3:",
    "    description: high / critical (repository maximum in Exoframe MVP)",
    "",
    "paths:",
  ];
  for (const entry of pathPolicies) {
    lines.push(`  ${yamlEscape(entry.pattern)}:`);
    lines.push(`    minimum_risk: ${entry.minimum_risk}`);
    lines.push(`    reason: ${yamlEscape(entry.reason)}`);
  }
  lines.push("");
  return lines.join("\n");
}

function renderSummary(domains: readonly DomainDiscovery[]): string {
  const lines: string[] = [
    `Detected ${domains.length} domains.`,
    "",
    "Suggested minimum risk:",
    "",
  ];
  for (const domain of domains) {
    lines.push(
      `${domain.name.padEnd(24)} ${domain.minimum_risk}  (${domain.domain}; unit=${domain.unit_tests}; integration=${domain.integration_tests})`,
    );
  }
  lines.push("");
  lines.push(
    "Review and commit .pstack-risk.yml. Agents cannot lower these floors.",
  );
  return lines.join("\n");
}

/**
 * Scan a repository and propose a version-controlled risk policy.
 *
 * Hybrid design (suggestions.md):
 * - This function performs deterministic discovery / fact extraction.
 * - The resulting path minimums are hard floors for classifyRisk.
 * - Future LLM fact extraction may feed structured DomainDiscovery inputs,
 *   but must not bypass the committed policy floors.
 */
export async function bootstrapRiskPolicy(
  checkoutRoot: string,
): Promise<RiskBootstrapProposal> {
  if (typeof checkoutRoot !== "string" || checkoutRoot.length === 0) {
    throw new TypeError("Invalid checkout root");
  }
  const resolvedRoot = await realpath(checkoutRoot);
  const rootMetadata = await lstat(resolvedRoot);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new TypeError("Invalid checkout root");
  }

  const domains = Object.freeze(await discoverCodeDomains(resolvedRoot));
  const pathPolicies = Object.freeze(buildPathPolicies(domains));
  const policyYaml = renderPolicyYaml(pathPolicies);
  const summary = renderSummary(domains);

  return Object.freeze({
    schema_version: 1 as const,
    checkout_root: resolvedRoot,
    domains,
    path_policies: pathPolicies,
    policy_yaml: policyYaml,
    summary,
  });
}

/**
 * Apply a discovered path minimum when scoring pre-work risk.
 * Agents may escalate above the floor; they cannot reduce below it.
 */
export function applyPathMinimum(
  computed: RiskTier,
  pathFloor: RiskTier | null,
): RiskTier {
  if (pathFloor === null) {
    return computed;
  }
  return higherRisk(computed, pathFloor);
}

export function findPathMinimum(
  filePath: string,
  policies: readonly PathPolicyEntry[],
): RiskTier | null {
  let floor: RiskTier | null = null;
  for (let index = 0; index < policies.length; index += 1) {
    const entry = policies[index];
    if (entry === undefined) {
      continue;
    }
    if (matchesSimpleGlob(entry.pattern, filePath)) {
      floor = floor === null ? entry.minimum_risk : higherRisk(floor, entry.minimum_risk);
    }
  }
  return floor;
}

function matchesSimpleGlob(pattern: string, filePath: string): boolean {
  const body = pattern
    .split("/")
    .map((segment) => {
      if (segment === "**") {
        return ".*";
      }
      return segment
        .replace(/[.+^${}()|[\]\\]/gu, "\\$&")
        .replace(/\*/gu, "[^/]*");
    })
    .join("/");
  return new RegExp(`^${body}$`, "u").test(filePath);
}
