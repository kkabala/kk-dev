import { RUN_STATES } from "./domain.ts";
import type { RunState } from "./domain.ts";
import { MERGE_MODES, RUN_EVENTS, transitionRunState } from "./run-state.ts";
import type { MergeMode, RunEvent } from "./run-state.ts";

export type GovernanceReviews = Readonly<{
  required_count: number;
  submitted_count: number;
  codeowners_satisfied: boolean;
  approval_fresh: boolean;
}>;

export type GovernanceDecision = Readonly<{
  schema_version: 1;
  event: RunEvent | null;
  next_state: RunState;
  agent_active: boolean;
  run_complete: false;
}>;

const inputKeys = [
  "run_state",
  "merge_mode",
  "reviews",
  "changes_requested",
  "g6_satisfied",
] as const;
const reviewKeys = [
  "required_count",
  "submitted_count",
  "codeowners_satisfied",
  "approval_fresh",
] as const;
const knownRunStates = new Set<unknown>([
  RUN_STATES.ENGINEERING_READY,
  RUN_STATES.ENGINEERING_READY_WITH_EXCEPTION,
  RUN_STATES.WAITING_FOR_REVIEW,
  RUN_STATES.MERGE_READY,
  RUN_STATES.WAITING_FOR_MERGE,
]);
const knownMergeModes = new Set<unknown>(Object.values(MERGE_MODES));

function invalidInput(): never {
  throw new TypeError("Invalid governance input");
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

function parseCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    invalidInput();
  }
  return value;
}

function parseReviews(value: unknown): GovernanceReviews {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, reviewKeys);
  return Object.freeze({
    required_count: parseCount(getOwnDataProperty(value, "required_count")),
    submitted_count: parseCount(getOwnDataProperty(value, "submitted_count")),
    codeowners_satisfied: parseBoolean(
      getOwnDataProperty(value, "codeowners_satisfied"),
    ),
    approval_fresh: parseBoolean(getOwnDataProperty(value, "approval_fresh")),
  });
}

function reviewsRequired(reviews: GovernanceReviews): boolean {
  return reviews.required_count > 0 || !reviews.codeowners_satisfied;
}

function reviewsSatisfied(
  reviews: GovernanceReviews,
  changesRequested: boolean,
): boolean {
  return (
    !changesRequested &&
    reviews.submitted_count >= reviews.required_count &&
    reviews.codeowners_satisfied &&
    (reviews.required_count === 0 || reviews.approval_fresh)
  );
}

function decideEvent(
  runState: RunState,
  mergeMode: MergeMode,
  reviews: GovernanceReviews,
  changesRequested: boolean,
  g6Satisfied: boolean,
): RunEvent | null {
  const satisfied = reviewsSatisfied(reviews, changesRequested) && g6Satisfied;
  if (runState === RUN_STATES.ENGINEERING_READY) {
    if (changesRequested) {
      invalidInput();
    }
    if (reviewsRequired(reviews)) {
      return RUN_EVENTS.REVIEW_REQUIRED;
    }
    if (satisfied) {
      return RUN_EVENTS.REVIEW_NOT_REQUIRED;
    }
    return null;
  }
  if (runState === RUN_STATES.ENGINEERING_READY_WITH_EXCEPTION) {
    if (changesRequested) {
      invalidInput();
    }
    return RUN_EVENTS.REVIEW_REQUIRED;
  }
  if (runState === RUN_STATES.WAITING_FOR_REVIEW) {
    if (changesRequested) {
      return RUN_EVENTS.CHANGES_REQUESTED;
    }
    if (satisfied) {
      return RUN_EVENTS.REVIEW_REQUIREMENTS_SATISFIED;
    }
    return null;
  }
  if (runState === RUN_STATES.MERGE_READY) {
    if (changesRequested) {
      invalidInput();
    }
    if (mergeMode === MERGE_MODES.HUMAN_MERGE) {
      return RUN_EVENTS.HUMAN_MERGE_REQUIRED;
    }
    return null;
  }
  if (changesRequested) {
    invalidInput();
  }
  return null;
}

export function evaluateGovernance(value: unknown): GovernanceDecision {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, inputKeys);
  const runState = getOwnDataProperty(value, "run_state");
  if (!knownRunStates.has(runState)) {
    invalidInput();
  }
  const mergeMode = getOwnDataProperty(value, "merge_mode");
  if (!knownMergeModes.has(mergeMode)) {
    invalidInput();
  }
  const reviews = parseReviews(getOwnDataProperty(value, "reviews"));
  const changesRequested = parseBoolean(
    getOwnDataProperty(value, "changes_requested"),
  );
  const g6Satisfied = parseBoolean(getOwnDataProperty(value, "g6_satisfied"));
  const event = decideEvent(
    runState as RunState,
    mergeMode as MergeMode,
    reviews,
    changesRequested,
    g6Satisfied,
  );
  const nextState =
    event === null
      ? (runState as RunState)
      : transitionRunState(runState as RunState, event);
  return Object.freeze({
    schema_version: 1,
    event,
    next_state: nextState,
    agent_active: nextState === RUN_STATES.IMPLEMENTING,
    run_complete: false,
  });
}
