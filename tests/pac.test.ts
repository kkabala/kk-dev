import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  applyIntendedRedOverlay,
  evaluateCandidatePac,
  evaluateIntendedRed,
  lockPac,
  parsePac,
  parseSha256Digest,
  serializeCanonical,
} from "../src/index.ts";
import type { PacRecord } from "../src/index.ts";

const digestA = parseSha256Digest(
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
);
const digestB = parseSha256Digest(
  "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
);
const digestC = parseSha256Digest(
  "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
);
const digestD = parseSha256Digest(
  "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
);

const outcomes = [
  {
    id: "download-succeeds",
    observation: "response_status",
    matcher: "equals",
    expected: 200,
  },
  {
    id: "csv-has-only-header",
    observation: "csv_rows",
    matcher: "equals",
    expected: 1,
  },
] as const;

const draft = {
  schema_version: 1 as const,
  id: "orders-export-empty",
  task_id: "TASK-184",
  surface_id: "orders-export",
  claim: "Empty order history exports a valid CSV containing only headers.",
  outcomes,
  intended_red: ["download-succeeds"],
  template_id: "g2.orders-export",
  artifact_paths: ["tests/acceptance/orders-export.test.ts"],
  base_sha: "abc123",
};

function digestOf(value: unknown) {
  return parseSha256Digest(
    `sha256:${createHash("sha256").update(serializeCanonical(value), "utf8").digest("hex")}`,
  );
}

test("lockPac freezes semantics and oracle digests at the base SHA", () => {
  const locked = lockPac(draft);
  assert.equal(locked.locked_at_base_sha, "abc123");
  assert.equal(
    locked.semantic_digest,
    digestOf({
      id: draft.id,
      task_id: draft.task_id,
      surface_id: draft.surface_id,
      claim: draft.claim,
      outcomes: draft.outcomes,
      intended_red: draft.intended_red,
    }),
  );
  assert.equal(
    locked.oracle_digest,
    digestOf({
      template_id: draft.template_id,
      artifact_paths: draft.artifact_paths,
    }),
  );
  assert.throws(
    () =>
      parsePac({
        ...locked,
        claim: "A different observable meaning.",
      }),
    { name: "TypeError", message: "Invalid PAC input" },
  );
});

test("intended-red overlay is PAC-only and excludes candidate production", () => {
  const locked = lockPac(draft);
  const overlay = applyIntendedRedOverlay({
    pac: locked,
    base_tree: [
      { path: "src/orders/export.ts", digest: digestA, role: "production" },
      { path: "README.md", digest: digestB, role: "other" },
    ],
    candidate_tree: [
      {
        path: "src/orders/export.ts",
        digest: digestC,
        role: "production",
      },
      {
        path: "src/orders/new-export.ts",
        digest: digestD,
        role: "production",
      },
    ],
    overlay_artifacts: [
      {
        path: "tests/acceptance/orders-export.test.ts",
        digest: digestB,
      },
    ],
  });
  assert.equal(
    overlay.tree.some((entry) => entry.path === "src/orders/new-export.ts"),
    false,
  );
  assert.equal(
    overlay.tree.find((entry) => entry.path === "src/orders/export.ts")?.digest,
    digestA,
  );
  assert.equal(
    overlay.tree.find(
      (entry) => entry.path === "tests/acceptance/orders-export.test.ts",
    )?.source,
    "pac",
  );
  assert.equal(overlay.base_sha, "abc123");
  assert.equal(
    overlay.overlay_digest,
    digestOf({
      artifact_paths: locked.artifact_paths,
      artifacts: [
        {
          digest: digestB,
          path: "tests/acceptance/orders-export.test.ts",
        },
      ],
    }),
  );
});

test("intended red is named-outcome fail on base; the same PAC must green on the candidate", () => {
  const locked: PacRecord = lockPac(draft);
  assert.equal(
    evaluateIntendedRed({
      pac: locked,
      setup_succeeded: true,
      named_outcome_ids_failed: ["download-succeeds"],
      import_error: false,
      crash: false,
      timed_out: false,
      unrelated_assertion: false,
      infra_error: false,
    }).status,
    "accepted",
  );
  for (const flags of [
    { import_error: true },
    { crash: true },
    { timed_out: true },
    { unrelated_assertion: true },
    { setup_succeeded: false },
  ] as const) {
    const result = evaluateIntendedRed({
      pac: locked,
      setup_succeeded: true,
      named_outcome_ids_failed: ["download-succeeds"],
      import_error: false,
      crash: false,
      timed_out: false,
      unrelated_assertion: false,
      infra_error: false,
      ...flags,
    });
    assert.equal(result.status, "return_to_author");
    assert.equal(result.assign_pstack, false);
  }
  const wrongRed = evaluateIntendedRed({
    pac: locked,
    setup_succeeded: true,
    named_outcome_ids_failed: ["csv-has-only-header"],
    import_error: false,
    crash: false,
    timed_out: false,
    unrelated_assertion: false,
    infra_error: false,
  });
  assert.equal(wrongRed.status, "return_to_author");
  assert.equal(wrongRed.assign_pstack, false);
  assert.equal(
    evaluateIntendedRed({
      pac: locked,
      setup_succeeded: true,
      named_outcome_ids_failed: [],
      import_error: false,
      crash: false,
      timed_out: false,
      unrelated_assertion: false,
      infra_error: false,
    }).status,
    "already_green",
  );
  assert.equal(
    evaluateIntendedRed({
      pac: locked,
      setup_succeeded: true,
      named_outcome_ids_failed: ["download-succeeds"],
      import_error: false,
      crash: false,
      timed_out: false,
      unrelated_assertion: false,
      infra_error: true,
    }).status,
    "infra",
  );
  const candidate = evaluateCandidatePac({
    pac: locked,
    setup_succeeded: true,
    named_outcome_ids_failed: [],
    import_error: false,
    crash: false,
    timed_out: false,
    unrelated_assertion: false,
    infra_error: false,
  });
  assert.equal(candidate.status, "green");
  assert.equal(candidate.oracle_digest, locked.oracle_digest);
  assert.equal(
    evaluateCandidatePac({
      pac: locked,
      setup_succeeded: true,
      named_outcome_ids_failed: ["download-succeeds"],
      import_error: false,
      crash: false,
      timed_out: false,
      unrelated_assertion: false,
      infra_error: false,
    }).status,
    "return_to_author",
  );
});
