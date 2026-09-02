import {
  PATH_CATEGORIES,
  RISK_TIERS,
} from "./surfaces.ts";
import type {
  MatchedSurface,
  PathCategory,
  PathClassification,
  RiskTier,
  SurfaceDecision,
} from "./surfaces.ts";

export type PathRisk = Readonly<{
  path: string;
  category: PathCategory;
  tier: RiskTier;
}>;

export type RiskDecision = Readonly<{
  schema_version: 1;
  overall: RiskTier;
  paths: readonly PathRisk[];
  policy_weakening: boolean;
}>;

const inputKeys = ["base_policy", "intent", "diff", "surfaces"] as const;
const policyKeys = [
  "schema_version",
  "unknown_production_floor",
  "trust_boundary_floor",
] as const;
const intentKeys = ["schema_version", "task_id", "requested_tier"] as const;
const diffKeys = ["paths", "trust_boundary"] as const;
const surfaceDecisionKeys = [
  "schema_version",
  "classifications",
  "surfaces",
  "policy_weakening",
] as const;
const classificationKeys = ["path", "category"] as const;
const matchedSurfaceKeys = [
  "schema_version",
  "id",
  "kind",
  "paths",
  "consumption",
  "risk_floor",
  "exercises",
  "hypotheses",
  "publishes_artifact",
] as const;

const knownCategories = new Set<unknown>(Object.values(PATH_CATEGORIES));
const knownRiskTiers = new Set<unknown>(Object.values(RISK_TIERS));
const knownSurfaceKinds = new Set(["declared", "provisional"]);
const riskRank: Readonly<Record<string, number>> = Object.freeze({
  [RISK_TIERS.R0]: 0,
  [RISK_TIERS.R1]: 1,
  [RISK_TIERS.R2]: 2,
  [RISK_TIERS.R3]: 3,
});
const surfaceIdPattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u;

function invalidInput(): never {
  throw new TypeError("Invalid risk input");
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

function parseOptionalRiskTier(value: unknown): RiskTier | null {
  if (value === null) {
    return null;
  }
  return parseRiskTier(value);
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

function higherRisk(left: RiskTier, right: RiskTier): RiskTier {
  return (riskRank[left] ?? 0) >= (riskRank[right] ?? 0) ? left : right;
}

function parsePolicy(value: unknown): {
  unknown_production_floor: RiskTier;
  trust_boundary_floor: RiskTier;
} {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, policyKeys);
  if (getOwnDataProperty(value, "schema_version") !== 1) {
    invalidInput();
  }
  return {
    unknown_production_floor: parseRiskTier(
      getOwnDataProperty(value, "unknown_production_floor"),
    ),
    trust_boundary_floor: parseRiskTier(
      getOwnDataProperty(value, "trust_boundary_floor"),
    ),
  };
}

function parseIntent(value: unknown): {
  requested_tier: RiskTier | null;
} {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, intentKeys);
  if (getOwnDataProperty(value, "schema_version") !== 1) {
    invalidInput();
  }
  parseRequiredString(getOwnDataProperty(value, "task_id"));
  return {
    requested_tier: parseOptionalRiskTier(
      getOwnDataProperty(value, "requested_tier"),
    ),
  };
}

function parseDiff(value: unknown): {
  paths: readonly string[];
  trust_boundary: boolean;
} {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, diffKeys);
  const trustBoundary = getOwnDataProperty(value, "trust_boundary");
  if (typeof trustBoundary !== "boolean") {
    invalidInput();
  }
  return {
    paths: parseStringList(getOwnDataProperty(value, "paths"), parseRelativePath),
    trust_boundary: trustBoundary,
  };
}

function parseClassification(value: unknown): PathClassification {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, classificationKeys);
  return Object.freeze({
    path: parseRelativePath(getOwnDataProperty(value, "path")),
    category: parseCategory(getOwnDataProperty(value, "category")),
  });
}

function parseMatchedSurface(value: unknown): MatchedSurface {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, matchedSurfaceKeys);
  const schemaVersion = getOwnDataProperty(value, "schema_version");
  const kind = getOwnDataProperty(value, "kind");
  const publishes = getOwnDataProperty(value, "publishes_artifact");
  if (
    schemaVersion !== 1 ||
    !knownSurfaceKinds.has(kind as string) ||
    typeof publishes !== "boolean"
  ) {
    invalidInput();
  }
  return Object.freeze({
    schema_version: 1,
    id: parseSurfaceId(getOwnDataProperty(value, "id")),
    kind: kind as "declared" | "provisional",
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

function parseSurfaceDecision(value: unknown): SurfaceDecision {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, surfaceDecisionKeys);
  const weakening = getOwnDataProperty(value, "policy_weakening");
  if (
    getOwnDataProperty(value, "schema_version") !== 1 ||
    typeof weakening !== "boolean"
  ) {
    invalidInput();
  }
  return Object.freeze({
    schema_version: 1,
    classifications: Object.freeze(
      captureDenseList(
        getOwnDataProperty(value, "classifications"),
        parseClassification,
      ),
    ),
    surfaces: Object.freeze(
      captureDenseList(getOwnDataProperty(value, "surfaces"), parseMatchedSurface),
    ),
    policy_weakening: weakening,
  });
}

function coveringFloors(
  filePath: string,
  surfaces: readonly MatchedSurface[],
): RiskTier | null {
  let floor: RiskTier | null = null;
  for (let index = 0; index < surfaces.length; index += 1) {
    const surface = surfaces[index];
    if (surface === undefined) {
      invalidInput();
    }
    for (let patternIndex = 0; patternIndex < surface.paths.length; patternIndex += 1) {
      const pattern = surface.paths[patternIndex];
      if (pattern !== undefined && matchesGlob(pattern, filePath)) {
        floor = floor === null ? surface.risk_floor : higherRisk(floor, surface.risk_floor);
      }
    }
  }
  return floor;
}

function classifyPath(
  classification: PathClassification,
  surfaces: readonly MatchedSurface[],
  unknownProduction: RiskTier,
  trustBoundaryFloor: RiskTier,
  trustBoundary: boolean,
): RiskTier {
  const inherited = coveringFloors(classification.path, surfaces);
  let tier: RiskTier;
  if (classification.category === PATH_CATEGORIES.PRODUCTION) {
    tier = inherited ?? unknownProduction;
  } else if (classification.category === PATH_CATEGORIES.CONTROL_PLANE) {
    tier = RISK_TIERS.R3;
    if (inherited !== null) {
      tier = higherRisk(tier, inherited);
    }
  } else if (classification.category === PATH_CATEGORIES.VERIFICATION) {
    tier = inherited ?? RISK_TIERS.R1;
  } else {
    tier = RISK_TIERS.R0;
    if (inherited !== null) {
      tier = higherRisk(tier, inherited);
    }
  }
  if (trustBoundary) {
    tier = higherRisk(tier, trustBoundaryFloor);
  }
  return tier;
}

export function classifyRisk(value: unknown): RiskDecision {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, inputKeys);
  const policy = parsePolicy(getOwnDataProperty(value, "base_policy"));
  const intent = parseIntent(getOwnDataProperty(value, "intent"));
  const diff = parseDiff(getOwnDataProperty(value, "diff"));
  const surfaces = parseSurfaceDecision(getOwnDataProperty(value, "surfaces"));

  const classifiedPaths = new Set<string>();
  for (let index = 0; index < surfaces.classifications.length; index += 1) {
    const item = surfaces.classifications[index];
    if (item === undefined || classifiedPaths.has(item.path)) {
      invalidInput();
    }
    classifiedPaths.add(item.path);
  }
  if (
    diff.paths.length !== classifiedPaths.size ||
    diff.paths.some((path) => !classifiedPaths.has(path))
  ) {
    invalidInput();
  }

  const pathRisks: PathRisk[] = [];
  let overall: RiskTier = RISK_TIERS.R0;
  let sawPath = false;
  for (let index = 0; index < surfaces.classifications.length; index += 1) {
    const item = surfaces.classifications[index];
    if (item === undefined) {
      invalidInput();
    }
    const tier = classifyPath(
      item,
      surfaces.surfaces,
      policy.unknown_production_floor,
      policy.trust_boundary_floor,
      diff.trust_boundary,
    );
    pathRisks.push(
      Object.freeze({
        path: item.path,
        category: item.category,
        tier,
      }),
    );
    overall = sawPath ? higherRisk(overall, tier) : tier;
    sawPath = true;
  }
  if (intent.requested_tier !== null) {
    overall = higherRisk(overall, intent.requested_tier);
  }
  if (!sawPath) {
    overall =
      intent.requested_tier === null ? RISK_TIERS.R0 : intent.requested_tier;
  }
  pathRisks.sort((left, right) => compareUtf8(left.path, right.path));

  return Object.freeze({
    schema_version: 1,
    overall,
    paths: Object.freeze(pathRisks),
    policy_weakening: surfaces.policy_weakening,
  });
}
