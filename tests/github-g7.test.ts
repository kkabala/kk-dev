import assert from "node:assert/strict";
import test from "node:test";

import { GATE_RESULTS, resolveMergeCandidate } from "../src/index.ts";

const tree =
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const otherTree =
  "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function resolve(overrides: Record<string, unknown> = {}) {
  return resolveMergeCandidate({
    queue_present: true,
    queue_candidate_sha: "queue184",
    base_sha: null,
    head_sha: null,
    merge_method: null,
    candidate_tree_digest: null,
    bound: null,
    g7_result: GATE_RESULTS.FAIL,
    landed_tree_digest: null,
    ...overrides,
  });
}

const tuple = {
  queue_present: false,
  queue_candidate_sha: null,
  base_sha: "abc123",
  head_sha: "def456",
  merge_method: "squash",
  candidate_tree_digest: tree,
  g7_result: null,
  landed_tree_digest: null,
};

test("G7 evaluates an exact queue-generated candidate and failure returns to pstack", () => {
  const result = resolve();
  assert.deepEqual(result.identity, {
    kind: "queue",
    candidate_sha: "queue184",
  });
  assert.equal(result.stale, false);
  assert.equal(result.return_to_pstack, true);
  assert.equal(result.run_complete, false);
});

test("without a queue, G7 binds base SHA, head SHA, merge method, and candidate tree", () => {
  const squash = resolve(tuple);
  const rebase = resolve({ ...tuple, merge_method: "rebase" });
  assert.deepEqual(squash.identity, {
    kind: "tuple",
    base_sha: "abc123",
    head_sha: "def456",
    merge_method: "squash",
    candidate_tree_digest: tree,
  });
  assert.deepEqual(rebase.identity, {
    kind: "tuple",
    base_sha: "abc123",
    head_sha: "def456",
    merge_method: "rebase",
    candidate_tree_digest: tree,
  });
  assert.notDeepEqual(squash.identity, rebase.identity);
  assert.equal(squash.stale, false);
  assert.equal(squash.return_to_pstack, false);
  assert.equal(squash.run_complete, false);
});

test("a changed tuple makes G7 stale and the landed tree must match", () => {
  const bound = {
    kind: "tuple",
    base_sha: "abc123",
    head_sha: "def456",
    merge_method: "squash",
    candidate_tree_digest: tree,
  };
  const stale = resolve({
    ...tuple,
    bound,
    head_sha: "abc999",
    g7_result: GATE_RESULTS.PASS,
  });
  assert.equal(stale.stale, true);
  assert.equal(stale.return_to_pstack, true);
  assert.equal(stale.run_complete, false);

  const landed = resolve({
    ...tuple,
    bound,
    g7_result: GATE_RESULTS.PASS,
    landed_tree_digest: tree,
  });
  assert.equal(landed.stale, false);
  assert.equal(landed.return_to_pstack, false);

  assert.throws(
    () =>
      resolve({
        ...tuple,
        bound,
        g7_result: GATE_RESULTS.PASS,
        landed_tree_digest: otherTree,
      }),
    { name: "TypeError", message: "Invalid merge candidate input" },
  );
});
