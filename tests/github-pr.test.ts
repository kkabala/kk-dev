import assert from "node:assert/strict";
import test from "node:test";

import {
  ENGINEERING_STATUSES,
  syncDraftPullRequest,
} from "../src/index.ts";

function sync(overrides: Record<string, unknown> = {}) {
  return syncDraftPullRequest({
    task_id: "task-184",
    candidate_sha: "def456",
    base_sha: "abc123",
    assigned_number: 184,
    existing_pull_request: null,
    engineering_status: ENGINEERING_STATUSES.WAITING_GATES,
    merge_ready: false,
    ...overrides,
  });
}

test("the first coherent candidate creates a draft GitHub pull request", () => {
  const result = sync();
  assert.equal(result.action, "create");
  assert.deepEqual(result.pull_request, {
    number: 184,
    draft: true,
    head_sha: "def456",
    base_sha: "abc123",
    merged: false,
  });
  assert.equal(result.checks.engineering.name, "exoframe/engineering");
  assert.equal(result.checks.merge_ready.name, "exoframe/merge-ready");
  assert.equal(result.checks.engineering.conclusion, "pending");
  assert.equal(result.checks.merge_ready.conclusion, "pending");
  assert.equal(result.run_complete, false);
});

test("a later candidate updates the same draft pull request", () => {
  const result = sync({
    candidate_sha: "abc999",
    existing_pull_request: {
      number: 184,
      draft: true,
      head_sha: "def456",
      base_sha: "abc123",
      merged: false,
    },
  });
  assert.equal(result.action, "update");
  assert.equal(result.pull_request.number, 184);
  assert.equal(result.pull_request.head_sha, "abc999");
  assert.equal(result.pull_request.draft, true);
  assert.equal(result.run_complete, false);
});

test("a pull request and green engineering check do not complete the run", () => {
  const result = sync({
    existing_pull_request: {
      number: 184,
      draft: true,
      head_sha: "def456",
      base_sha: "abc123",
      merged: false,
    },
    engineering_status: ENGINEERING_STATUSES.ENGINEERING_READY,
    merge_ready: false,
  });
  assert.equal(result.checks.engineering.conclusion, "success");
  assert.equal(result.checks.merge_ready.conclusion, "pending");
  assert.equal(result.run_complete, false);
  assert.equal(result.pull_request.merged, false);
});
