import assert from "node:assert/strict";
import test from "node:test";

import {
  GATE_RESULTS,
  RUN_EVENTS,
  RUN_STATES,
  resolveDeliveryRepair,
} from "../src/index.ts";

function resolve(overrides: Record<string, unknown> = {}) {
  return resolveDeliveryRepair({
    original_task_id: "task-184",
    run_state: RUN_STATES.DELIVERY_VERIFYING,
    g8_result: GATE_RESULTS.FAIL,
    rollback_observed: true,
    linked_repair_task_id: "task-184-repair",
    repair_delivered: false,
    ...overrides,
  });
}

test("an unhealthy delivery invokes rollback and a linked repair", () => {
  const decision = resolve();
  assert.equal(decision.event, RUN_EVENTS.DELIVERY_UNHEALTHY);
  assert.equal(decision.next_state, RUN_STATES.WAITING_FOR_REPAIR);
  assert.equal(decision.rollback_required, true);
  assert.equal(decision.linked_repair_task_id, "task-184-repair");
  assert.equal(decision.run_complete, false);
});

test("the original run waits for the linked repair delivery", () => {
  const waiting = resolve({
    run_state: RUN_STATES.WAITING_FOR_REPAIR,
    g8_result: GATE_RESULTS.FAIL,
  });
  assert.equal(waiting.event, null);
  assert.equal(waiting.next_state, RUN_STATES.WAITING_FOR_REPAIR);
  assert.equal(waiting.linked_repair_task_id, "task-184-repair");
  assert.equal(waiting.run_complete, false);
  assert.equal(waiting.agent_active, false);
});

test("linked repair delivery returns the original run to delivery verification", () => {
  const restored = resolve({
    run_state: RUN_STATES.WAITING_FOR_REPAIR,
    g8_result: GATE_RESULTS.PASS,
    repair_delivered: true,
  });
  assert.equal(restored.event, RUN_EVENTS.REPAIR_DELIVERED);
  assert.equal(restored.next_state, RUN_STATES.DELIVERY_VERIFYING);
  assert.equal(restored.run_complete, false);

  assert.throws(
    () =>
      resolve({
        g8_result: GATE_RESULTS.PASS,
        rollback_observed: true,
      }),
    { name: "TypeError", message: "Invalid delivery repair input" },
  );
});
