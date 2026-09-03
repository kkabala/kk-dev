import { isRunCatalogIdentifier } from "./run-catalog.ts";
import { RUN_STATES } from "./domain.ts";
import { RISK_TIERS } from "./surfaces.ts";
import type { RiskTier } from "./surfaces.ts";
import { GATE_RESULTS } from "./run-state.ts";

export type G9Decision = Readonly<{
  schema_version: 1;
  original_task_id: string;
  original_run_state: typeof RUN_STATES.DONE;
  linked_learning_task_id: string;
  defective_snapshot_sha: string;
  missed_gate_id: string;
  risk_tier: RiskTier;
  g9_result: typeof GATE_RESULTS.PASS | typeof GATE_RESULTS.FAIL;
  run_complete: false;
}>;

const inputKeys = [
  "original_task_id",
  "original_run_state",
  "linked_learning_task_id",
  "defective_snapshot_sha",
  "durable_fix",
  "defective_snapshot_result",
  "repaired_snapshot_result",
  "missed_gate_id",
  "risk_tier",
] as const;
const knownResults = new Set<unknown>([GATE_RESULTS.PASS, GATE_RESULTS.FAIL]);
const knownTiers = new Set<unknown>(Object.values(RISK_TIERS));
const gateIdPattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u;

function invalidInput(): never {
  throw new TypeError("Invalid G9 input");
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

function parseBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") {
    invalidInput();
  }
  return value;
}

function parseRequiredString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    invalidInput();
  }
  return value;
}

function parseGateId(value: unknown): string {
  const id = parseRequiredString(value);
  if (!gateIdPattern.test(id)) {
    invalidInput();
  }
  return id;
}

export function evaluateG9(value: unknown): G9Decision {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, inputKeys);
  const originalTaskId = getOwnDataProperty(value, "original_task_id");
  const linkedLearningTaskId = getOwnDataProperty(
    value,
    "linked_learning_task_id",
  );
  if (
    !isRunCatalogIdentifier(originalTaskId) ||
    !isRunCatalogIdentifier(linkedLearningTaskId) ||
    originalTaskId === linkedLearningTaskId
  ) {
    invalidInput();
  }
  if (getOwnDataProperty(value, "original_run_state") !== RUN_STATES.DONE) {
    invalidInput();
  }
  const defectiveResult = getOwnDataProperty(value, "defective_snapshot_result");
  const repairedResult = getOwnDataProperty(value, "repaired_snapshot_result");
  if (!knownResults.has(defectiveResult) || !knownResults.has(repairedResult)) {
    invalidInput();
  }
  const riskTier = getOwnDataProperty(value, "risk_tier");
  if (!knownTiers.has(riskTier)) {
    invalidInput();
  }
  const durableFix = parseBoolean(getOwnDataProperty(value, "durable_fix"));
  const missedGateId = parseGateId(getOwnDataProperty(value, "missed_gate_id"));
  const pass =
    durableFix &&
    defectiveResult === GATE_RESULTS.FAIL &&
    repairedResult === GATE_RESULTS.PASS;
  return Object.freeze({
    schema_version: 1,
    original_task_id: originalTaskId,
    original_run_state: RUN_STATES.DONE,
    linked_learning_task_id: linkedLearningTaskId,
    defective_snapshot_sha: parseRequiredString(
      getOwnDataProperty(value, "defective_snapshot_sha"),
    ),
    missed_gate_id: missedGateId,
    risk_tier: riskTier as RiskTier,
    g9_result: pass ? GATE_RESULTS.PASS : GATE_RESULTS.FAIL,
    run_complete: false,
  });
}
