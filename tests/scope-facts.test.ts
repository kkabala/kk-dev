import assert from "node:assert/strict";
import test from "node:test";

import {
  applyScopeFacts,
  parseScopeFacts,
  PATH_CATEGORIES,
  RISK_TIERS,
} from "../src/index.ts";
import type { RiskDecision, ScopeFacts } from "../src/index.ts";

const sensitiveOff = {
  money: false,
  auth: false,
  permissions: false,
  persistent_data: false,
  external_api: false,
  infrastructure: false,
};

function factsInput(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    predicted_paths: ["src/local/check.ts"],
    change_types: ["ui"],
    sensitive: { ...sensitiveOff },
    blast_radius: "LOCAL",
    uncertainty: "KNOWN",
    ...overrides,
  };
}

function localR1(): RiskDecision {
  return Object.freeze({
    schema_version: 1,
    overall: RISK_TIERS.R1,
    paths: Object.freeze([
      Object.freeze({
        path: "src/local/check.ts",
        category: PATH_CATEGORIES.PRODUCTION,
        tier: RISK_TIERS.R1,
      }),
    ]),
    policy_weakening: false,
  });
}

function r3Decision(): RiskDecision {
  return Object.freeze({
    schema_version: 1,
    overall: RISK_TIERS.R3,
    paths: Object.freeze([
      Object.freeze({
        path: "src/payments/ledger.ts",
        category: PATH_CATEGORIES.PRODUCTION,
        tier: RISK_TIERS.R3,
      }),
    ]),
    policy_weakening: true,
  });
}

test("parseScopeFacts accepts a valid object", () => {
  const facts = parseScopeFacts(factsInput());
  assert.equal(facts.schema_version, 1);
  assert.deepEqual(facts.predicted_paths, ["src/local/check.ts"]);
  assert.deepEqual(facts.change_types, ["ui"]);
  assert.deepEqual(facts.sensitive, sensitiveOff);
  assert.equal(facts.blast_radius, "LOCAL");
  assert.equal(facts.uncertainty, "KNOWN");
  assert.equal(Object.isFrozen(facts), true);
});

test("parseScopeFacts rejects extra keys, missing keys, duplicate paths, and absolute paths", () => {
  assert.throws(
    () => parseScopeFacts(factsInput({ extra: true })),
    { name: "TypeError", message: "Invalid scope-facts input" },
  );
  assert.throws(
    () =>
      parseScopeFacts({
        schema_version: 1,
        predicted_paths: ["src/local/check.ts"],
        change_types: ["ui"],
        sensitive: { ...sensitiveOff },
        blast_radius: "LOCAL",
      }),
    { name: "TypeError", message: "Invalid scope-facts input" },
  );
  assert.throws(
    () =>
      parseScopeFacts(
        factsInput({ predicted_paths: ["src/a.ts", "src/a.ts"] }),
      ),
    { name: "TypeError", message: "Invalid scope-facts input" },
  );
  assert.throws(
    () => parseScopeFacts(factsInput({ predicted_paths: ["/src/a.ts"] })),
    { name: "TypeError", message: "Invalid scope-facts input" },
  );
  assert.throws(
    () => parseScopeFacts(factsInput({ predicted_paths: [""] })),
    { name: "TypeError", message: "Invalid scope-facts input" },
  );
  assert.throws(
    () =>
      parseScopeFacts(factsInput({ change_types: ["copy", "copy"] })),
    { name: "TypeError", message: "Invalid scope-facts input" },
  );
});

test("applyScopeFacts raises a local R1 decision to R3 when money is true", () => {
  const facts: ScopeFacts = parseScopeFacts(
    factsInput({ sensitive: { ...sensitiveOff, money: true } }),
  );
  const raised = applyScopeFacts(localR1(), facts);
  assert.equal(raised.overall, RISK_TIERS.R3);
  assert.equal(raised.paths[0]?.tier, RISK_TIERS.R1);
  assert.equal(raised.policy_weakening, false);
});

test("applyScopeFacts cannot lower an R3 decision when facts look trivial", () => {
  const facts = parseScopeFacts(
    factsInput({
      predicted_paths: ["README.md"],
      change_types: ["copy"],
      blast_radius: "LOCAL",
      uncertainty: "KNOWN",
    }),
  );
  const kept = applyScopeFacts(r3Decision(), facts);
  assert.equal(kept.overall, RISK_TIERS.R3);
  assert.equal(kept.paths[0]?.tier, RISK_TIERS.R3);
  assert.equal(kept.policy_weakening, true);
});

test("UNKNOWN uncertainty raises R1 to at least R2", () => {
  const facts = parseScopeFacts(factsInput({ uncertainty: "UNKNOWN" }));
  const raised = applyScopeFacts(localR1(), facts);
  assert.equal(raised.overall, RISK_TIERS.R2);
  assert.equal(raised.paths[0]?.tier, RISK_TIERS.R1);
});

test("PARTIALLY_KNOWN increases R1 to R2", () => {
  const facts = parseScopeFacts(
    factsInput({ uncertainty: "PARTIALLY_KNOWN" }),
  );
  const raised = applyScopeFacts(localR1(), facts);
  assert.equal(raised.overall, RISK_TIERS.R2);
  assert.equal(raised.paths[0]?.tier, RISK_TIERS.R1);
});

test("applyScopeFacts rejects invalid facts instead of skipping escalation", () => {
  const facts = factsInput();
  assert.throws(
    () => applyScopeFacts(localR1(), { ...facts, uncertainty: "maybe" }),
    { name: "TypeError", message: "Invalid scope-facts input" },
  );
  assert.throws(
    () => applyScopeFacts(localR1(), { ...facts, extra: true }),
    { name: "TypeError", message: "Invalid scope-facts input" },
  );
});
