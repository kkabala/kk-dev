export type RolloutStage = "canary" | "subset" | "production";

export type RolloutDecision = Readonly<{
  schema_version: 1;
  bank_complete: boolean;
  rollout_stage: RolloutStage;
  rollout_advanced: boolean;
  autonomy_decreased: boolean;
  rehearsal_only: boolean;
  production_mutated: false;
  run_complete: false;
}>;

const inputKeys = ["bank", "rollout", "rehearsal"] as const;
const bankKeys = ["required_task_ids", "passed_task_ids"] as const;
const rolloutKeys = [
  "current_stage",
  "requested_stage",
  "current_stage_healthy",
] as const;
const rehearsalKeys = [
  "trust_boundary_failure",
  "severity_1_or_2_escape",
  "unreplayed_escape_count_30d",
  "flake_rate_30d",
  "production_mutated",
] as const;
const stageOrder = ["canary", "subset", "production"] as const;
const knownStages = new Set<unknown>(stageOrder);

function invalidInput(): never {
  throw new TypeError("Invalid rollout input");
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

function parseNonNegativeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    invalidInput();
  }
  return value;
}

function parseRate(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
    invalidInput();
  }
  return value;
}

function parseStringList(value: unknown): readonly string[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    invalidInput();
  }
  const captured: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      invalidInput();
    }
    const id = parseRequiredString(value[index]);
    if (seen.has(id)) {
      invalidInput();
    }
    seen.add(id);
    captured.push(id);
  }
  return Object.freeze(captured);
}

function parseStage(value: unknown): RolloutStage {
  if (!knownStages.has(value)) {
    invalidInput();
  }
  return value as RolloutStage;
}

function parseBank(value: unknown): { complete: boolean } {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, bankKeys);
  const required = parseStringList(getOwnDataProperty(value, "required_task_ids"));
  if (required.length === 0) {
    invalidInput();
  }
  const passed = new Set(parseStringList(getOwnDataProperty(value, "passed_task_ids")));
  for (let index = 0; index < required.length; index += 1) {
    const taskId = required[index];
    if (taskId === undefined || !passed.has(taskId)) {
      return Object.freeze({ complete: false });
    }
  }
  return Object.freeze({ complete: true });
}

function parseRollout(value: unknown): {
  current_stage: RolloutStage;
  requested_stage: RolloutStage;
  current_stage_healthy: boolean;
} {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, rolloutKeys);
  return Object.freeze({
    current_stage: parseStage(getOwnDataProperty(value, "current_stage")),
    requested_stage: parseStage(getOwnDataProperty(value, "requested_stage")),
    current_stage_healthy: parseBoolean(
      getOwnDataProperty(value, "current_stage_healthy"),
    ),
  });
}

function parseRehearsal(value: unknown): { autonomy_decreased: boolean } {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, rehearsalKeys);
  if (getOwnDataProperty(value, "production_mutated") !== false) {
    invalidInput();
  }
  const autonomyDecreased =
    parseBoolean(getOwnDataProperty(value, "trust_boundary_failure")) ||
    parseBoolean(getOwnDataProperty(value, "severity_1_or_2_escape")) ||
    parseNonNegativeInteger(getOwnDataProperty(value, "unreplayed_escape_count_30d")) >=
      2 ||
    parseRate(getOwnDataProperty(value, "flake_rate_30d")) > 15;
  return Object.freeze({ autonomy_decreased: autonomyDecreased });
}

function nextStage(stage: RolloutStage): RolloutStage | null {
  if (stage === "canary") {
    return "subset";
  }
  if (stage === "subset") {
    return "production";
  }
  return null;
}

export function evaluateRollout(value: unknown): RolloutDecision {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, inputKeys);
  const bank = parseBank(getOwnDataProperty(value, "bank"));
  const rollout = parseRollout(getOwnDataProperty(value, "rollout"));
  const rehearsal = parseRehearsal(getOwnDataProperty(value, "rehearsal"));
  const requestedNext = nextStage(rollout.current_stage) === rollout.requested_stage;
  const advanced =
    bank.complete &&
    rollout.current_stage_healthy &&
    !rehearsal.autonomy_decreased &&
    requestedNext;
  return Object.freeze({
    schema_version: 1,
    bank_complete: bank.complete,
    rollout_stage: advanced ? rollout.requested_stage : rollout.current_stage,
    rollout_advanced: advanced,
    autonomy_decreased: rehearsal.autonomy_decreased,
    rehearsal_only: rehearsal.autonomy_decreased,
    production_mutated: false,
    run_complete: false,
  });
}
