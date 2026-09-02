import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveVerificationBoundaries,
  RISK_TIERS,
} from "../src/index.ts";

const identities = {
  acceptance_author: "author.orders-export",
  independent_verifier: "verifier.orders-export",
  implementer: "pstack.implementer",
};

const authorAllowlist = ["tests/acceptance/**", "schemas/**"];

function resolve(overrides: Record<string, unknown> = {}) {
  return resolveVerificationBoundaries({
    task_id: "task-184",
    g2_required: true,
    independent_verifier_required: true,
    behavior_preserving: false,
    new_acceptance_claim: true,
    overall: RISK_TIERS.R2,
    identities,
    author_writable_allowlist: authorAllowlist,
    author_proposed_paths: ["tests/acceptance/orders-export.test.ts"],
    harness_proposal: {
      source: "independent_verifier",
      measured_by_protected_runner: false,
      harness_accepted: false,
    },
    ...overrides,
  });
}

test("G2 dispatches a distinct acceptance author that cannot implement and may write only PAC artifacts", () => {
  const decision = resolve();
  assert.equal(decision.acceptance_author.dispatched, true);
  assert.equal(decision.acceptance_author.identity, identities.acceptance_author);
  assert.deepEqual(decision.acceptance_author.writable_paths, authorAllowlist);
  assert.equal(decision.implementer.identity, identities.implementer);
  assert.notEqual(
    decision.acceptance_author.identity,
    decision.implementer.identity,
  );
  assert.throws(
    () =>
      resolve({
        identities: {
          ...identities,
          acceptance_author: identities.implementer,
        },
      }),
    { name: "TypeError", message: "Invalid verification input" },
  );
  assert.throws(
    () =>
      resolve({
        author_proposed_paths: ["src/orders/export.ts"],
      }),
    { name: "TypeError", message: "Invalid verification input" },
  );
});

test("R0 and behavior-preserving work without a new acceptance claim do not dispatch the author", () => {
  const docs = resolve({
    g2_required: false,
    independent_verifier_required: false,
    behavior_preserving: true,
    new_acceptance_claim: false,
    overall: RISK_TIERS.R0,
    author_proposed_paths: [],
    harness_proposal: null,
  });
  assert.equal(docs.acceptance_author.dispatched, false);
  assert.equal(docs.acceptance_author.identity, null);
  assert.deepEqual(docs.acceptance_author.writable_paths, []);
  assert.equal(docs.independent_verifier.dispatched, false);

  const preserving = resolve({
    independent_verifier_required: false,
    behavior_preserving: true,
    new_acceptance_claim: false,
    overall: RISK_TIERS.R1,
    author_proposed_paths: [],
    harness_proposal: null,
  });
  assert.equal(preserving.acceptance_author.dispatched, false);
  assert.equal(preserving.independent_verifier.dispatched, false);
});

test("independent-verifier prose stays advisory until the protected runner measures an accepted harness", () => {
  const advisory = resolve();
  assert.equal(advisory.independent_verifier.dispatched, true);
  assert.equal(advisory.independent_verifier.identity, identities.independent_verifier);
  assert.equal(advisory.independent_verifier.findings_authoritative, false);
  assert.equal(advisory.implementer.may_relock_oracle, false);

  const measured = resolve({
    harness_proposal: {
      source: "independent_verifier",
      measured_by_protected_runner: true,
      harness_accepted: true,
    },
  });
  assert.equal(measured.independent_verifier.findings_authoritative, true);

  const implementerProse = resolve({
    harness_proposal: {
      source: "implementer",
      measured_by_protected_runner: true,
      harness_accepted: true,
    },
  });
  assert.equal(implementerProse.independent_verifier.findings_authoritative, false);

  const r1 = resolve({
    independent_verifier_required: false,
    overall: RISK_TIERS.R1,
    author_proposed_paths: [],
    harness_proposal: null,
  });
  assert.equal(r1.implementer.may_relock_oracle, true);
  assert.equal(r1.independent_verifier.dispatched, false);
  assert.throws(
    () =>
      resolve({
        independent_verifier_required: false,
        overall: RISK_TIERS.R2,
      }),
    { name: "TypeError", message: "Invalid verification input" },
  );
});
