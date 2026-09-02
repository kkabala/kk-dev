import { createHash } from "node:crypto";

declare const pathCategoryBrand: unique symbol;
declare const riskTierBrand: unique symbol;

type BrandedPathCategory<Value extends string> = Value &
  Readonly<{
    [pathCategoryBrand]: "PathCategory";
  }>;

type BrandedRiskTier<Value extends string> = Value &
  Readonly<{
    [riskTierBrand]: "RiskTier";
  }>;

const PATH_CATEGORY_VALUES = {
  PRODUCTION: "production",
  VERIFICATION: "verification",
  CONTROL_PLANE: "control_plane",
  UNTRACKED_OK: "untracked_ok",
} as const;

const RISK_TIER_VALUES = {
  R0: "R0",
  R1: "R1",
  R2: "R2",
  R3: "R3",
} as const;

type PathCategoryCatalog = {
  readonly [Name in keyof typeof PATH_CATEGORY_VALUES]: BrandedPathCategory<
    (typeof PATH_CATEGORY_VALUES)[Name]
  >;
};

type RiskTierCatalog = {
  readonly [Name in keyof typeof RISK_TIER_VALUES]: BrandedRiskTier<
    (typeof RISK_TIER_VALUES)[Name]
  >;
};

export const PATH_CATEGORIES = Object.freeze(
  PATH_CATEGORY_VALUES,
) as PathCategoryCatalog;
export const RISK_TIERS = Object.freeze(RISK_TIER_VALUES) as RiskTierCatalog;

export type PathCategory =
  (typeof PATH_CATEGORIES)[keyof typeof PATH_CATEGORIES];
export type RiskTier = (typeof RISK_TIERS)[keyof typeof RISK_TIERS];

export type PathRule = Readonly<{
  category: PathCategory;
  patterns: readonly string[];
}>;

export type SurfaceRecord = Readonly<{
  schema_version: 1;
  id: string;
  paths: readonly string[];
  consumption: string;
  risk_floor: RiskTier;
  exercises: readonly string[];
  hypotheses: readonly string[];
  publishes_artifact: boolean;
}>;

export type MatchedSurface = Readonly<{
  schema_version: 1;
  id: string;
  kind: "declared" | "provisional";
  paths: readonly string[];
  consumption: string;
  risk_floor: RiskTier;
  exercises: readonly string[];
  hypotheses: readonly string[];
  publishes_artifact: boolean;
}>;

export type PathClassification = Readonly<{
  path: string;
  category: PathCategory;
}>;

export type SurfaceDecision = Readonly<{
  schema_version: 1;
  classifications: readonly PathClassification[];
  surfaces: readonly MatchedSurface[];
  policy_weakening: boolean;
}>;

const inputKeys = ["base_policy", "diff", "proposal"] as const;
const policyKeys = ["schema_version", "path_rules", "surfaces"] as const;
const diffKeys = ["paths"] as const;
const proposalKeys = ["schema_version", "surfaces"] as const;
const ruleKeys = ["category", "patterns"] as const;
const surfaceKeys = [
  "schema_version",
  "id",
  "paths",
  "consumption",
  "risk_floor",
  "exercises",
  "hypotheses",
  "publishes_artifact",
] as const;

const knownCategories = new Set<unknown>(Object.values(PATH_CATEGORIES));
const knownRiskTiers = new Set<unknown>(Object.values(RISK_TIERS));
const riskRank: Readonly<Record<string, number>> = Object.freeze({
  [RISK_TIERS.R0]: 0,
  [RISK_TIERS.R1]: 1,
  [RISK_TIERS.R2]: 2,
  [RISK_TIERS.R3]: 3,
});
const surfaceIdPattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u;

function invalidInput(): never {
  throw new TypeError("Invalid surface input");
}

function getOwnDataProperty(object: object, key: PropertyKey): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (descriptor === undefined || !("value" in descriptor)) {
    invalidInput();
  }
  return descriptor.value;
}

function ownKeyNames(value: object): string[] {
  return Reflect.ownKeys(value).map((key) => {
    if (typeof key !== "string") {
      invalidInput();
    }
    return key;
  });
}

function isPlainObject(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactKeys(value: object, expected: readonly string[]): void {
  const keys = ownKeyNames(value);
  const expectedKeys = new Set(expected);
  if (
    keys.length !== expected.length ||
    keys.some((key) => !expectedKeys.has(key)) ||
    expected.some((key) => !keys.includes(key))
  ) {
    invalidInput();
  }
}

function captureDenseList<Item>(
  value: unknown,
  readItem: (item: unknown) => Item,
): Item[] {
  if (!Array.isArray(value)) {
    invalidInput();
  }
  const length = getOwnDataProperty(value, "length");
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) {
    invalidInput();
  }
  const captured: Item[] = [];
  for (let index = 0; index < length; index += 1) {
    captured[index] = readItem(getOwnDataProperty(value, index));
  }
  return captured;
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

function parseRequiredString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    invalidInput();
  }
  return value;
}

function parseRelativePath(value: unknown): string {
  const token = parseRequiredString(value);
  if (token.startsWith("/") || token.includes("\\")) {
    invalidInput();
  }
  const segments = token.split("/");
  if (
    segments.length === 0 ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    invalidInput();
  }
  return token;
}

function parseGlobPattern(value: unknown): string {
  const token = parseRequiredString(value);
  if (token.startsWith("/") || token.includes("\\")) {
    invalidInput();
  }
  const segments = token.split("/");
  if (
    segments.length === 0 ||
    segments.some(
      (segment) =>
        segment === "" ||
        segment === "." ||
        segment === ".." ||
        (segment.includes("**") && segment !== "**"),
    )
  ) {
    invalidInput();
  }
  return token;
}

function globToRegExp(pattern: string): RegExp {
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
  return new RegExp(`^${body}$`, "u");
}

function matchesGlob(pattern: string, filePath: string): boolean {
  return globToRegExp(pattern).test(filePath);
}

function parseCategory(value: unknown): PathCategory {
  if (!knownCategories.has(value)) {
    invalidInput();
  }
  return value as PathCategory;
}

function parseRiskTier(value: unknown): RiskTier {
  if (!knownRiskTiers.has(value)) {
    invalidInput();
  }
  return value as RiskTier;
}

function parseSurfaceId(value: unknown): string {
  if (typeof value !== "string" || !surfaceIdPattern.test(value)) {
    invalidInput();
  }
  return value;
}

function parseStringList(
  value: unknown,
  readItem: (item: unknown) => string,
): readonly string[] {
  const captured = captureDenseList(value, readItem);
  const seen = new Set<string>();
  for (let index = 0; index < captured.length; index += 1) {
    const item = captured[index];
    if (item === undefined || seen.has(item)) {
      invalidInput();
    }
    seen.add(item);
  }
  return Object.freeze(captured);
}

function parsePathRule(value: unknown): PathRule {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, ruleKeys);
  return Object.freeze({
    category: parseCategory(getOwnDataProperty(value, "category")),
    patterns: parseStringList(getOwnDataProperty(value, "patterns"), parseGlobPattern),
  });
}

function parseSurface(value: unknown): SurfaceRecord {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, surfaceKeys);
  const schemaVersion = getOwnDataProperty(value, "schema_version");
  const publishes = getOwnDataProperty(value, "publishes_artifact");
  if (schemaVersion !== 1 || typeof publishes !== "boolean") {
    invalidInput();
  }
  return Object.freeze({
    schema_version: 1,
    id: parseSurfaceId(getOwnDataProperty(value, "id")),
    paths: parseStringList(getOwnDataProperty(value, "paths"), parseGlobPattern),
    consumption: parseRequiredString(getOwnDataProperty(value, "consumption")),
    risk_floor: parseRiskTier(getOwnDataProperty(value, "risk_floor")),
    exercises: parseStringList(
      getOwnDataProperty(value, "exercises"),
      parseSurfaceId,
    ),
    hypotheses: parseStringList(
      getOwnDataProperty(value, "hypotheses"),
      parseSurfaceId,
    ),
    publishes_artifact: publishes,
  });
}

function parsePolicy(value: unknown): {
  path_rules: readonly PathRule[];
  surfaces: readonly SurfaceRecord[];
} {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, policyKeys);
  if (getOwnDataProperty(value, "schema_version") !== 1) {
    invalidInput();
  }
  const surfaces = captureDenseList(
    getOwnDataProperty(value, "surfaces"),
    parseSurface,
  );
  const seen = new Set<string>();
  for (let index = 0; index < surfaces.length; index += 1) {
    const surface = surfaces[index];
    if (surface === undefined || seen.has(surface.id)) {
      invalidInput();
    }
    seen.add(surface.id);
  }
  return {
    path_rules: Object.freeze(
      captureDenseList(getOwnDataProperty(value, "path_rules"), parsePathRule),
    ),
    surfaces: Object.freeze(surfaces),
  };
}

function parseDiff(value: unknown): readonly string[] {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, diffKeys);
  return parseStringList(getOwnDataProperty(value, "paths"), parseRelativePath);
}

function parseProposal(value: unknown): readonly SurfaceRecord[] | null {
  if (value === null) {
    return null;
  }
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, proposalKeys);
  if (getOwnDataProperty(value, "schema_version") !== 1) {
    invalidInput();
  }
  const surfaces = captureDenseList(
    getOwnDataProperty(value, "surfaces"),
    parseSurface,
  );
  const seen = new Set<string>();
  for (let index = 0; index < surfaces.length; index += 1) {
    const surface = surfaces[index];
    if (surface === undefined || seen.has(surface.id)) {
      invalidInput();
    }
    seen.add(surface.id);
  }
  return Object.freeze(surfaces);
}

function classifyPath(
  filePath: string,
  rules: readonly PathRule[],
): PathCategory {
  for (let index = 0; index < rules.length; index += 1) {
    const rule = rules[index];
    if (rule === undefined) {
      invalidInput();
    }
    for (let patternIndex = 0; patternIndex < rule.patterns.length; patternIndex += 1) {
      const pattern = rule.patterns[patternIndex];
      if (pattern !== undefined && matchesGlob(pattern, filePath)) {
        return rule.category;
      }
    }
  }
  return PATH_CATEGORIES.PRODUCTION;
}

function unionSorted(left: readonly string[], right: readonly string[]): string[] {
  const merged = [...left, ...right];
  const unique: string[] = [];
  const seen = new Set<string>();
  merged.sort(compareUtf8);
  for (let index = 0; index < merged.length; index += 1) {
    const item = merged[index];
    if (item !== undefined && !seen.has(item)) {
      seen.add(item);
      unique.push(item);
    }
  }
  return unique;
}

function missingFrom(
  required: readonly string[],
  available: readonly string[],
): boolean {
  const present = new Set(available);
  for (let index = 0; index < required.length; index += 1) {
    const item = required[index];
    if (item !== undefined && !present.has(item)) {
      return true;
    }
  }
  return false;
}

function higherRisk(left: RiskTier, right: RiskTier): RiskTier {
  return (riskRank[left] ?? 0) >= (riskRank[right] ?? 0) ? left : right;
}

function mergeSurface(
  base: SurfaceRecord,
  proposal: SurfaceRecord | undefined,
): { surface: SurfaceRecord; weakened: boolean } {
  if (proposal === undefined) {
    return { surface: base, weakened: false };
  }
  const paths = unionSorted(base.paths, proposal.paths);
  const exercises = unionSorted(base.exercises, proposal.exercises);
  const hypotheses = unionSorted(base.hypotheses, proposal.hypotheses);
  const weakened =
    missingFrom(base.paths, proposal.paths) ||
    missingFrom(base.exercises, proposal.exercises) ||
    missingFrom(base.hypotheses, proposal.hypotheses) ||
    (riskRank[proposal.risk_floor] ?? 0) < (riskRank[base.risk_floor] ?? 0) ||
    (base.publishes_artifact && !proposal.publishes_artifact);
  return {
    surface: Object.freeze({
      schema_version: 1 as const,
      id: base.id,
      paths: Object.freeze(paths),
      consumption: base.consumption,
      risk_floor: higherRisk(base.risk_floor, proposal.risk_floor),
      exercises: Object.freeze(exercises),
      hypotheses: Object.freeze(hypotheses),
      publishes_artifact: base.publishes_artifact || proposal.publishes_artifact,
    }),
    weakened,
  };
}

function surfaceMatchesPath(surface: SurfaceRecord, filePath: string): boolean {
  for (let index = 0; index < surface.paths.length; index += 1) {
    const pattern = surface.paths[index];
    if (pattern !== undefined && matchesGlob(pattern, filePath)) {
      return true;
    }
  }
  return false;
}

function provisionalId(filePath: string): string {
  const hex = createHash("sha256").update(filePath, "utf8").digest("hex");
  return `provisional.${hex}`;
}

function toMatched(
  surface: SurfaceRecord,
  kind: "declared" | "provisional",
): MatchedSurface {
  return Object.freeze({
    schema_version: 1,
    id: surface.id,
    kind,
    paths: surface.paths,
    consumption: surface.consumption,
    risk_floor: surface.risk_floor,
    exercises: surface.exercises,
    hypotheses: surface.hypotheses,
    publishes_artifact: surface.publishes_artifact,
  });
}

export function matchSurfaces(value: unknown): SurfaceDecision {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, inputKeys);
  const policy = parsePolicy(getOwnDataProperty(value, "base_policy"));
  const paths = parseDiff(getOwnDataProperty(value, "diff"));
  const proposal = parseProposal(getOwnDataProperty(value, "proposal"));

  const classifications: PathClassification[] = [];
  for (let index = 0; index < paths.length; index += 1) {
    const filePath = paths[index];
    if (filePath === undefined) {
      invalidInput();
    }
    classifications.push(
      Object.freeze({
        path: filePath,
        category: classifyPath(filePath, policy.path_rules),
      }),
    );
  }
  classifications.sort((left, right) => compareUtf8(left.path, right.path));

  const proposedById = new Map<string, SurfaceRecord>();
  if (proposal !== null) {
    for (let index = 0; index < proposal.length; index += 1) {
      const surface = proposal[index];
      if (surface === undefined) {
        invalidInput();
      }
      proposedById.set(surface.id, surface);
    }
  }

  let policyWeakening = false;
  const mergedById = new Map<string, SurfaceRecord>();
  for (let index = 0; index < policy.surfaces.length; index += 1) {
    const base = policy.surfaces[index];
    if (base === undefined) {
      invalidInput();
    }
    const merged = mergeSurface(base, proposedById.get(base.id));
    policyWeakening = policyWeakening || merged.weakened;
    mergedById.set(base.id, merged.surface);
  }
  if (proposal !== null) {
    for (let index = 0; index < proposal.length; index += 1) {
      const extra = proposal[index];
      if (extra !== undefined && !mergedById.has(extra.id)) {
        mergedById.set(extra.id, extra);
      }
    }
  }

  const matched: MatchedSurface[] = [];
  const seenIds = new Set<string>();
  const unmatchedProduction: string[] = [];
  for (let index = 0; index < classifications.length; index += 1) {
    const item = classifications[index];
    if (item === undefined) {
      invalidInput();
    }
    if (
      item.category !== PATH_CATEGORIES.PRODUCTION &&
      item.category !== PATH_CATEGORIES.VERIFICATION
    ) {
      continue;
    }
    let covered = false;
    for (const surface of mergedById.values()) {
      if (!surfaceMatchesPath(surface, item.path)) {
        continue;
      }
      covered = true;
      if (!seenIds.has(surface.id)) {
        seenIds.add(surface.id);
        matched.push(toMatched(surface, "declared"));
      }
    }
    if (!covered && item.category === PATH_CATEGORIES.PRODUCTION) {
      unmatchedProduction.push(item.path);
    }
  }

  for (let index = 0; index < unmatchedProduction.length; index += 1) {
    const filePath = unmatchedProduction[index];
    if (filePath === undefined) {
      invalidInput();
    }
    matched.push(
      toMatched(
        Object.freeze({
          schema_version: 1,
          id: provisionalId(filePath),
          paths: Object.freeze([filePath]),
          consumption: "unknown",
          risk_floor: RISK_TIERS.R2,
          exercises: Object.freeze([]),
          hypotheses: Object.freeze([]),
          publishes_artifact: false,
        }),
        "provisional",
      ),
    );
  }

  matched.sort((left, right) => compareUtf8(left.id, right.id));

  return Object.freeze({
    schema_version: 1,
    classifications: Object.freeze(classifications),
    surfaces: Object.freeze(matched),
    policy_weakening: policyWeakening,
  });
}
