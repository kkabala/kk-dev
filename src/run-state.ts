import { RUN_STATES } from "./domain.ts";
import type { RunState } from "./domain.ts";

declare const protocolValueBrand: unique symbol;

type BrandedProtocolValue<
  Value extends string,
  Domain extends string,
> = Value &
  Readonly<{
    [protocolValueBrand]: Domain;
  }>;

function freezeProtocolCatalog<
  const Domain extends string,
  const Values extends Readonly<Record<string, string>>,
>(_domain: Domain, values: Values): {
  readonly [Name in keyof Values]: BrandedProtocolValue<Values[Name], Domain>;
} {
  return Object.freeze(values) as {
    readonly [Name in keyof Values]: BrandedProtocolValue<
      Values[Name],
      Domain
    >;
  };
}

export const RUNNER_ATTEMPTS = freezeProtocolCatalog("RunnerAttempt", {
  PRODUCT_PASS: "PRODUCT_PASS",
  PRODUCT_FAIL: "PRODUCT_FAIL",
  PRODUCT_TIMEOUT: "PRODUCT_TIMEOUT",
  INFRA_ERROR: "INFRA_ERROR",
});

export type RunnerAttempt =
  (typeof RUNNER_ATTEMPTS)[keyof typeof RUNNER_ATTEMPTS];

export const GATE_RESULTS = freezeProtocolCatalog("GateResult", {
  PASS: "PASS",
  FAIL: "FAIL",
  FLAKY: "FLAKY",
  BLOCKED: "BLOCKED",
  STALE: "STALE",
  NOT_APPLICABLE: "NOT_APPLICABLE",
});

export type GateResult = (typeof GATE_RESULTS)[keyof typeof GATE_RESULTS];

export const ENGINEERING_STATUSES = freezeProtocolCatalog(
  "EngineeringStatus",
  {
    NOT_EVALUATED: "NOT_EVALUATED",
    WAITING_GATES: "WAITING_GATES",
    FAIL: "FAIL",
    BLOCKED: "BLOCKED",
    NEEDS_HUMAN: "NEEDS_HUMAN",
    ENGINEERING_READY: "ENGINEERING_READY",
    ENGINEERING_READY_WITH_EXCEPTION: "ENGINEERING_READY_WITH_EXCEPTION",
  },
);

export type EngineeringStatus =
  (typeof ENGINEERING_STATUSES)[keyof typeof ENGINEERING_STATUSES];

export const MERGE_MODES = freezeProtocolCatalog("MergeMode", {
  HUMAN_MERGE: "human_merge",
  GITHUB_AUTO_MERGE: "github_auto_merge",
});

export type MergeMode = (typeof MERGE_MODES)[keyof typeof MERGE_MODES];

export const RUN_EVENTS = freezeProtocolCatalog("RunEvent", {
  BLOCKING_PRODUCT_DECISION: "BLOCKING_PRODUCT_DECISION",
  DECISION_RECORDED: "DECISION_RECORDED",
  INTENDED_RED_REPAIR_REQUIRED: "INTENDED_RED_REPAIR_REQUIRED",
  PREREQUISITE_UNAVAILABLE: "PREREQUISITE_UNAVAILABLE",
  PREREQUISITE_RESTORED: "PREREQUISITE_RESTORED",
  IMPLEMENTATION_PREREQUISITES_READY: "IMPLEMENTATION_PREREQUISITES_READY",
  COHERENT_CANDIDATE: "COHERENT_CANDIDATE",
  VERIFICATION_BOUNCE_REQUIRED: "VERIFICATION_BOUNCE_REQUIRED",
  EXCEPTION_PROPOSED: "EXCEPTION_PROPOSED",
  EXCEPTION_NOT_ACCEPTED: "EXCEPTION_NOT_ACCEPTED",
  EXCEPTION_ACCEPTED: "EXCEPTION_ACCEPTED",
  ENGINEERING_GATES_PASSED: "ENGINEERING_GATES_PASSED",
  REVIEW_REQUIRED: "REVIEW_REQUIRED",
  CHANGES_REQUESTED: "CHANGES_REQUESTED",
  REVIEW_REQUIREMENTS_SATISFIED: "REVIEW_REQUIREMENTS_SATISFIED",
  REVIEW_NOT_REQUIRED: "REVIEW_NOT_REQUIRED",
  HUMAN_MERGE_REQUIRED: "HUMAN_MERGE_REQUIRED",
  HUMAN_MERGE_AUTHORIZED: "HUMAN_MERGE_AUTHORIZED",
  AUTO_MERGE_PERMITTED: "AUTO_MERGE_PERMITTED",
  MERGE_CANDIDATE_FAILED: "MERGE_CANDIDATE_FAILED",
  CANDIDATE_MERGED: "CANDIDATE_MERGED",
  RELEASE_REQUIRED: "RELEASE_REQUIRED",
  DELIVERY_VERIFICATION_STARTED: "DELIVERY_VERIFICATION_STARTED",
  RELEASE_OBSERVED: "RELEASE_OBSERVED",
  DELIVERY_HEALTHY: "DELIVERY_HEALTHY",
  DELIVERY_UNHEALTHY: "DELIVERY_UNHEALTHY",
  REPAIR_DELIVERED: "REPAIR_DELIVERED",
});

export type RunEvent = (typeof RUN_EVENTS)[keyof typeof RUN_EVENTS];

type RunTransition = readonly [RunState, RunEvent, RunState];

const runTransitions: readonly RunTransition[] = [
  [
    RUN_STATES.INTAKE,
    RUN_EVENTS.BLOCKING_PRODUCT_DECISION,
    RUN_STATES.WAITING_FOR_INTAKE_DECISION,
  ],
  [
    RUN_STATES.WAITING_FOR_INTAKE_DECISION,
    RUN_EVENTS.DECISION_RECORDED,
    RUN_STATES.INTAKE,
  ],
  [
    RUN_STATES.INTAKE,
    RUN_EVENTS.INTENDED_RED_REPAIR_REQUIRED,
    RUN_STATES.INTAKE,
  ],
  [
    RUN_STATES.INTAKE,
    RUN_EVENTS.PREREQUISITE_UNAVAILABLE,
    RUN_STATES.INTAKE_BLOCKED,
  ],
  [
    RUN_STATES.INTAKE_BLOCKED,
    RUN_EVENTS.PREREQUISITE_RESTORED,
    RUN_STATES.INTAKE,
  ],
  [
    RUN_STATES.INTAKE,
    RUN_EVENTS.IMPLEMENTATION_PREREQUISITES_READY,
    RUN_STATES.IMPLEMENTING,
  ],
  [
    RUN_STATES.IMPLEMENTING,
    RUN_EVENTS.BLOCKING_PRODUCT_DECISION,
    RUN_STATES.WAITING_FOR_IMPLEMENTATION_DECISION,
  ],
  [
    RUN_STATES.WAITING_FOR_IMPLEMENTATION_DECISION,
    RUN_EVENTS.DECISION_RECORDED,
    RUN_STATES.IMPLEMENTING,
  ],
  [
    RUN_STATES.IMPLEMENTING,
    RUN_EVENTS.COHERENT_CANDIDATE,
    RUN_STATES.VERIFYING,
  ],
  [
    RUN_STATES.VERIFYING,
    RUN_EVENTS.VERIFICATION_BOUNCE_REQUIRED,
    RUN_STATES.IMPLEMENTING,
  ],
  [
    RUN_STATES.VERIFYING,
    RUN_EVENTS.PREREQUISITE_UNAVAILABLE,
    RUN_STATES.VERIFYING_BLOCKED,
  ],
  [
    RUN_STATES.VERIFYING_BLOCKED,
    RUN_EVENTS.PREREQUISITE_RESTORED,
    RUN_STATES.VERIFYING,
  ],
  [
    RUN_STATES.VERIFYING,
    RUN_EVENTS.EXCEPTION_PROPOSED,
    RUN_STATES.WAITING_FOR_EXCEPTION,
  ],
  [
    RUN_STATES.WAITING_FOR_EXCEPTION,
    RUN_EVENTS.EXCEPTION_NOT_ACCEPTED,
    RUN_STATES.VERIFYING,
  ],
  [
    RUN_STATES.WAITING_FOR_EXCEPTION,
    RUN_EVENTS.EXCEPTION_ACCEPTED,
    RUN_STATES.ENGINEERING_READY_WITH_EXCEPTION,
  ],
  [
    RUN_STATES.VERIFYING,
    RUN_EVENTS.ENGINEERING_GATES_PASSED,
    RUN_STATES.ENGINEERING_READY,
  ],
  [
    RUN_STATES.ENGINEERING_READY,
    RUN_EVENTS.REVIEW_REQUIRED,
    RUN_STATES.WAITING_FOR_REVIEW,
  ],
  [
    RUN_STATES.ENGINEERING_READY_WITH_EXCEPTION,
    RUN_EVENTS.REVIEW_REQUIRED,
    RUN_STATES.WAITING_FOR_REVIEW,
  ],
  [
    RUN_STATES.WAITING_FOR_REVIEW,
    RUN_EVENTS.CHANGES_REQUESTED,
    RUN_STATES.IMPLEMENTING,
  ],
  [
    RUN_STATES.WAITING_FOR_REVIEW,
    RUN_EVENTS.REVIEW_REQUIREMENTS_SATISFIED,
    RUN_STATES.MERGE_READY,
  ],
  [
    RUN_STATES.ENGINEERING_READY,
    RUN_EVENTS.REVIEW_NOT_REQUIRED,
    RUN_STATES.MERGE_READY,
  ],
  [
    RUN_STATES.MERGE_READY,
    RUN_EVENTS.HUMAN_MERGE_REQUIRED,
    RUN_STATES.WAITING_FOR_MERGE,
  ],
  [
    RUN_STATES.WAITING_FOR_MERGE,
    RUN_EVENTS.HUMAN_MERGE_AUTHORIZED,
    RUN_STATES.MERGING,
  ],
  [
    RUN_STATES.MERGE_READY,
    RUN_EVENTS.AUTO_MERGE_PERMITTED,
    RUN_STATES.MERGING,
  ],
  [
    RUN_STATES.MERGING,
    RUN_EVENTS.MERGE_CANDIDATE_FAILED,
    RUN_STATES.IMPLEMENTING,
  ],
  [
    RUN_STATES.MERGING,
    RUN_EVENTS.CANDIDATE_MERGED,
    RUN_STATES.MERGED,
  ],
  [
    RUN_STATES.MERGED,
    RUN_EVENTS.RELEASE_REQUIRED,
    RUN_STATES.RELEASE_PENDING,
  ],
  [
    RUN_STATES.MERGED,
    RUN_EVENTS.DELIVERY_VERIFICATION_STARTED,
    RUN_STATES.DELIVERY_VERIFYING,
  ],
  [
    RUN_STATES.RELEASE_PENDING,
    RUN_EVENTS.RELEASE_OBSERVED,
    RUN_STATES.DELIVERY_VERIFYING,
  ],
  [
    RUN_STATES.DELIVERY_VERIFYING,
    RUN_EVENTS.DELIVERY_HEALTHY,
    RUN_STATES.DONE,
  ],
  [
    RUN_STATES.DELIVERY_VERIFYING,
    RUN_EVENTS.DELIVERY_UNHEALTHY,
    RUN_STATES.WAITING_FOR_REPAIR,
  ],
  [
    RUN_STATES.WAITING_FOR_REPAIR,
    RUN_EVENTS.REPAIR_DELIVERED,
    RUN_STATES.DELIVERY_VERIFYING,
  ],
];

const transitionTargets = new Map<RunState, Map<RunEvent, RunState>>();
for (const [from, event, to] of runTransitions) {
  const eventTargets = transitionTargets.get(from) ?? new Map();
  eventTargets.set(event, to);
  transitionTargets.set(from, eventTargets);
}

export function transitionRunState(
  state: RunState,
  event: RunEvent,
): RunState {
  const nextState = transitionTargets.get(state)?.get(event);
  if (nextState === undefined) {
    throw new Error(`Invalid run transition: ${state} + ${event}`);
  }

  return nextState;
}

export type RequiredGateEvaluation = Readonly<{
  result: GateResult | null;
  covered_by_live_exception: boolean;
}>;

export type EngineeringStatusInput = Readonly<{
  required_gates: readonly RequiredGateEvaluation[];
  needs_human: boolean;
}>;

const knownGateResults = new Set<unknown>(Object.values(GATE_RESULTS));

function isGateResult(value: unknown): value is GateResult {
  return knownGateResults.has(value);
}

type NormalizedEngineeringStatusInput = Readonly<{
  requiredGates: readonly RequiredGateEvaluation[];
  needsHuman: boolean;
}>;

function getOwnDataProperty(object: object, key: PropertyKey): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (descriptor === undefined || !("value" in descriptor)) {
    throw new TypeError("Invalid engineering status input");
  }

  return descriptor.value;
}

function normalizeEngineeringStatusInput(
  input: EngineeringStatusInput,
): NormalizedEngineeringStatusInput {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new TypeError("Invalid engineering status input");
  }

  const requiredGates = getOwnDataProperty(input, "required_gates");
  const needsHuman = getOwnDataProperty(input, "needs_human");
  if (!Array.isArray(requiredGates) || typeof needsHuman !== "boolean") {
    throw new TypeError("Invalid engineering status input");
  }

  const requiredGateCount = getOwnDataProperty(requiredGates, "length");
  if (
    typeof requiredGateCount !== "number" ||
    !Number.isSafeInteger(requiredGateCount) ||
    requiredGateCount < 0
  ) {
    throw new TypeError("Invalid engineering status input");
  }

  const normalizedGates: RequiredGateEvaluation[] = [];
  for (let index = 0; index < requiredGateCount; index += 1) {
    const gate = getOwnDataProperty(requiredGates, index);
    if (
      typeof gate !== "object" ||
      gate === null ||
      Array.isArray(gate)
    ) {
      throw new TypeError("Invalid engineering status input");
    }

    const result = getOwnDataProperty(gate, "result");
    const coveredByLiveException = getOwnDataProperty(
      gate,
      "covered_by_live_exception",
    );
    if (
      typeof coveredByLiveException !== "boolean" ||
      (result !== null && !isGateResult(result))
    ) {
      throw new TypeError("Invalid engineering status input");
    }

    normalizedGates[index] = Object.freeze({
      result,
      covered_by_live_exception: coveredByLiveException,
    });
  }

  return Object.freeze({
    requiredGates: Object.freeze(normalizedGates),
    needsHuman,
  });
}

export function deriveEngineeringStatus(
  input: EngineeringStatusInput,
): EngineeringStatus {
  const { needsHuman, requiredGates } = normalizeEngineeringStatusInput(input);

  let hasUnhandledFailure = false;
  let hasUnavailablePrerequisite = false;
  let hasPendingEvidence = false;
  let hasLiveException = false;
  let allRequirementsPass = requiredGates.length > 0;

  for (let index = 0; index < requiredGates.length; index += 1) {
    const gate = requiredGates[index];
    if (gate === undefined) {
      throw new TypeError("Invalid normalized engineering status input");
    }

    const { covered_by_live_exception: covered, result } = gate;
    hasUnhandledFailure ||=
      !covered &&
      (result === GATE_RESULTS.FAIL || result === GATE_RESULTS.FLAKY);
    hasUnavailablePrerequisite ||=
      !covered && result === GATE_RESULTS.BLOCKED;
    hasPendingEvidence ||=
      !covered && (result === null || result === GATE_RESULTS.STALE);
    hasLiveException ||= covered;
    allRequirementsPass &&=
      result === GATE_RESULTS.PASS ||
      result === GATE_RESULTS.NOT_APPLICABLE;
  }

  if (hasUnhandledFailure) {
    return ENGINEERING_STATUSES.FAIL;
  }

  if (needsHuman) {
    return ENGINEERING_STATUSES.NEEDS_HUMAN;
  }

  if (hasUnavailablePrerequisite) {
    return ENGINEERING_STATUSES.BLOCKED;
  }

  if (hasPendingEvidence) {
    return ENGINEERING_STATUSES.WAITING_GATES;
  }

  if (hasLiveException) {
    return ENGINEERING_STATUSES.ENGINEERING_READY_WITH_EXCEPTION;
  }

  if (allRequirementsPass) {
    return ENGINEERING_STATUSES.ENGINEERING_READY;
  }

  return ENGINEERING_STATUSES.NOT_EVALUATED;
}
