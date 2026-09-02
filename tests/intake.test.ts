import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { parseSha256Digest } from "../src/domain.ts";
import type { Task } from "../src/domain.ts";
import {
  discoverRepositoryFacts,
  isIntakePacket,
  normalizeTask,
} from "../src/intake.ts";
import type { RepositoryFacts } from "../src/intake.ts";

const execFileAsync = promisify(execFile);

function task(taskId: string, requestedOutcome: string): Task {
  return {
    schema_version: 1,
    task_id: taskId,
    requested_outcome: requestedOutcome,
    source: {
      kind: "direct_text",
      content_digest: parseSha256Digest(
        `sha256:${createHash("sha256").update(requestedOutcome).digest("hex")}`,
      ),
    },
  };
}

function facts(overrides: Partial<RepositoryFacts> = {}): RepositoryFacts {
  return {
    schema_version: 1,
    checkout_root: "/tmp/checkout",
    base_ref: "main",
    instruction_paths: ["README.md"],
    test_command: "npm test",
    build_command: "npm run build",
    ...overrides,
  };
}

test("discoverRepositoryFacts reads checkout commands and instructions without asking", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "exoframe-intake-facts-"));
  t.after(async () => rm(sandbox, { recursive: true, force: true }));
  await mkdir(sandbox, { recursive: true });
  await execFileAsync("git", ["init", "--quiet"], { cwd: sandbox });
  await writeFile(
    join(sandbox, "package.json"),
    `${JSON.stringify({
      name: "fixture",
      scripts: { test: "node --test", build: "tsc -p tsconfig.build.json" },
    }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(join(sandbox, "README.md"), "# Fixture\n", "utf8");
  await writeFile(join(sandbox, "AGENTS.md"), "# Agents\n", "utf8");

  const observed = await discoverRepositoryFacts(sandbox);

  assert.equal(observed.schema_version, 1);
  assert.equal(observed.checkout_root, await realpath(sandbox));
  assert.notEqual(observed.base_ref, "unversioned-working-tree");
  assert.deepEqual(observed.instruction_paths, ["AGENTS.md", "README.md"]);
  assert.equal(observed.test_command, "node --test");
  assert.equal(observed.build_command, "tsc -p tsconfig.build.json");
});

test("a clear task normalizes intent from repository facts", () => {
  const now = new Date("2026-09-02T08:00:00.000Z");
  const selected = task("task-clear-intake", "Add CSV export to the orders page");
  const decision = normalizeTask(selected, facts(), now);

  assert.equal(isIntakePacket(decision), false);
  if (isIntakePacket(decision)) {
    return;
  }
  assert.equal(decision.task_id, selected.task_id);
  assert.deepEqual(decision.goals, [selected.requested_outcome]);
  assert.deepEqual(decision.unresolved_decisions, []);
  assert.equal(
    decision.constraints.includes(
      "Do not ask a human for discoverable repository facts.",
    ),
    true,
  );
  assert.equal(
    decision.constraints.includes("Use the discovered base main."),
    true,
  );
  assert.equal(
    decision.constraints.includes("Use the existing test command npm test."),
    true,
  );
});

test("an ambiguous product choice emits one batched decision packet", () => {
  const now = new Date("2026-09-02T08:00:00.000Z");
  const selected = task(
    "task-ambiguous-intake",
    "Should the orders export be CSV or XLSX?",
  );
  const decision = normalizeTask(selected, facts(), now);

  assert.equal(isIntakePacket(decision), true);
  if (!isIntakePacket(decision)) {
    return;
  }
  assert.equal(decision.subject.kind, "task");
  assert.equal(decision.request.kind, "product_decision");
  assert.equal(decision.request.related_questions.length, 1);
  assert.deepEqual(decision.request.related_questions[0]?.alternatives, [
    "CSV",
    "XLSX",
  ]);
  assert.equal(decision.expires_at, "2026-09-03T08:00:00.000Z");
  assert.equal(decision.required_approver_identity, "user:task-author");
});

test("normalizeTask captures task and repository facts at the call boundary", () => {
  const now = new Date("2026-09-02T08:00:00.000Z");
  const selected = task("task-boundary-intake", "Add CSV export to the orders page");
  const mutableTask = {
    ...selected,
    requested_outcome: selected.requested_outcome,
  };
  const mutableFacts = {
    ...facts(),
    instruction_paths: ["README.md"],
    test_command: "npm test",
  };
  const decision = normalizeTask(mutableTask, mutableFacts, now);
  mutableTask.requested_outcome = "Mutated after normalizeTask was called";
  mutableFacts.test_command = "rm -rf /";
  mutableFacts.instruction_paths.push("SECRET.md");

  assert.equal(isIntakePacket(decision), false);
  if (isIntakePacket(decision)) {
    return;
  }
  assert.deepEqual(decision.goals, ["Add CSV export to the orders page"]);
  assert.equal(
    decision.constraints.includes("Use the existing test command npm test."),
    true,
  );
  assert.equal(
    decision.constraints.some((constraint) => constraint.includes("SECRET.md")),
    false,
  );
});
