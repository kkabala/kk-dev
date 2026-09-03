import assert from "node:assert/strict";
import test from "node:test";

import { MERGE_MODES, parseGithubState } from "../src/index.ts";

const authenticated = {
  authenticated: true,
  actor: {
    kind: "github_app",
    identity: "github-app:exoframe",
  },
  repository: {
    owner: "acme",
    name: "orders",
  },
  pull_request: {
    number: 184,
    draft: true,
    head_sha: "def456",
    base_sha: "abc123",
    merged: false,
  },
  checks: {
    engineering: "pending",
    merge_ready: null,
  },
  reviews: {
    required_count: 1,
    submitted_count: 0,
    codeowners_satisfied: false,
    approval_fresh: false,
  },
  queue: {
    present: false,
    candidate_sha: null,
  },
  merge: {
    mode: MERGE_MODES.HUMAN_MERGE,
    merged_sha: null,
  },
};

test("authenticated GitHub observations parse into a frozen provider state", () => {
  const state = parseGithubState(authenticated);
  assert.equal(state.schema_version, 1);
  assert.equal(state.authenticated, true);
  assert.deepEqual(state.actor, authenticated.actor);
  assert.deepEqual(state.pull_request, authenticated.pull_request);
  assert.equal(state.merge.mode, MERGE_MODES.HUMAN_MERGE);
  assert.equal(state.merge.merged_sha, null);
  assert.equal(Object.isFrozen(state), true);
});

test("unauthenticated GitHub observations cannot become provider state", () => {
  assert.throws(
    () =>
      parseGithubState({
        ...authenticated,
        authenticated: false,
      }),
    { name: "TypeError", message: "Invalid GitHub provider input" },
  );
  assert.throws(
    () =>
      parseGithubState({
        ...authenticated,
        actor: {
          kind: "agent",
          identity: "pstack.implementer",
        },
      }),
    { name: "TypeError", message: "Invalid GitHub provider input" },
  );
});

test("an agent cannot supply a merged SHA or claim to merge directly", () => {
  assert.throws(
    () =>
      parseGithubState({
        ...authenticated,
        merge: {
          mode: MERGE_MODES.HUMAN_MERGE,
          merged_sha: "landed789",
        },
      }),
    { name: "TypeError", message: "Invalid GitHub provider input" },
  );
  const merged = parseGithubState({
    ...authenticated,
    pull_request: {
      ...authenticated.pull_request,
      draft: false,
      merged: true,
    },
    merge: {
      mode: MERGE_MODES.HUMAN_MERGE,
      merged_sha: "landed789",
    },
  });
  assert.equal(merged.pull_request?.merged, true);
  assert.equal(merged.merge.merged_sha, "landed789");
});
