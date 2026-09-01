import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveEngineeringStatus,
  ENGINEERING_STATUSES,
  GATE_RESULTS,
  MERGE_MODES,
  RUN_EVENTS,
  RUN_STATES,
  RUNNER_ATTEMPTS,
  transitionRunState,
} from "../src/index.ts";
import type {
  EngineeringStatus,
  EngineeringStatusInput,
  GateResult,
  MergeMode,
  RequiredGateEvaluation,
  RunnerAttempt,
  RunEvent,
  RunState,
} from "../src/index.ts";

const validTransitions = [
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
] as const satisfies readonly (readonly [RunState, RunEvent, RunState])[];

const validTransitionKeys = new Set(
  validTransitions.map(([from, event]) => `${from}\u0000${event}`),
);

if (false) {
  const runnerAttempt: RunnerAttempt = RUNNER_ATTEMPTS.PRODUCT_PASS;
  const gateResult: GateResult = GATE_RESULTS.PASS;
  const engineeringStatus: EngineeringStatus =
    ENGINEERING_STATUSES.ENGINEERING_READY;
  const runEvent: RunEvent = RUN_EVENTS.COHERENT_CANDIDATE;
  const mergeMode: MergeMode = MERGE_MODES.HUMAN_MERGE;
  void runnerAttempt;
  void gateResult;
  void engineeringStatus;
  void runEvent;
  void mergeMode;

  // @ts-expect-error public protocol values must come from the branded catalog
  const rawRunnerAttempt: RunnerAttempt = "PRODUCT_PASS";
  void rawRunnerAttempt;

  // @ts-expect-error public protocol values must come from the branded catalog
  const rawGateResult: GateResult = "PASS";
  void rawGateResult;

  // @ts-expect-error engineering status and run state remain separate despite sharing a label
  const engineeringStatusAsRunState: RunState =
    ENGINEERING_STATUSES.ENGINEERING_READY;
  void engineeringStatusAsRunState;

  // @ts-expect-error runner attempts never become authoritative gate results
  const runnerAttemptAsGateResult: GateResult =
    RUNNER_ATTEMPTS.PRODUCT_PASS;
  void runnerAttemptAsGateResult;

  // @ts-expect-error merge governance is not a run event
  const mergeModeAsRunEvent: RunEvent = MERGE_MODES.HUMAN_MERGE;
  void mergeModeAsRunEvent;
}

test("the public result catalogs remain distinct, complete, and JSON-safe", () => {
  assert.deepEqual(RUNNER_ATTEMPTS, {
    PRODUCT_PASS: "PRODUCT_PASS",
    PRODUCT_FAIL: "PRODUCT_FAIL",
    PRODUCT_TIMEOUT: "PRODUCT_TIMEOUT",
    INFRA_ERROR: "INFRA_ERROR",
  });
  assert.deepEqual(GATE_RESULTS, {
    PASS: "PASS",
    FAIL: "FAIL",
    FLAKY: "FLAKY",
    BLOCKED: "BLOCKED",
    STALE: "STALE",
    NOT_APPLICABLE: "NOT_APPLICABLE",
  });
  assert.deepEqual(ENGINEERING_STATUSES, {
    NOT_EVALUATED: "NOT_EVALUATED",
    WAITING_GATES: "WAITING_GATES",
    FAIL: "FAIL",
    BLOCKED: "BLOCKED",
    NEEDS_HUMAN: "NEEDS_HUMAN",
    ENGINEERING_READY: "ENGINEERING_READY",
    ENGINEERING_READY_WITH_EXCEPTION: "ENGINEERING_READY_WITH_EXCEPTION",
  });
  assert.deepEqual(MERGE_MODES, {
    HUMAN_MERGE: "human_merge",
    GITHUB_AUTO_MERGE: "github_auto_merge",
  });
  assert.deepEqual(RUN_EVENTS, {
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

  for (const catalog of [
    RUNNER_ATTEMPTS,
    GATE_RESULTS,
    ENGINEERING_STATUSES,
    MERGE_MODES,
    RUN_EVENTS,
  ]) {
    assert.equal(Object.isFrozen(catalog), true);
    assert.deepEqual(JSON.parse(JSON.stringify(catalog)), catalog);
  }
});

test("every specified run event produces the exact deterministic next state", () => {
  assert.equal(validTransitions.length, 32);

  for (const [from, event, expected] of validTransitions) {
    assert.equal(transitionRunState(from, event), expected);
    assert.equal(
      transitionRunState(from, event),
      expected,
      `replaying ${from} + ${event} must be deterministic`,
    );
  }
});

test("every state and event pair outside the table fails closed", () => {
  const stateCatalogBefore = JSON.stringify(RUN_STATES);
  const eventCatalogBefore = JSON.stringify(RUN_EVENTS);

  for (const state of Object.values(RUN_STATES)) {
    for (const event of Object.values(RUN_EVENTS)) {
      if (validTransitionKeys.has(`${state}\u0000${event}`)) {
        continue;
      }

      assert.throws(
        () => transitionRunState(state, event),
        (error: unknown) =>
          error instanceof Error &&
          error.message.includes(state) &&
          error.message.includes(event),
        `${state} + ${event} must fail with actionable context`,
      );
    }
  }

  assert.equal(JSON.stringify(RUN_STATES), stateCatalogBefore);
  assert.equal(JSON.stringify(RUN_EVENTS), eventCatalogBefore);
});

test("DONE is terminal for every known event", () => {
  for (const event of Object.values(RUN_EVENTS)) {
    assert.throws(() => transitionRunState(RUN_STATES.DONE, event));
  }
});

test("engineering status follows the specified precedence", () => {
  const cases = [
    {
      name: "unhandled failure beats every lower-priority signal",
      required_gates: [
        { result: GATE_RESULTS.FAIL, covered_by_live_exception: false },
        { result: GATE_RESULTS.BLOCKED, covered_by_live_exception: false },
        { result: GATE_RESULTS.STALE, covered_by_live_exception: false },
        { result: GATE_RESULTS.FAIL, covered_by_live_exception: true },
      ],
      needs_human: true,
      expected: ENGINEERING_STATUSES.FAIL,
    },
    {
      name: "FLAKY is an engineering failure",
      required_gates: [
        { result: GATE_RESULTS.FLAKY, covered_by_live_exception: false },
      ],
      needs_human: false,
      expected: ENGINEERING_STATUSES.FAIL,
    },
    {
      name: "human decision beats blocked, waiting, and exception signals",
      required_gates: [
        { result: GATE_RESULTS.BLOCKED, covered_by_live_exception: false },
        { result: GATE_RESULTS.STALE, covered_by_live_exception: false },
        { result: GATE_RESULTS.FAIL, covered_by_live_exception: true },
      ],
      needs_human: true,
      expected: ENGINEERING_STATUSES.NEEDS_HUMAN,
    },
    {
      name: "blocked prerequisite beats waiting and exception signals",
      required_gates: [
        { result: GATE_RESULTS.BLOCKED, covered_by_live_exception: false },
        { result: GATE_RESULTS.STALE, covered_by_live_exception: false },
        { result: GATE_RESULTS.FAIL, covered_by_live_exception: true },
      ],
      needs_human: false,
      expected: ENGINEERING_STATUSES.BLOCKED,
    },
    {
      name: "missing or stale evidence beats a live exception",
      required_gates: [
        { result: null, covered_by_live_exception: false },
        { result: GATE_RESULTS.STALE, covered_by_live_exception: false },
        { result: GATE_RESULTS.FAIL, covered_by_live_exception: true },
      ],
      needs_human: false,
      expected: ENGINEERING_STATUSES.WAITING_GATES,
    },
    {
      name: "a live exception permits readiness without rewriting its gate",
      required_gates: [
        { result: GATE_RESULTS.PASS, covered_by_live_exception: false },
        { result: GATE_RESULTS.FAIL, covered_by_live_exception: true },
      ],
      needs_human: false,
      expected: ENGINEERING_STATUSES.ENGINEERING_READY_WITH_EXCEPTION,
    },
    {
      name: "a live accepted gap covers unavailable measurement",
      required_gates: [
        { result: null, covered_by_live_exception: true },
        { result: GATE_RESULTS.STALE, covered_by_live_exception: true },
      ],
      needs_human: false,
      expected: ENGINEERING_STATUSES.ENGINEERING_READY_WITH_EXCEPTION,
    },
    {
      name: "authoritative pass and not-applicable results are ready",
      required_gates: [
        { result: GATE_RESULTS.PASS, covered_by_live_exception: false },
        {
          result: GATE_RESULTS.NOT_APPLICABLE,
          covered_by_live_exception: false,
        },
      ],
      needs_human: false,
      expected: ENGINEERING_STATUSES.ENGINEERING_READY,
    },
    {
      name: "no evaluated requirements falls back to not evaluated",
      required_gates: [],
      needs_human: false,
      expected: ENGINEERING_STATUSES.NOT_EVALUATED,
    },
  ] as const;

  for (const scenario of cases) {
    const status = deriveEngineeringStatus({
      required_gates: scenario.required_gates,
      needs_human: scenario.needs_human,
    });

    assert.equal(status, scenario.expected, scenario.name);
  }
});

test("a live exception never rewrites the underlying gate result", () => {
  const coveredFailure = Object.freeze({
    result: GATE_RESULTS.FAIL,
    covered_by_live_exception: true,
  });
  const requiredGates = Object.freeze([coveredFailure]);

  assert.equal(
    deriveEngineeringStatus({
      required_gates: requiredGates,
      needs_human: false,
    }),
    ENGINEERING_STATUSES.ENGINEERING_READY_WITH_EXCEPTION,
  );
  assert.equal(coveredFailure.result, GATE_RESULTS.FAIL);
  assert.deepEqual(requiredGates, [
    {
      result: GATE_RESULTS.FAIL,
      covered_by_live_exception: true,
    },
  ]);
});

test("the engineering evaluator rejects malformed JavaScript inputs", () => {
  const invalidInputs = [
    {
      required_gates: [
        {
          result: GATE_RESULTS.FAIL,
          covered_by_live_exception: "false",
        },
      ],
      needs_human: false,
    },
    {
      required_gates: [
        {
          result: "UNKNOWN",
          covered_by_live_exception: true,
        },
      ],
      needs_human: false,
    },
    {
      required_gates: [],
      needs_human: "false",
    },
    {
      required_gates: null,
      needs_human: false,
    },
  ] as const;

  for (const invalidInput of invalidInputs) {
    assert.throws(
      () =>
        deriveEngineeringStatus(
          invalidInput as unknown as EngineeringStatusInput,
        ),
      {
        name: "TypeError",
      },
      "invalid runtime values must not produce an engineering status",
    );
  }
});

test("the engineering evaluator rejects dynamic accessors before evaluation", () => {
  let resultReads = 0;
  const unstableGate = Object.defineProperties({}, {
    result: {
      enumerable: true,
      get: () => {
        resultReads += 1;
        return resultReads <= 2 ? GATE_RESULTS.PASS : "UNKNOWN";
      },
    },
    covered_by_live_exception: {
      enumerable: true,
      value: false,
    },
  });

  assert.throws(
    () =>
      deriveEngineeringStatus({
        required_gates: [
          unstableGate as unknown as RequiredGateEvaluation,
        ],
        needs_human: false,
      }),
    {
      name: "TypeError",
    },
  );
  assert.equal(resultReads, 0, "validation must not invoke external accessors");
});

test("the engineering evaluator owns dense traversal of required gates", () => {
  const sparseRequiredGates = new Array<RequiredGateEvaluation>(1);
  assert.throws(
    () =>
      deriveEngineeringStatus({
        required_gates: sparseRequiredGates,
        needs_human: false,
      }),
    {
      name: "TypeError",
    },
    "a sparse requirement list must not become ready through a vacuous check",
  );

  const requiredGates = [
    {
      result: GATE_RESULTS.FAIL,
      covered_by_live_exception: false,
    },
  ];
  Object.defineProperty(requiredGates, "map", {
    value: () => [],
  });

  assert.equal(
    deriveEngineeringStatus({
      required_gates: requiredGates,
      needs_human: false,
    }),
    ENGINEERING_STATUSES.FAIL,
    "caller-owned array methods must not hide required failures",
  );

  const lengthMutatingGates: RequiredGateEvaluation[] = [
    {
      result: GATE_RESULTS.PASS,
      covered_by_live_exception: false,
    },
    {
      result: GATE_RESULTS.FAIL,
      covered_by_live_exception: false,
    },
  ];
  Object.defineProperty(lengthMutatingGates, 0, {
    configurable: true,
    get: () => {
      lengthMutatingGates.length = 1;
      return {
        result: GATE_RESULTS.PASS,
        covered_by_live_exception: false,
      };
    },
  });
  assert.throws(
    () =>
      deriveEngineeringStatus({
        required_gates: lengthMutatingGates,
        needs_human: false,
      }),
    {
      name: "TypeError",
    },
    "element accessors must not hide later required gates",
  );
  assert.equal(lengthMutatingGates.length, 2);

  const crossMutatingGate = {
    covered_by_live_exception: false,
  } as {
    result: GateResult;
    covered_by_live_exception: boolean;
  };
  let crossMutatingReads = 0;
  Object.defineProperty(crossMutatingGate, "result", {
    enumerable: true,
    get: () => {
      crossMutatingReads += 1;
      crossMutatingGate.covered_by_live_exception = true;
      return GATE_RESULTS.FAIL;
    },
  });
  assert.throws(
    () =>
      deriveEngineeringStatus({
        required_gates: [crossMutatingGate],
        needs_human: false,
      }),
    {
      name: "TypeError",
    },
    "one gate field must not rewrite a sibling during validation",
  );
  assert.equal(crossMutatingReads, 0);
  assert.equal(crossMutatingGate.covered_by_live_exception, false);
});
