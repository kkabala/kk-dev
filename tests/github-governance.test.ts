import assert from "node:assert/strict";
import test from "node:test";

import {
  MERGE_MODES,
  RUN_EVENTS,
  RUN_STATES,
  evaluateGovernance,
} from "../src/index.ts";

function evaluate(overrides: Record<string, unknown> = {}) {
  return evaluateGovernance({
    run_state: RUN_STATES.ENGINEERING_READY,
    merge_mode: MERGE_MODES.HUMAN_MERGE,
    reviews: {
      required_count: 1,
      submitted_count: 0,
      codeowners_satisfied: false,
      approval_fresh: false,
    },
    changes_requested: false,
    g6_satisfied: true,
    ...overrides,
  });
}

test("waiting for a required review persists the run without keeping an agent active", () => {
  const decision = evaluate();
  assert.equal(decision.event, RUN_EVENTS.REVIEW_REQUIRED);
  assert.equal(decision.next_state, RUN_STATES.WAITING_FOR_REVIEW);
  assert.equal(decision.agent_active, false);
  assert.equal(decision.run_complete, false);

  const waiting = evaluate({
    run_state: RUN_STATES.WAITING_FOR_REVIEW,
  });
  assert.equal(waiting.event, null);
  assert.equal(waiting.next_state, RUN_STATES.WAITING_FOR_REVIEW);
  assert.equal(waiting.agent_active, false);
  assert.equal(waiting.run_complete, false);
});

test("review-requested changes return to pstack and replay affected protected gates", () => {
  const decision = evaluate({
    run_state: RUN_STATES.WAITING_FOR_REVIEW,
    changes_requested: true,
    reviews: {
      required_count: 1,
      submitted_count: 1,
      codeowners_satisfied: true,
      approval_fresh: true,
    },
  });
  assert.equal(decision.event, RUN_EVENTS.CHANGES_REQUESTED);
  assert.equal(decision.next_state, RUN_STATES.IMPLEMENTING);
  assert.equal(decision.run_complete, false);
});

test("zero GitHub-required reviewers still waits for human merge authorization", () => {
  const reviews = {
    required_count: 0,
    submitted_count: 0,
    codeowners_satisfied: true,
    approval_fresh: true,
  };
  const mergeReady = evaluate({ reviews });
  assert.equal(mergeReady.event, RUN_EVENTS.REVIEW_NOT_REQUIRED);
  assert.equal(mergeReady.next_state, RUN_STATES.MERGE_READY);
  assert.equal(mergeReady.run_complete, false);

  const waiting = evaluate({
    run_state: RUN_STATES.MERGE_READY,
    reviews,
  });
  assert.equal(waiting.event, RUN_EVENTS.HUMAN_MERGE_REQUIRED);
  assert.equal(waiting.next_state, RUN_STATES.WAITING_FOR_MERGE);
  assert.equal(waiting.agent_active, false);
  assert.equal(waiting.run_complete, false);
});
