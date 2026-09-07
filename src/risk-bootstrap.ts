import { readdir, readFile, lstat } from "node:fs/promises";
import path from "node:path";

import { RISK_TIERS } from "./surfaces.ts";
import type { RiskTier } from "./surfaces.ts";

export type CriticalitySignal =
  | "financial"
  | "security"
  | "data_integrity"
  | "external_contract"
  | "operational"
  | "none";

export type TestabilityProfile = Readonly<{
  unit: boolean;
  integration: boolean;
  e2e: boolean;
  weak: boolean;
}>;

export type DomainObservation = Readonly<{
  id: string;
  root_path: string;
  criticality: CriticalitySignal;
  testability: TestabilityProfile;
  minimum_risk: RiskTier;
  reason: string;
}>;

export type RiskBootstrapFacts = Readonly<{
  schema_version: 1;
  checkout_root: string;
  domains: readonly DomainObservation[];
  discovery_notes: readonly string[];
}>;

export type PathRiskRule = Readonly<{
  pattern: string;
  minimum_risk: RiskTier;
  reason: string;
}>;

export type ProposedRiskPolicy = Readonly<{
  schema_version: 1;
  version: 1;
  risk_levels: Readonly<Record<string, { description: string }>>;
  paths: readonly PathRiskRule[];
  unknown_production_floor: RiskTier;
  trust_boundary_floor: RiskTier;
}>;

export type RiskBootstrapResult = Readonly<{
  schema_version: 1;
  facts: RiskBootstrapFacts;
  policy: ProposedRiskPolicy;
  yaml: string;
}>;

const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  "vendor",
  "__pycache__",
  ".cache",
]);

const FINANCIAL_TOKENS = Object.freeze([
  "payment",
  "payments",
  "deposit",
  "deposits",
  "withdrawal",
  "withdrawals",
  "transaction",
  "transactions",
  "billing",
  "invoice",
  "settlement",
  "ledger",
  "balance",
  "wallet",
  "trade",
  "trades",
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
  "session",
  "sessions",
  "oauth",
  "identity",
  "credential",
  "credentials",
]);

const DATA_TOKENS = Object.freeze([
  "migration",
  "migrations",
  "schema",
  "database",
  "db",
  "persistence",
  "repository",
  "orm",
]);

const API_TOKENS = Object.freeze([
  "api",
  "apis",
  "graphql",
  "grpc",
  "webhook",
  "webhooks",
  "contract",
  "contracts",
  "public",
]);

const OPS_TOKENS = Object.freeze([
  "deploy",
  "deployment",
  "infrastructure",
  "infra",
  "ci",
  "cd",
  "pipeline",
  "pipelines",
  "feature-flag",
  "feature_flag",
  "featureflag",
  "ops",
]);

const riskRank: Readonly<Record<string, number>> = Object.freeze({
  [RISK_TIERS.R0]: 0,
  [RISK_TIERS.R1]: 1,
  [RISK_TIERS.R2]: 2,
  [RISK_TIERS.R3]: 3,
});

function invalidInput(): never {
  throw new TypeError("Invalid risk-bootstrap input");
}

function higherRisk(left: RiskTier, right: RiskTier): RiskTier {
  return (riskRank[left] ?? 0) >= (riskRank[right] ?? 0) ? left : right;
}

function tokenize(segment: string): string[] {
  return segment
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim()
    .split(/\s+/u)
    .filter((token) => token.length > 0);
}

function pathTokens(relativePath: string): string[] {
  const parts = relativePath.split("/");
  const tokens: string[] = [];
  for (const part of parts) {
    for (const token of tokenize(part)) {
      tokens.push(token);
    }
  }
  return tokens;
}

function hasAnyToken(tokens: readonly string[], catalog: readonly string[]): boolean {
  const set = new Set(tokens);
  for (const item of catalog) {
    if (set.has(item)) {
      return true;
    }
  }
  return false;
}

function classifyCriticality(relativePath: string): CriticalitySignal {
  const tokens = pathTokens(relativePath);
  if (hasAnyToken(tokens, FINANCIAL_TOKENS)) {
    return "financial";
  }
  if (hasAnyToken(tokens, SECURITY_TOKENS)) {
    return "security";
  }
  if (hasAnyToken(tokens, DATA_TOKENS)) {
    return "data_integrity";
  }
  if (hasAnyToken(tokens, API_TOKENS)) {
    return "external_contract";
  }
  if (hasAnyToken(tokens, OPS_TOKENS)) {
    return "operational";
  }
  return "none";
}

function minimumForCriticality(signal: CriticalitySignal): RiskTier {
  if (signal === "financial" || signal === "security" || signal === "data_integrity") {
    return RISK_TIERS.R3;
  }
  if (signal === "external_contract" || signal === "operational") {
    return RISK_TIERS.R2;
  }
  return RISK_TIERS.R1;
}

function reasonForCriticality(signal: CriticalitySignal): string {
  if (signal === "financial") {
    return "Money movement or financial domain";
  }
  if (signal === "security") {
    return "Authentication, authorization, or secrets";
  }
  if (signal === "data_integrity") {
    return "Persistent data or schema modification";
  }
  if (signal === "external_contract") {
    return "External API or contract surface";
  }
  if (signal === "operational") {
    return "Deployment, infrastructure, or CI/CD";
  }
  return "Ordinary application surface";
}

function domainIdFromPath(relativePath: string): string {
  const cleaned = relativePath
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  if (cleaned.length === 0) {
    return "root";
  }
  return cleaned;
}

async function listImmediateDirectories(
  absoluteRoot: string,
): Promise<readonly string[]> {
  const entries = await readdir(absoluteRoot, { withFileTypes: true });
  const dirs: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      continue;
    }
    if (SKIP_DIR_NAMES.has(entry.name) || entry.name.startsWith(".")) {
      continue;
    }
    dirs.push(entry.name);
  }
  dirs.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  return Object.freeze(dirs);
}

async function directoryHasMatchingFiles(
  absoluteDir: string,
  predicate: (name: string) => boolean,
  depth: number,
): Promise<boolean> {
  if (depth < 0) {
    return false;
  }
  let entries;
  try {
    entries = await readdir(absoluteDir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      continue;
    }
    if (entry.isFile() && predicate(entry.name)) {
      return true;
    }
    if (
      entry.isDirectory() &&
      !SKIP_DIR_NAMES.has(entry.name) &&
      !entry.name.startsWith(".")
    ) {
      const nested = await directoryHasMatchingFiles(
        path.join(absoluteDir, entry.name),
        predicate,
        depth - 1,
      );
      if (nested) {
        return true;
      }
    }
  }
  return false;
}

function isUnitTestName(name: string): boolean {
  return (
    /\.test\.[cm]?[jt]sx?$/u.test(name) ||
    /\.spec\.[cm]?[jt]sx?$/u.test(name) ||
    name.endsWith("_test.go") ||
    name.endsWith("_test.py")
  );
}

function isIntegrationTestName(name: string): boolean {
  return /integration/iu.test(name) && isUnitTestName(name);
}

function isE2eTestName(name: string): boolean {
  return (
    /e2e|end-to-end|acceptance/iu.test(name) &&
    (isUnitTestName(name) ||
      name.endsWith(".feature") ||
      name.endsWith(".cy.ts") ||
      name.endsWith(".cy.js"))
  );
}

async function analyzeTestability(
  checkoutRoot: string,
  domainRoot: string,
): Promise<TestabilityProfile> {
  const absoluteDomain = path.join(checkoutRoot, domainRoot);
  const unit = await directoryHasMatchingFiles(absoluteDomain, isUnitTestName, 4);
  const integration = await directoryHasMatchingFiles(
    absoluteDomain,
    isIntegrationTestName,
    4,
  );
  const e2e = await directoryHasMatchingFiles(absoluteDomain, isE2eTestName, 4);

  const testsRoot = path.join(checkoutRoot, "tests");
  let mirroredUnit = false;
  let mirroredIntegration = false;
  let mirroredE2e = false;
  try {
    const testsMeta = await lstat(testsRoot);
    if (testsMeta.isDirectory() && !testsMeta.isSymbolicLink()) {
      const leaf = domainRoot.split("/").filter((part) => part.length > 0).at(-1);
      if (leaf !== undefined) {
        const mirrored = path.join(testsRoot, leaf);
        mirroredUnit = await directoryHasMatchingFiles(mirrored, isUnitTestName, 3);
        mirroredIntegration = await directoryHasMatchingFiles(
          mirrored,
          isIntegrationTestName,
          3,
        );
        mirroredE2e = await directoryHasMatchingFiles(mirrored, isE2eTestName, 3);
      }
    }
  } catch {
    // No tests directory is acceptable.
  }

  const hasUnit = unit || mirroredUnit;
  const hasIntegration = integration || mirroredIntegration;
  const hasE2e = e2e || mirroredE2e;
  return Object.freeze({
    unit: hasUnit,
    integration: hasIntegration,
    e2e: hasE2e,
    weak: !hasUnit && !hasIntegration && !hasE2e,
  });
}

function adjustRiskForTestability(
  base: RiskTier,
  testability: TestabilityProfile,
  criticality: CriticalitySignal,
): RiskTier {
  if (criticality === "financial" || criticality === "security") {
    return base;
  }
  if (testability.weak) {
    return higherRisk(base, RISK_TIERS.R2);
  }
  return base;
}

async function discoverCandidateRoots(
  checkoutRoot: string,
): Promise<readonly string[]> {
  const roots: string[] = [];
  const topLevel = await listImmediateDirectories(checkoutRoot);
  const preferred = ["src", "app", "packages", "services", "lib", "database", "infra"];
  for (const name of preferred) {
    if (topLevel.includes(name)) {
      const nested = await listImmediateDirectories(path.join(checkoutRoot, name));
      if (nested.length === 0) {
        roots.push(name);
      } else {
        for (const child of nested) {
          roots.push(`${name}/${child}`);
        }
      }
    }
  }
  for (const name of topLevel) {
    if (preferred.includes(name)) {
      continue;
    }
    if (name === "tests" || name === "docs" || name === "scripts") {
      continue;
    }
    roots.push(name);
  }
  if (roots.length === 0) {
    roots.push(".");
  }
  const unique = [...new Set(roots)];
  unique.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  return Object.freeze(unique);
}

/**
 * Deterministic repository discovery that produces structured facts for the
 * risk policy engine. This is the bootstrap layer described in suggestions.md:
 * semantic/path-based fact extraction feeds a deterministic policy assignment.
 * An LLM may later supply richer facts, but it cannot lower the resulting floors.
 */
export async function bootstrapRiskPolicy(
  checkoutRoot: string,
): Promise<RiskBootstrapResult> {
  if (typeof checkoutRoot !== "string" || checkoutRoot.length === 0) {
    invalidInput();
  }

  const notes: string[] = [];
  const candidates = await discoverCandidateRoots(checkoutRoot);
  notes.push(`Discovered ${candidates.length} candidate domain roots.`);

  const domains: DomainObservation[] = [];
  for (const relative of candidates) {
    const criticality = classifyCriticality(relative);
    const testability = await analyzeTestability(checkoutRoot, relative);
    const base = minimumForCriticality(criticality);
    const minimum_risk = adjustRiskForTestability(base, testability, criticality);
    domains.push(
      Object.freeze({
        id: domainIdFromPath(relative),
        root_path: relative === "." ? "." : relative,
        criticality,
        testability,
        minimum_risk,
        reason: reasonForCriticality(criticality),
      }),
    );
  }

  domains.sort((left, right) => {
    if (left.root_path < right.root_path) {
      return -1;
    }
    if (left.root_path > right.root_path) {
      return 1;
    }
    return 0;
  });

  const pathRules: PathRiskRule[] = domains.map((domain) =>
    Object.freeze({
      pattern: domain.root_path === "." ? "**" : `${domain.root_path}/**`,
      minimum_risk: domain.minimum_risk,
      reason: domain.reason,
    }),
  );

  pathRules.push(
    Object.freeze({
      pattern: ".exoframe/**",
      minimum_risk: RISK_TIERS.R3,
      reason: "Exoframe control plane",
    }),
    Object.freeze({
      pattern: ".github/workflows/**",
      minimum_risk: RISK_TIERS.R3,
      reason: "CI/CD control plane",
    }),
    Object.freeze({
      pattern: "database/migrations/**",
      minimum_risk: RISK_TIERS.R3,
      reason: "Persistent data modification",
    }),
  );

  pathRules.sort((left, right) => {
    if (left.pattern < right.pattern) {
      return -1;
    }
    if (left.pattern > right.pattern) {
      return 1;
    }
    return 0;
  });

  const policy: ProposedRiskPolicy = Object.freeze({
    schema_version: 1,
    version: 1,
    risk_levels: Object.freeze({
      R0: Object.freeze({ description: "trivial" }),
      R1: Object.freeze({ description: "low" }),
      R2: Object.freeze({ description: "moderate" }),
      R3: Object.freeze({ description: "high / critical" }),
    }),
    paths: Object.freeze(pathRules),
    unknown_production_floor: RISK_TIERS.R2,
    trust_boundary_floor: RISK_TIERS.R3,
  });

  const facts: RiskBootstrapFacts = Object.freeze({
    schema_version: 1,
    checkout_root: checkoutRoot,
    domains: Object.freeze(domains),
    discovery_notes: Object.freeze(notes),
  });

  return Object.freeze({
    schema_version: 1,
    facts,
    policy,
    yaml: renderRiskPolicyYaml(policy),
  });
}

function yamlEscape(value: string): string {
  if (/^[A-Za-z0-9_./\*-]+$/u.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}

export function renderRiskPolicyYaml(policy: ProposedRiskPolicy): string {
  const lines: string[] = [];
  lines.push("version: 1");
  lines.push("");
  lines.push("risk_levels:");
  for (const [tier, meta] of Object.entries(policy.risk_levels)) {
    lines.push(`  ${tier}:`);
    lines.push(`    description: ${yamlEscape(meta.description)}`);
  }
  lines.push("");
  lines.push("unknown_production_floor: " + policy.unknown_production_floor);
  lines.push("trust_boundary_floor: " + policy.trust_boundary_floor);
  lines.push("");
  lines.push("paths:");
  for (const rule of policy.paths) {
    lines.push(`  ${yamlEscape(rule.pattern)}:`);
    lines.push(`    minimum_risk: ${rule.minimum_risk}`);
    lines.push(`    reason: ${yamlEscape(rule.reason)}`);
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * Resolve the effective minimum risk for a path under a proposed bootstrap
 * policy. Used by the deterministic policy engine; AI fact extraction cannot
 * lower this floor.
 */
export function resolvePathMinimumRisk(
  policy: ProposedRiskPolicy,
  filePath: string,
): RiskTier {
  if (typeof filePath !== "string" || filePath.length === 0) {
    invalidInput();
  }
  let floor: RiskTier = policy.unknown_production_floor;
  for (const rule of policy.paths) {
    if (matchesSimpleGlob(rule.pattern, filePath)) {
      floor = higherRisk(floor, rule.minimum_risk);
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

export async function readPackageHint(
  checkoutRoot: string,
): Promise<string | null> {
  try {
    const packagePath = path.join(checkoutRoot, "package.json");
    const metadata = await lstat(packagePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      return null;
    }
    const raw = await readFile(packagePath, "utf8");
    const parsed = JSON.parse(raw) as { name?: unknown; description?: unknown };
    const name = typeof parsed.name === "string" ? parsed.name : "";
    const description =
      typeof parsed.description === "string" ? parsed.description : "";
    if (name.length === 0 && description.length === 0) {
      return null;
    }
    return `${name} ${description}`.trim();
  } catch {
    return null;
  }
}
