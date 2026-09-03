import assert from "node:assert/strict";
import test from "node:test";

import { GATE_RESULTS, observeDelivery } from "../src/index.ts";

function observe(overrides: Record<string, unknown> = {}) {
  return observeDelivery({
    authenticated: true,
    actor: {
      kind: "release_observer",
      identity: "github-actions:deploy",
    },
    expected_sha: "merged184",
    expected_environment: "prod",
    expected_route: "orders.example.com",
    target: {
      environment: "prod",
      route: "orders.example.com",
      deployed_sha: "merged184",
      healthy: true,
    },
    ...overrides,
  });
}

test("a healthy expected deployment completes G8", () => {
  const result = observe();
  assert.equal(result.g8_result, GATE_RESULTS.PASS);
  assert.equal(result.deployed_sha, "merged184");
  assert.equal(result.authenticated, true);
  assert.equal(result.run_complete, false);
});

test("no delivery target marks G8 not applicable", () => {
  const result = observe({
    expected_environment: null,
    expected_route: null,
    target: null,
  });
  assert.equal(result.g8_result, GATE_RESULTS.NOT_APPLICABLE);
  assert.equal(result.deployed_sha, null);
  assert.equal(result.run_complete, false);
});

test("a deployed SHA or environment mismatch fails G8", () => {
  const sha = observe({
    target: {
      environment: "prod",
      route: "orders.example.com",
      deployed_sha: "other999",
      healthy: true,
    },
  });
  assert.equal(sha.g8_result, GATE_RESULTS.FAIL);
  assert.equal(sha.run_complete, false);

  const environment = observe({
    target: {
      environment: "staging",
      route: "orders.example.com",
      deployed_sha: "merged184",
      healthy: true,
    },
  });
  assert.equal(environment.g8_result, GATE_RESULTS.FAIL);

  assert.throws(
    () =>
      observe({
        authenticated: false,
      }),
    { name: "TypeError", message: "Invalid delivery observation input" },
  );
  assert.throws(
    () =>
      observe({
        actor: {
          kind: "agent",
          identity: "pstack.implementer",
        },
      }),
    { name: "TypeError", message: "Invalid delivery observation input" },
  );
});
