import type { PathRisk, RiskDecision } from "./risk.ts";
import { PATH_CATEGORIES, RISK_TIERS } from "./surfaces.ts";
import type { PathCategory, RiskTier } from "./surfaces.ts";

export type ChangeType =
  | "copy"
  | "ui"
  | "configuration"
  | "business_logic"
  | "api"
  | "database"
  | "migration"
  | "security"
  | "infrastructure";

export type BlastRadius = "LOCAL" | "MODULE" | "CROSS_MODULE" | "SYSTEM";

export type Uncertainty = "KNOWN" | "PARTIALLY_KNOWN" | "UNKNOWN";

export type ScopeFacts = Readonly<{
  schema_version: 1;
  predicted_paths: readonly string[];
  change_types: readonly ChangeType[];
  sensitive: Readonly<{
    money: boolean;
    auth: boolean;
    permissions: boolean;
    persistent_data: boolean;
    external_api: boolean;
    infrastructure: boolean;
  }>;
  blast_radius: BlastRadius;
  uncertainty: Uncertainty;
}>;

const inputKeys = [
  "schema_version",
  "predicted_paths",
  "change_types",
  "sensitive",
  "blast_radius",
  "uncertainty",
] as const;
const sensitiveKeys = [
  "money",
  "auth",
  "permissions",
  "persistent_data",
  "external_api",
  "infrastructure",
] as const;
const riskKeys = ["schema_version", "overall", "paths", "policy_weakening"] as const;
const pathRiskKeys = ["path", "category", "tier"] as const;

const knownChangeTypes = new Set<unknown>([
  "copy",
  "ui",
  "configuration",
  "business_logic",
  "api",
  "database",
  "migration",
  "security",
  "infrastructure",
]);
const knownBlastRadii = new Set<unknown>([
  "LOCAL",
  "MODULE",
  "CROSS_MODULE",
  "SYSTEM",
]);
const knownUncertainty = new Set<unknown>([
  "KNOWN",
  "PARTIALLY_KNOWN",
  "UNKNOWN",
]);
const knownCategories = new Set<unknown>(Object.values(PATH_CATEGORIES));
const knownRiskTiers = new Set<unknown>(Object.values(RISK_TIERS));
const riskRank: Readonly<Record<string, number>> = Object.freeze({
  [RISK_TIERS.R0]: 0,
  [RISK_TIERS.R1]: 1,
  [RISK_TIERS.R2]: 2,
  [RISK_TIERS.R3]: 3,
});

function invalidInput(): never {
  throw new TypeError("Invalid scope-facts input");
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

function parseUniqueList<Item extends string>(
  value: unknown,
  readItem: (item: unknown) => Item,
): readonly Item[] {
  const captured = captureDenseList(value, readItem);
  const seen = new Set<Item>();
  for (let index = 0; index < captured.length; index += 1) {
    const item = captured[index];
    if (item === undefined || seen.has(item)) {
      invalidInput();
    }
    seen.add(item);
  }
  return Object.freeze(captured);
}

function parseCategory(value: unknown): PathCategory {
  if (!knownCategories.has(value)) {
    invalidInput();
  }
  return value as PathCategory;
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

function parseRiskTier(value: unknown): RiskTier {
  if (!knownRiskTiers.has(value)) {
    invalidInput();
  }
  return value as RiskTier;
}

function parseChangeType(value: unknown): ChangeType {
  if (!knownChangeTypes.has(value)) {
    invalidInput();
  }
  return value as ChangeType;
}

function parseBlastRadius(value: unknown): BlastRadius {
  if (!knownBlastRadii.has(value)) {
    invalidInput();
  }
  return value as BlastRadius;
}

function parseUncertainty(value: unknown): Uncertainty {
  if (!knownUncertainty.has(value)) {
    invalidInput();
  }
  return value as Uncertainty;
}

function parseBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") {
    invalidInput();
  }
  return value;
}

function parseSensitive(value: unknown): ScopeFacts["sensitive"] {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, sensitiveKeys);
  return Object.freeze({
    money: parseBoolean(getOwnDataProperty(value, "money")),
    auth: parseBoolean(getOwnDataProperty(value, "auth")),
    permissions: parseBoolean(getOwnDataProperty(value, "permissions")),
    persistent_data: parseBoolean(getOwnDataProperty(value, "persistent_data")),
    external_api: parseBoolean(getOwnDataProperty(value, "external_api")),
    infrastructure: parseBoolean(getOwnDataProperty(value, "infrastructure")),
  });
}

function higherRisk(left: RiskTier, right: RiskTier): RiskTier {
  return (riskRank[left] ?? 0) >= (riskRank[right] ?? 0) ? left : right;
}

function raiseOne(tier: RiskTier): RiskTier {
  if (tier === RISK_TIERS.R0) {
    return RISK_TIERS.R1;
  }
  if (tier === RISK_TIERS.R1) {
    return RISK_TIERS.R2;
  }
  return RISK_TIERS.R3;
}

export function parseScopeFacts(value: unknown): ScopeFacts {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, inputKeys);
  if (getOwnDataProperty(value, "schema_version") !== 1) {
    invalidInput();
  }
  return Object.freeze({
    schema_version: 1,
    predicted_paths: parseUniqueList(
      getOwnDataProperty(value, "predicted_paths"),
      parseRelativePath,
    ),
    change_types: parseUniqueList(
      getOwnDataProperty(value, "change_types"),
      parseChangeType,
    ),
    sensitive: parseSensitive(getOwnDataProperty(value, "sensitive")),
    blast_radius: parseBlastRadius(getOwnDataProperty(value, "blast_radius")),
    uncertainty: parseUncertainty(getOwnDataProperty(value, "uncertainty")),
  });
}

export function applyScopeFacts(
  decision: unknown,
  facts: unknown,
): RiskDecision {
  const parsedDecision = parseRiskDecision(decision);
  const parsedFacts = parseScopeFacts(facts);
  let overall = parsedDecision.overall;
  if (
    parsedFacts.sensitive.money ||
    parsedFacts.sensitive.auth ||
    parsedFacts.sensitive.permissions
  ) {
    overall = higherRisk(overall, RISK_TIERS.R3);
  }
  if (
    parsedFacts.sensitive.persistent_data ||
    parsedFacts.sensitive.external_api ||
    parsedFacts.sensitive.infrastructure
  ) {
    overall = higherRisk(overall, RISK_TIERS.R2);
  }
  for (let index = 0; index < parsedFacts.change_types.length; index += 1) {
    const changeType = parsedFacts.change_types[index];
    if (changeType === "migration" || changeType === "security") {
      overall = higherRisk(overall, RISK_TIERS.R3);
    }
    if (changeType === "api" || changeType === "database") {
      overall = higherRisk(overall, RISK_TIERS.R2);
    }
  }
  if (
    parsedFacts.blast_radius === "CROSS_MODULE" ||
    parsedFacts.blast_radius === "SYSTEM"
  ) {
    overall = higherRisk(overall, RISK_TIERS.R2);
  }
  if (parsedFacts.uncertainty === "UNKNOWN") {
    overall = higherRisk(overall, RISK_TIERS.R2);
  }
  if (parsedFacts.uncertainty === "PARTIALLY_KNOWN") {
    overall = higherRisk(overall, raiseOne(overall));
  }
  return Object.freeze({
    schema_version: 1,
    overall,
    paths: Object.freeze([...parsedDecision.paths]),
    policy_weakening: parsedDecision.policy_weakening,
  });
}
