import { lstat, mkdir, readdir, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { PATH_CATEGORIES, RISK_TIERS } from "./surfaces.ts";
import type { PathRule, RiskTier, SurfaceRecord } from "./surfaces.ts";

export type DomainCriticality =
  | "financial"
  | "security"
  | "data_integrity"
  | "external_contract"
  | "operational"
  | "none";

export type DomainObservation = Readonly<{
  id: string;
  root_path: string;
  criticality: DomainCriticality;
  testability: Readonly<{
    unit: boolean;
    integration: boolean;
    e2e: boolean;
    weak: boolean;
  }>;
  risk_floor: RiskTier;
  reason: string;
}>;

export type SurfaceCatalog = Readonly<{
  schema_version: 1;
  path_rules: readonly PathRule[];
  surfaces: readonly SurfaceRecord[];
}>;

export type SurfaceBootstrapResult = Readonly<{
  schema_version: 1;
  checkout_root: string;
  domains: readonly DomainObservation[];
  catalog: SurfaceCatalog;
  yaml: string;
}>;

const skipDirectoryNames = new Set([
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
const preferredRoots = [
  "src",
  "app",
  "packages",
  "services",
  "lib",
  "database",
  "infra",
] as const;
const otherTopLevelSkip = new Set(["tests", "docs", "scripts"]);
const productionRootNames = ["src", "app", "lib", "packages", "services"] as const;
const financialTokens = [
  "payment",
  "deposit",
  "billing",
  "transaction",
  "ledger",
  "wallet",
] as const;
const securityTokens = ["auth", "token", "secret", "session", "oauth"] as const;
const dataIntegrityTokens = [
  "migration",
  "schema",
  "database",
  "persistence",
] as const;
const externalContractTokens = ["api", "graphql", "webhook", "contract"] as const;
const operationalTokens = ["deploy", "infra", "ci", "pipeline"] as const;
const surfaceIdPattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u;
const riskRank: Readonly<Record<string, number>> = Object.freeze({
  [RISK_TIERS.R0]: 0,
  [RISK_TIERS.R1]: 1,
  [RISK_TIERS.R2]: 2,
  [RISK_TIERS.R3]: 3,
});

function invalidInput(): never {
  throw new TypeError("Invalid risk-bootstrap input");
}

function compareUtf8(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function higherRisk(left: RiskTier, right: RiskTier): RiskTier {
  return (riskRank[left] ?? 0) >= (riskRank[right] ?? 0) ? left : right;
}

function shouldSkipName(name: string): boolean {
  return name.startsWith(".") || skipDirectoryNames.has(name);
}

function posixJoin(...segments: string[]): string {
  return segments.filter((segment) => segment.length > 0).join("/");
}

function domainIdFromRoot(rootPath: string): string {
  const id = rootPath.replaceAll("/", ".").replaceAll("_", "-").toLowerCase();
  if (!surfaceIdPattern.test(id)) {
    invalidInput();
  }
  return id;
}

function leafName(rootPath: string): string {
  const segments = rootPath.split("/");
  const leaf = segments[segments.length - 1];
  if (leaf === undefined || leaf.length === 0) {
    invalidInput();
  }
  return leaf;
}

function nameTokens(fileName: string): string[] {
  return fileName
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length > 0);
}

function segmentMatchesToken(segment: string, token: string): boolean {
  const lowered = segment.toLowerCase();
  if (token.length <= 3) {
    if (lowered === token || lowered === `${token}s`) {
      return true;
    }
    return lowered
      .split(/[-_.]/u)
      .some((part) => part === token || part === `${token}s`);
  }
  return lowered.includes(token);
}

function pathMatchesTokens(
  rootPath: string,
  tokens: readonly string[],
): boolean {
  const segments = rootPath.split("/");
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment === undefined) {
      continue;
    }
    for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
      const token = tokens[tokenIndex];
      if (token !== undefined && segmentMatchesToken(segment, token)) {
        return true;
      }
    }
  }
  return false;
}

function criticalityOf(rootPath: string): DomainCriticality {
  if (pathMatchesTokens(rootPath, financialTokens)) {
    return "financial";
  }
  if (pathMatchesTokens(rootPath, securityTokens)) {
    return "security";
  }
  if (pathMatchesTokens(rootPath, dataIntegrityTokens)) {
    return "data_integrity";
  }
  if (pathMatchesTokens(rootPath, externalContractTokens)) {
    return "external_contract";
  }
  if (pathMatchesTokens(rootPath, operationalTokens)) {
    return "operational";
  }
  return "none";
}

function inherentFloor(criticality: DomainCriticality): RiskTier {
  if (
    criticality === "financial" ||
    criticality === "security" ||
    criticality === "data_integrity"
  ) {
    return RISK_TIERS.R3;
  }
  if (criticality === "external_contract" || criticality === "operational") {
    return RISK_TIERS.R2;
  }
  return RISK_TIERS.R1;
}

function yamlQuote(value: string): string {
  return JSON.stringify(value);
}

function renderStringList(items: readonly string[], level: number): string[] {
  const indent = "  ".repeat(level);
  if (items.length === 0) {
    return [`${indent.slice(2)}[]`];
  }
  const lines: string[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item !== undefined) {
      lines.push(`${indent}- ${yamlQuote(item)}`);
    }
  }
  return lines;
}

export function renderSurfaceCatalogYaml(catalog: SurfaceCatalog): string {
  const lines: string[] = [
    "schema_version: 1",
    "path_rules:",
  ];
  for (let index = 0; index < catalog.path_rules.length; index += 1) {
    const rule = catalog.path_rules[index];
    if (rule === undefined) {
      continue;
    }
    lines.push(`  - category: ${yamlQuote(rule.category)}`);
    lines.push("    patterns:");
    lines.push(...renderStringList(rule.patterns, 3));
  }
  lines.push("surfaces:");
  for (let index = 0; index < catalog.surfaces.length; index += 1) {
    const surface = catalog.surfaces[index];
    if (surface === undefined) {
      continue;
    }
    lines.push("  - schema_version: 1");
    lines.push(`    id: ${yamlQuote(surface.id)}`);
    lines.push("    paths:");
    lines.push(...renderStringList(surface.paths, 3));
    lines.push(`    consumption: ${yamlQuote(surface.consumption)}`);
    lines.push(`    risk_floor: ${yamlQuote(surface.risk_floor)}`);
    lines.push(
      surface.exercises.length === 0
        ? "    exercises: []"
        : "    exercises:",
    );
    if (surface.exercises.length > 0) {
      lines.push(...renderStringList(surface.exercises, 3));
    }
    lines.push(
      surface.hypotheses.length === 0
        ? "    hypotheses: []"
        : "    hypotheses:",
    );
    if (surface.hypotheses.length > 0) {
      lines.push(...renderStringList(surface.hypotheses, 3));
    }
    lines.push(
      `    publishes_artifact: ${surface.publishes_artifact ? "true" : "false"}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

async function directoryExists(absolutePath: string): Promise<boolean> {
  const info = await stat(absolutePath).catch(() => undefined);
  return info !== undefined && info.isDirectory();
}

async function listDirectoryNames(absolutePath: string): Promise<string[]> {
  const entries = await readdir(absolutePath, { withFileTypes: true }).catch(
    () => undefined,
  );
  if (entries === undefined) {
    return [];
  }
  const names: string[] = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink() || !entry.isDirectory() || shouldSkipName(entry.name)) {
      continue;
    }
    names.push(entry.name);
  }
  names.sort(compareUtf8);
  return names;
}

async function collectDomainRoots(checkoutRoot: string): Promise<string[]> {
  const topLevel = await listDirectoryNames(checkoutRoot);
  const topSet = new Set(topLevel);
  const used = new Set<string>();
  const roots: string[] = [];
  for (let index = 0; index < preferredRoots.length; index += 1) {
    const preferred = preferredRoots[index];
    if (preferred === undefined || !topSet.has(preferred)) {
      continue;
    }
    used.add(preferred);
    const children = await listDirectoryNames(path.join(checkoutRoot, preferred));
    if (children.length === 0) {
      roots.push(preferred);
      continue;
    }
    for (let childIndex = 0; childIndex < children.length; childIndex += 1) {
      const child = children[childIndex];
      if (child !== undefined) {
        roots.push(posixJoin(preferred, child));
      }
    }
  }
  for (let index = 0; index < topLevel.length; index += 1) {
    const name = topLevel[index];
    if (
      name === undefined ||
      used.has(name) ||
      otherTopLevelSkip.has(name) ||
      shouldSkipName(name)
    ) {
      continue;
    }
    roots.push(name);
  }
  roots.sort(compareUtf8);
  return roots;
}

type TestSignals = {
  unit: boolean;
  integration: boolean;
  e2e: boolean;
};

function classifyFileName(fileName: string, signals: TestSignals): void {
  const lowered = fileName.toLowerCase();
  if (/\.test\./u.test(lowered) || /\.spec\./u.test(lowered)) {
    signals.unit = true;
  }
  const tokens = nameTokens(fileName);
  if (tokens.includes("integration")) {
    signals.integration = true;
  }
  if (
    tokens.includes("e2e") ||
    tokens.includes("acceptance") ||
    tokens.includes("cy") ||
    tokens.includes("cypress")
  ) {
    signals.e2e = true;
  }
}

async function scanTests(
  absolutePath: string,
  remainingDepth: number,
  signals: TestSignals,
): Promise<void> {
  if (remainingDepth < 0) {
    return;
  }
  const entries = await readdir(absolutePath, { withFileTypes: true }).catch(
    () => undefined,
  );
  if (entries === undefined) {
    return;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink() || shouldSkipName(entry.name)) {
      continue;
    }
    const childPath = path.join(absolutePath, entry.name);
    if (entry.isDirectory()) {
      await scanTests(childPath, remainingDepth - 1, signals);
      continue;
    }
    if (entry.isFile()) {
      classifyFileName(entry.name, signals);
    }
  }
}

async function testabilityOf(
  checkoutRoot: string,
  rootPath: string,
): Promise<DomainObservation["testability"]> {
  const signals: TestSignals = {
    unit: false,
    integration: false,
    e2e: false,
  };
  await scanTests(path.join(checkoutRoot, rootPath), 4, signals);
  const testsLeaf = path.join(checkoutRoot, "tests", leafName(rootPath));
  if (await directoryExists(testsLeaf)) {
    await scanTests(testsLeaf, 4, signals);
  }
  const weak = !signals.unit && !signals.integration && !signals.e2e;
  return Object.freeze({
    unit: signals.unit,
    integration: signals.integration,
    e2e: signals.e2e,
    weak,
  });
}

function floorFor(
  criticality: DomainCriticality,
  testability: DomainObservation["testability"],
): RiskTier {
  let floor = inherentFloor(criticality);
  if (
    testability.weak &&
    criticality !== "financial" &&
    criticality !== "security"
  ) {
    floor = higherRisk(floor, RISK_TIERS.R2);
  }
  return floor;
}

function reasonFor(
  rootPath: string,
  criticality: DomainCriticality,
  testability: DomainObservation["testability"],
  floor: RiskTier,
): string {
  const base =
    criticality === "none"
      ? `ordinary domain at ${rootPath}`
      : `${criticality} domain at ${rootPath}`;
  if (
    testability.weak &&
    criticality !== "financial" &&
    criticality !== "security" &&
    floor === RISK_TIERS.R2
  ) {
    return `${base}; weak tests`;
  }
  return base;
}

function toSurface(domain: DomainObservation): SurfaceRecord {
  return Object.freeze({
    schema_version: 1,
    id: domain.id,
    paths: Object.freeze([`${domain.root_path}/**`]),
    consumption: "unknown",
    risk_floor: domain.risk_floor,
    exercises: Object.freeze([]),
    hypotheses: Object.freeze([]),
    publishes_artifact: false,
  });
}

async function observeDomain(
  checkoutRoot: string,
  rootPath: string,
): Promise<DomainObservation> {
  const criticality = criticalityOf(rootPath);
  const testability = await testabilityOf(checkoutRoot, rootPath);
  const riskFloor = floorFor(criticality, testability);
  return Object.freeze({
    id: domainIdFromRoot(rootPath),
    root_path: rootPath,
    criticality,
    testability,
    risk_floor: riskFloor,
    reason: reasonFor(rootPath, criticality, testability, riskFloor),
  });
}

function buildPathRules(
  existingTopLevel: ReadonlySet<string>,
): readonly PathRule[] {
  const productionPatterns: string[] = [];
  for (let index = 0; index < productionRootNames.length; index += 1) {
    const name = productionRootNames[index];
    if (name === undefined) {
      continue;
    }
    if (name === "src" || existingTopLevel.has(name)) {
      productionPatterns.push(`${name}/**`);
    }
  }
  return Object.freeze([
    Object.freeze({
      category: PATH_CATEGORIES.CONTROL_PLANE,
      patterns: Object.freeze([".exoframe/**", ".github/workflows/**"]),
    }),
    Object.freeze({
      category: PATH_CATEGORIES.VERIFICATION,
      patterns: Object.freeze(["tests/**"]),
    }),
    Object.freeze({
      category: PATH_CATEGORIES.UNTRACKED_OK,
      patterns: Object.freeze(["*.md", "docs/**"]),
    }),
    Object.freeze({
      category: PATH_CATEGORIES.PRODUCTION,
      patterns: Object.freeze(productionPatterns),
    }),
  ]);
}

export async function bootstrapSurfaces(
  checkoutRoot: string,
): Promise<SurfaceBootstrapResult> {
  if (
    typeof checkoutRoot !== "string" ||
    checkoutRoot.length === 0 ||
    checkoutRoot.includes("\0")
  ) {
    invalidInput();
  }
  const rootStat = await lstat(checkoutRoot).catch(() => undefined);
  if (rootStat === undefined || !rootStat.isDirectory()) {
    invalidInput();
  }
  const resolvedRoot = await realpath(checkoutRoot);
  const topLevel = await listDirectoryNames(resolvedRoot);
  const topSet = new Set(topLevel);
  const domainRoots = await collectDomainRoots(resolvedRoot);
  const hasMigrations = await directoryExists(
    path.join(resolvedRoot, "database", "migrations"),
  );
  if (hasMigrations && !domainRoots.includes("database/migrations")) {
    domainRoots.push("database/migrations");
    domainRoots.sort(compareUtf8);
  }
  const domains: DomainObservation[] = [];
  const seenIds = new Set<string>();
  for (let index = 0; index < domainRoots.length; index += 1) {
    const rootPath = domainRoots[index];
    if (rootPath === undefined) {
      continue;
    }
    const domain = await observeDomain(resolvedRoot, rootPath);
    if (seenIds.has(domain.id)) {
      invalidInput();
    }
    seenIds.add(domain.id);
    domains.push(domain);
  }
  if (hasMigrations) {
    const existing = domains.find(
      (domain) => domain.root_path === "database/migrations",
    );
    if (existing === undefined) {
      const testability = await testabilityOf(
        resolvedRoot,
        "database/migrations",
      );
      const domain = Object.freeze({
        id: domainIdFromRoot("database/migrations"),
        root_path: "database/migrations",
        criticality: "data_integrity" as const,
        testability,
        risk_floor: RISK_TIERS.R3,
        reason: "persistent migrations",
      });
      if (seenIds.has(domain.id)) {
        invalidInput();
      }
      domains.push(domain);
    } else if ((riskRank[existing.risk_floor] ?? 0) < 3) {
      const index = domains.indexOf(existing);
      domains[index] = Object.freeze({
        ...existing,
        risk_floor: RISK_TIERS.R3,
        reason: "persistent migrations",
      });
    }
  }
  domains.sort((left, right) => compareUtf8(left.id, right.id));
  const surfaces = Object.freeze(domains.map(toSurface));
  const catalog = Object.freeze({
    schema_version: 1 as const,
    path_rules: buildPathRules(topSet),
    surfaces,
  });
  return Object.freeze({
    schema_version: 1,
    checkout_root: resolvedRoot,
    domains: Object.freeze(domains),
    catalog,
    yaml: renderSurfaceCatalogYaml(catalog),
  });
}

export async function writeBootstrapProposals(
  checkoutRoot: string,
  catalog: SurfaceCatalog,
  yaml: string,
): Promise<void> {
  if (
    typeof checkoutRoot !== "string" ||
    checkoutRoot.length === 0 ||
    checkoutRoot.includes("\0") ||
    typeof yaml !== "string"
  ) {
    invalidInput();
  }
  const proposalsDirectory = path.join(checkoutRoot, ".exoframe", "proposals");
  await mkdir(proposalsDirectory, { recursive: true });
  await writeFile(path.join(proposalsDirectory, "surfaces.yaml"), yaml);
  await writeFile(
    path.join(proposalsDirectory, "surfaces.json"),
    `${JSON.stringify(
      {
        schema_version: 1,
        surfaces: catalog.surfaces,
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    path.join(proposalsDirectory, "catalog.json"),
    `${JSON.stringify(catalog, null, 2)}\n`,
  );
}
