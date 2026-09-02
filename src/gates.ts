import { GATE_CLASSES } from "./gate-template.ts";
import type { GateClass } from "./gate-template.ts";
import { PATH_CATEGORIES, RISK_TIERS } from "./surfaces.ts";
import type {
  MatchedSurface,
  PathCategory,
  PathClassification,
  RiskTier,
  SurfaceDecision,
} from "./surfaces.ts";
import type { PathRisk, RiskDecision } from "./risk.ts";

export type PlannedGate = Readonly<{
  gate_class: GateClass;
  gate_id: string;
}>;

export type GatePlan = Readonly<{
  schema_version: 1;
  gates: readonly PlannedGate[];
  independent_verifier: boolean;
}>;

const inputKeys = [
  "base_policy",
  "risk",
  "surfaces",
  "contracts",
  "delivery",
] as const;
const policyKeys = [
  "schema_version",
  "integrity_gate_id",
  "required_g1",
  "governance_gate_id",
  "merge_candidate_gate_id",
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
const deliveryKeys = [
  "schema_version",
  "delivery_gate_id",
  "learning_gate_id",
] as const;

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
  throw new TypeError("Invalid gate-plan input");
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

function parseOptionalId(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  return parseId(value);
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

function parsePolicy(value: unknown): {
  integrity_gate_id: string;
  required_g1: readonly string[];
  governance_gate_id: string;
  merge_candidate_gate_id: string;
} {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, policyKeys);
  if (getOwnDataProperty(value, "schema_version") !== 1) {
    invalidInput();
  }
  return {
    integrity_gate_id: parseId(getOwnDataProperty(value, "integrity_gate_id")),
    required_g1: parseStringList(getOwnDataProperty(value, "required_g1"), parseId),
    governance_gate_id: parseId(getOwnDataProperty(value, "governance_gate_id")),
    merge_candidate_gate_id: parseId(
      getOwnDataProperty(value, "merge_candidate_gate_id"),
    ),
  };
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

function parseDelivery(value: unknown): {
  delivery_gate_id: string | null;
  learning_gate_id: string | null;
} {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, deliveryKeys);
  if (getOwnDataProperty(value, "schema_version") !== 1) {
    invalidInput();
  }
  return {
    delivery_gate_id: parseOptionalId(getOwnDataProperty(value, "delivery_gate_id")),
    learning_gate_id: parseOptionalId(getOwnDataProperty(value, "learning_gate_id")),
  };
}

function addGate(
  gates: Map<string, GateClass>,
  gateClass: GateClass,
  gateId: string,
): void {
  const existing = gates.get(gateId);
  if (existing !== undefined && existing !== gateClass) {
    invalidInput();
  }
  gates.set(gateId, gateClass);
}

function isElevated(tier: RiskTier): boolean {
  return (riskRank[tier] ?? 0) >= 2;
}

export function deriveGates(value: unknown): GatePlan {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, inputKeys);
  const policy = parsePolicy(getOwnDataProperty(value, "base_policy"));
  const risk = parseRisk(getOwnDataProperty(value, "risk"));
  const surfaces = parseSurfaceDecision(getOwnDataProperty(value, "surfaces"));
  const contracts = parseContracts(getOwnDataProperty(value, "contracts"));
  const delivery = parseDelivery(getOwnDataProperty(value, "delivery"));

  if (risk.policy_weakening !== surfaces.policy_weakening) {
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
  for (let index = 0; index < surfaces.surfaces.length; index += 1) {
    const surface = surfaces.surfaces[index];
    if (surface === undefined || surfaceIds.has(surface.id)) {
      invalidInput();
    }
    surfaceIds.add(surface.id);
  }

  const gates = new Map<string, GateClass>();
  addGate(gates, GATE_CLASSES.G0, policy.integrity_gate_id);
  for (let index = 0; index < policy.required_g1.length; index += 1) {
    const gateId = policy.required_g1[index];
    if (gateId === undefined) {
      invalidInput();
    }
    addGate(gates, GATE_CLASSES.G1, gateId);
  }

  const requireG2 = contracts.user_visible || contracts.pacs.length > 0;
  if (requireG2) {
    for (let index = 0; index < contracts.pacs.length; index += 1) {
      const pac = contracts.pacs[index];
      if (pac === undefined || !surfaceIds.has(pac.surface_id)) {
        invalidInput();
      }
      addGate(gates, GATE_CLASSES.G2, pac.template_id);
    }
  }

  const independentVerifier = isElevated(risk.overall);
  if (independentVerifier) {
    for (let index = 0; index < surfaces.surfaces.length; index += 1) {
      const surface = surfaces.surfaces[index];
      if (surface === undefined || !isElevated(surface.risk_floor)) {
        continue;
      }
      for (let hypoIndex = 0; hypoIndex < surface.hypotheses.length; hypoIndex += 1) {
        const hypothesis = surface.hypotheses[hypoIndex];
        if (hypothesis === undefined) {
          invalidInput();
        }
        addGate(gates, GATE_CLASSES.G3, `g3.${hypothesis}`);
      }
    }
  }

  for (let index = 0; index < surfaces.surfaces.length; index += 1) {
    const surface = surfaces.surfaces[index];
    if (surface === undefined) {
      invalidInput();
    }
    for (let exerciseIndex = 0; exerciseIndex < surface.exercises.length; exerciseIndex += 1) {
      const exercise = surface.exercises[exerciseIndex];
      if (exercise !== undefined && exercise.startsWith("g4.")) {
        addGate(gates, GATE_CLASSES.G4, exercise);
      }
    }
    if (surface.publishes_artifact) {
      addGate(gates, GATE_CLASSES.G5, `g5.${surface.id}`);
    }
  }

  addGate(gates, GATE_CLASSES.G6, policy.governance_gate_id);
  addGate(gates, GATE_CLASSES.G7, policy.merge_candidate_gate_id);
  if (delivery.delivery_gate_id !== null) {
    addGate(gates, GATE_CLASSES.G8, delivery.delivery_gate_id);
  }
  if (delivery.learning_gate_id !== null) {
    addGate(gates, GATE_CLASSES.G9, delivery.learning_gate_id);
  }

  const planned: PlannedGate[] = [];
  for (const [gateId, gateClass] of gates) {
    if (!knownGateClasses.has(gateClass)) {
      invalidInput();
    }
    planned.push(
      Object.freeze({
        gate_class: gateClass,
        gate_id: gateId,
      }),
    );
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
