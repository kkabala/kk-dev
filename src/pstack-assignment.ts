import { GATE_CLASSES } from "./gate-template.ts";
import type { GateClass } from "./gate-template.ts";
import type { Intent, NonEmptyReadonlyArray } from "./domain.ts";
import type { GatePlan, PlannedGate } from "./gates.ts";
import type { PathRisk, RiskDecision } from "./risk.ts";
import { PATH_CATEGORIES, RISK_TIERS } from "./surfaces.ts";
import type {
  MatchedSurface,
  PathCategory,
  PathClassification,
  RiskTier,
  SurfaceDecision,
} from "./surfaces.ts";
import { isRunCatalogIdentifier } from "./run-catalog.ts";

export type AssignmentCapabilities = Readonly<{
  network: "repository-policy";
  secrets: "none";
}>;

export type PstackAssignment = Readonly<{
  schema_version: 1;
  task_id: string;
  intent_ref: string;
  contract_ids: readonly string[];
  tier: RiskTier;
  surfaces: readonly string[];
  hypotheses: readonly string[];
  required_gate_ids: readonly string[];
  writable_scope: readonly string[];
  capabilities: AssignmentCapabilities;
}>;

const inputKeys = ["intent", "risk", "surfaces", "contracts", "gates"] as const;
const intentKeys = [
  "schema_version",
  "intent_id",
  "task_id",
  "goals",
  "non_goals",
  "constraints",
  "unresolved_decisions",
] as const;
const riskKeys = ["schema_version", "overall", "paths", "policy_weakening"] as const;
const pathRiskKeys = ["path", "category", "tier"] as const;
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
const contractKeys = ["schema_version", "user_visible", "pacs"] as const;
const pacKeys = ["id", "surface_id", "template_id"] as const;
const gatePlanKeys = ["schema_version", "gates", "independent_verifier"] as const;
const plannedGateKeys = ["gate_class", "gate_id"] as const;

const proposalScope = ".exoframe/proposals/**";
const knownCategories = new Set<unknown>(Object.values(PATH_CATEGORIES));
const knownRiskTiers = new Set<unknown>(Object.values(RISK_TIERS));
const knownSurfaceKinds = new Set(["declared", "provisional"]);
const knownGateClasses = new Set<unknown>(Object.values(GATE_CLASSES));
const riskRank: Readonly<Record<string, number>> = Object.freeze({
  [RISK_TIERS.R0]: 0,
  [RISK_TIERS.R1]: 1,
  [RISK_TIERS.R2]: 2,
  [RISK_TIERS.R3]: 3,
});
const classRank: Readonly<Record<string, number>> = Object.freeze({
  [GATE_CLASSES.G0]: 0,
  [GATE_CLASSES.G1]: 1,
  [GATE_CLASSES.G2]: 2,
  [GATE_CLASSES.G3]: 3,
  [GATE_CLASSES.G4]: 4,
  [GATE_CLASSES.G5]: 5,
  [GATE_CLASSES.G6]: 6,
  [GATE_CLASSES.G7]: 7,
  [GATE_CLASSES.G8]: 8,
  [GATE_CLASSES.G9]: 9,
});
const idPattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u;

function invalidInput(): never {
  throw new TypeError("Invalid assignment input");
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

function parseId(value: unknown): string {
  if (typeof value !== "string" || !idPattern.test(value)) {
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

function uniqueSorted(values: readonly string[]): readonly string[] {
  const unique: string[] = [];
  const seen = new Set<string>();
  const ordered = [...values];
  ordered.sort(compareUtf8);
  for (let index = 0; index < ordered.length; index += 1) {
    const item = ordered[index];
    if (item !== undefined && !seen.has(item)) {
      seen.add(item);
      unique.push(item);
    }
  }
  return Object.freeze(unique);
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
    id: parseId(getOwnDataProperty(value, "id")),
    kind: kind as "declared" | "provisional",
    paths: parseStringList(getOwnDataProperty(value, "paths"), parseGlobPattern),
    consumption: parseRequiredString(getOwnDataProperty(value, "consumption")),
    risk_floor: parseRiskTier(getOwnDataProperty(value, "risk_floor")),
    exercises: parseStringList(getOwnDataProperty(value, "exercises"), parseId),
    hypotheses: parseStringList(getOwnDataProperty(value, "hypotheses"), parseId),
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

function parseRisk(value: unknown): RiskDecision {
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
  return Object.freeze({
    schema_version: 1,
    overall: parseRiskTier(getOwnDataProperty(value, "overall")),
    paths: Object.freeze(
      captureDenseList(getOwnDataProperty(value, "paths"), parsePathRisk),
    ),
    policy_weakening: weakening,
  });
}

function parsePacRef(value: unknown): {
  id: string;
  surface_id: string;
  template_id: string;
} {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, pacKeys);
  return Object.freeze({
    id: parseId(getOwnDataProperty(value, "id")),
    surface_id: parseId(getOwnDataProperty(value, "surface_id")),
    template_id: parseId(getOwnDataProperty(value, "template_id")),
  });
}

function parseContracts(value: unknown): {
  user_visible: boolean;
  pacs: readonly {
    id: string;
    surface_id: string;
    template_id: string;
  }[];
} {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, contractKeys);
  const userVisible = getOwnDataProperty(value, "user_visible");
  if (getOwnDataProperty(value, "schema_version") !== 1 || typeof userVisible !== "boolean") {
    invalidInput();
  }
  const pacs = Object.freeze(
    captureDenseList(getOwnDataProperty(value, "pacs"), parsePacRef),
  );
  const seen = new Set<string>();
  for (let index = 0; index < pacs.length; index += 1) {
    const pac = pacs[index];
    if (pac === undefined || seen.has(pac.id)) {
      invalidInput();
    }
    seen.add(pac.id);
  }
  if (userVisible && pacs.length === 0) {
    invalidInput();
  }
  return {
    user_visible: userVisible,
    pacs,
  };
}

function parseGateClass(value: unknown): GateClass {
  if (!knownGateClasses.has(value)) {
    invalidInput();
  }
  return value as GateClass;
}

function parsePlannedGate(value: unknown): PlannedGate {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, plannedGateKeys);
  return Object.freeze({
    gate_class: parseGateClass(getOwnDataProperty(value, "gate_class")),
    gate_id: parseId(getOwnDataProperty(value, "gate_id")),
  });
}

function parseGatePlan(value: unknown): GatePlan {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, gatePlanKeys);
  const independentVerifier = getOwnDataProperty(value, "independent_verifier");
  if (
    getOwnDataProperty(value, "schema_version") !== 1 ||
    typeof independentVerifier !== "boolean"
  ) {
    invalidInput();
  }
  const planned = captureDenseList(getOwnDataProperty(value, "gates"), parsePlannedGate);
  const seen = new Set<string>();
  for (let index = 0; index < planned.length; index += 1) {
    const gate = planned[index];
    if (gate === undefined || seen.has(gate.gate_id)) {
      invalidInput();
    }
    seen.add(gate.gate_id);
  }
  if (planned.length === 0) {
    invalidInput();
  }
  planned.sort((left, right) => {
    const byClass = (classRank[left.gate_class] ?? 0) - (classRank[right.gate_class] ?? 0);
    if (byClass !== 0) {
      return byClass;
    }
    return compareUtf8(left.gate_id, right.gate_id);
  });
  return Object.freeze({
    schema_version: 1,
    gates: Object.freeze(planned),
    independent_verifier: independentVerifier,
  });
}

function parseIntent(value: unknown): Intent {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, intentKeys);
  if (getOwnDataProperty(value, "schema_version") !== 1) {
    invalidInput();
  }
  const taskId = getOwnDataProperty(value, "task_id");
  if (!isRunCatalogIdentifier(taskId)) {
    invalidInput();
  }
  const goals = parseStringList(getOwnDataProperty(value, "goals"), parseRequiredString);
  if (goals.length === 0) {
    invalidInput();
  }
  const unresolved = parseStringList(
    getOwnDataProperty(value, "unresolved_decisions"),
    parseRequiredString,
  );
  if (unresolved.length > 0) {
    invalidInput();
  }
  return Object.freeze({
    schema_version: 1,
    intent_id: parseRequiredString(getOwnDataProperty(value, "intent_id")),
    task_id: taskId,
    goals: Object.freeze(goals) as NonEmptyReadonlyArray<string>,
    non_goals: parseStringList(getOwnDataProperty(value, "non_goals"), parseRequiredString),
    constraints: parseStringList(
      getOwnDataProperty(value, "constraints"),
      parseRequiredString,
    ),
    unresolved_decisions: unresolved,
  });
}

function isElevated(tier: RiskTier): boolean {
  return (riskRank[tier] ?? 0) >= 2;
}

export function buildAssignment(value: unknown): PstackAssignment {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, inputKeys);
  const intent = parseIntent(getOwnDataProperty(value, "intent"));
  const risk = parseRisk(getOwnDataProperty(value, "risk"));
  const surfaces = parseSurfaceDecision(getOwnDataProperty(value, "surfaces"));
  const contracts = parseContracts(getOwnDataProperty(value, "contracts"));
  const gates = parseGatePlan(getOwnDataProperty(value, "gates"));

  if (risk.policy_weakening !== surfaces.policy_weakening) {
    invalidInput();
  }
  if (gates.independent_verifier !== isElevated(risk.overall)) {
    invalidInput();
  }

  const classified = new Set<string>();
  for (let index = 0; index < surfaces.classifications.length; index += 1) {
    const item = surfaces.classifications[index];
    if (item === undefined || classified.has(item.path)) {
      invalidInput();
    }
    classified.add(item.path);
  }
  const riskPaths = new Set<string>();
  for (let index = 0; index < risk.paths.length; index += 1) {
    const item = risk.paths[index];
    if (item === undefined || riskPaths.has(item.path) || !classified.has(item.path)) {
      invalidInput();
    }
    riskPaths.add(item.path);
  }
  if (riskPaths.size !== classified.size) {
    invalidInput();
  }

  const surfaceIds = new Set<string>();
  const hypotheses: string[] = [];
  const writable: string[] = [proposalScope];
  for (let index = 0; index < surfaces.surfaces.length; index += 1) {
    const surface = surfaces.surfaces[index];
    if (surface === undefined || surfaceIds.has(surface.id)) {
      invalidInput();
    }
    surfaceIds.add(surface.id);
    for (let hypoIndex = 0; hypoIndex < surface.hypotheses.length; hypoIndex += 1) {
      const hypothesis = surface.hypotheses[hypoIndex];
      if (hypothesis === undefined) {
        invalidInput();
      }
      hypotheses.push(hypothesis);
    }
    for (let pathIndex = 0; pathIndex < surface.paths.length; pathIndex += 1) {
      const surfacePath = surface.paths[pathIndex];
      if (surfacePath === undefined) {
        invalidInput();
      }
      writable.push(surfacePath);
    }
  }

  const contractIds: string[] = [];
  const gateIds = new Set(gates.gates.map((gate) => gate.gate_id));
  for (let index = 0; index < contracts.pacs.length; index += 1) {
    const pac = contracts.pacs[index];
    if (pac === undefined || !surfaceIds.has(pac.surface_id) || !gateIds.has(pac.template_id)) {
      invalidInput();
    }
    contractIds.push(pac.id);
  }

  return Object.freeze({
    schema_version: 1,
    task_id: intent.task_id,
    intent_ref: `intent://${intent.task_id}`,
    contract_ids: Object.freeze([...contractIds]),
    tier: risk.overall,
    surfaces: uniqueSorted([...surfaceIds]),
    hypotheses: uniqueSorted(hypotheses),
    required_gate_ids: Object.freeze(gates.gates.map((gate) => gate.gate_id)),
    writable_scope: uniqueSorted(writable),
    capabilities: Object.freeze({
      network: "repository-policy",
      secrets: "none",
    }),
  });
}
