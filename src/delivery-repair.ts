import { isRunCatalogIdentifier } from "./run-catalog.ts";
import { RUN_STATES } from "./domain.ts";
import type { RunState } from "./domain.ts";
import {
  GATE_RESULTS,
  RUN_EVENTS,
  transitionRunState,
} from "./run-state.ts";
import type { GateResult, RunEvent } from "./run-state.ts";

export type DeliveryRepairDecision = Readonly<{
  schema_version: 1;
  event: RunEvent | null;
  next_state: RunState;
  rollback_required: boolean;
  linked_repair_task_id: string;
  agent_active: false;
  run_complete: false;
}>;

const inputKeys = [
  "original_task_id",
  "run_state",
  "g8_result",
  "rollback_observed",
  "linked_repair_task_id",
  "repair_delivered",
] as const;
const knownRunStates = new Set<unknown>([
  RUN_STATES.DELIVERY_VERIFYING,
  RUN_STATES.WAITING_FOR_REPAIR,
]);
const knownResults = new Set<unknown>([GATE_RESULTS.PASS, GATE_RESULTS.FAIL]);

function invalidInput(): never {
  throw new TypeError("Invalid delivery repair input");
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

function decideEvent(
  runState: RunState,
  g8Result: GateResult,
  rollbackObserved: boolean,
  repairDelivered: boolean,
): RunEvent | null {
  if (runState === RUN_STATES.DELIVERY_VERIFYING) {
    if (
      g8Result !== GATE_RESULTS.FAIL ||
      !rollbackObserved ||
      repairDelivered
    ) {
      invalidInput();
    }
    return RUN_EVENTS.DELIVERY_UNHEALTHY;
  }
  if (repairDelivered) {
    if (g8Result !== GATE_RESULTS.PASS || !rollbackObserved) {
      invalidInput();
    }
    return RUN_EVENTS.REPAIR_DELIVERED;
  }
  if (g8Result !== GATE_RESULTS.FAIL || !rollbackObserved) {
    invalidInput();
  }
  return null;
}

export function resolveDeliveryRepair(value: unknown): DeliveryRepairDecision {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, inputKeys);
  const originalTaskId = getOwnDataProperty(value, "original_task_id");
  const linkedRepairTaskId = getOwnDataProperty(value, "linked_repair_task_id");
  if (
    !isRunCatalogIdentifier(originalTaskId) ||
    !isRunCatalogIdentifier(linkedRepairTaskId) ||
    originalTaskId === linkedRepairTaskId
  ) {
    invalidInput();
  }
  const runState = getOwnDataProperty(value, "run_state");
  if (!knownRunStates.has(runState)) {
    invalidInput();
  }
  const g8Result = getOwnDataProperty(value, "g8_result");
  if (!knownResults.has(g8Result)) {
    invalidInput();
  }
  const rollbackObserved = parseBoolean(
    getOwnDataProperty(value, "rollback_observed"),
  );
  const repairDelivered = parseBoolean(
    getOwnDataProperty(value, "repair_delivered"),
  );
  const event = decideEvent(
    runState as RunState,
    g8Result as GateResult,
    rollbackObserved,
    repairDelivered,
  );
  const nextState =
    event === null
      ? (runState as RunState)
      : transitionRunState(runState as RunState, event);
  return Object.freeze({
    schema_version: 1,
    event,
    next_state: nextState,
    rollback_required: true,
    linked_repair_task_id: linkedRepairTaskId,
    agent_active: false,
    run_complete: false,
  });
}
