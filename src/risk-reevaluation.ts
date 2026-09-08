import type { PathRisk, RiskDecision } from "./risk.ts";
import { PATH_CATEGORIES, RISK_TIERS } from "./surfaces.ts";
import type { PathCategory, RiskTier } from "./surfaces.ts";

export type RiskReevaluation = Readonly<{
  schema_version: 1;
  planned: RiskTier;
  actual: RiskTier;
  overall: RiskTier;
  escalated: boolean;
  extra_paths: readonly string[];
  missing_paths: readonly string[];
  decision: RiskDecision;
}>;

const inputKeys = ["planned", "actual"] as const;
const riskKeys = ["schema_version", "overall", "paths", "policy_weakening"] as const;
const pathRiskKeys = ["path", "category", "tier"] as const;

const knownCategories = new Set<unknown>(Object.values(PATH_CATEGORIES));
const knownRiskTiers = new Set<unknown>(Object.values(RISK_TIERS));
const riskRank: Readonly<Record<string, number>> = Object.freeze({
  [RISK_TIERS.R0]: 0,
  [RISK_TIERS.R1]: 1,
  [RISK_TIERS.R2]: 2,
  [RISK_TIERS.R3]: 3,
});

function invalidInput(): never {
  throw new TypeError("Invalid risk-reevaluation input");
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

function parsePathRisk(value: unknown): PathRisk {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, pathRiskKeys);
  return Object.freeze({
    path: parseRelativePath(getOwnDataProperty(value, "path")),
    category: parseCategory(getOwnDataProperty(value, "category")),
    tier: parseRiskTier(getOwnDataProperty(value, "tier")),
  });
}

function parseRiskDecision(value: unknown): RiskDecision {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, riskKeys);
  const weakening = getOwnDataProperty(value, "policy_weakening");
  if (
    getOwnDataProperty(value, "schema_version") !== 1 ||
    typeof weakening !== "boolean"
  ) {
    invalidInput();
  }
  const paths = captureDenseList(getOwnDataProperty(value, "paths"), parsePathRisk);
  const seen = new Set<string>();
  for (let index = 0; index < paths.length; index += 1) {
    const item = paths[index];
    if (item === undefined || seen.has(item.path)) {
      invalidInput();
    }
    seen.add(item.path);
  }
  return Object.freeze({
    schema_version: 1,
    overall: parseRiskTier(getOwnDataProperty(value, "overall")),
    paths: Object.freeze(paths),
    policy_weakening: weakening,
  });
}

function higherRisk(left: RiskTier, right: RiskTier): RiskTier {
  return (riskRank[left] ?? 0) >= (riskRank[right] ?? 0) ? left : right;
}

function pathNames(decision: RiskDecision): string[] {
  const names: string[] = [];
  for (let index = 0; index < decision.paths.length; index += 1) {
    const item = decision.paths[index];
    if (item === undefined) {
      invalidInput();
    }
    names.push(item.path);
  }
  return names;
}

export function reevaluateRisk(value: unknown): RiskReevaluation {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, inputKeys);
  const planned = parseRiskDecision(getOwnDataProperty(value, "planned"));
  const actual = parseRiskDecision(getOwnDataProperty(value, "actual"));
  const plannedNames = pathNames(planned);
  const actualNames = pathNames(actual);
  const plannedSet = new Set(plannedNames);
  const actualSet = new Set(actualNames);
  const extraPaths: string[] = [];
  const missingPaths: string[] = [];
  for (let index = 0; index < actualNames.length; index += 1) {
    const filePath = actualNames[index];
    if (filePath !== undefined && !plannedSet.has(filePath)) {
      extraPaths.push(filePath);
    }
  }
  for (let index = 0; index < plannedNames.length; index += 1) {
    const filePath = plannedNames[index];
    if (filePath !== undefined && !actualSet.has(filePath)) {
      missingPaths.push(filePath);
    }
  }
  extraPaths.sort(compareUtf8);
  missingPaths.sort(compareUtf8);
  const overall = higherRisk(planned.overall, actual.overall);
  const escalated =
    (riskRank[actual.overall] ?? 0) > (riskRank[planned.overall] ?? 0) ||
    extraPaths.length > 0;
  return Object.freeze({
    schema_version: 1,
    planned: planned.overall,
    actual: actual.overall,
    overall,
    escalated,
    extra_paths: Object.freeze(extraPaths),
    missing_paths: Object.freeze(missingPaths),
    decision: Object.freeze({
      schema_version: 1,
      overall,
      paths: actual.paths,
      policy_weakening: planned.policy_weakening || actual.policy_weakening,
    }),
  });
}
