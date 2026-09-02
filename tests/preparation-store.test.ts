import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { parseSha256Digest } from "../src/domain.ts";
import { normalizeTask } from "../src/intake.ts";
import { FilePreparationStore } from "../src/preparation-store.ts";

const now = new Date("2026-09-02T08:00:00.000Z");
const facts = {
  schema_version: 1 as const,
  checkout_root: "/tmp/checkout",
  base_ref: "main",
  instruction_paths: Object.freeze(["README.md"]),
  test_command: "npm test",
  build_command: null,
};

function outcome(text: string) {
  return {
    schema_version: 1 as const,
    task_id: "task-prep-store",
    requested_outcome: text,
    source: {
      kind: "direct_text" as const,
      content_digest: parseSha256Digest(
        `sha256:${createHash("sha256").update(text).digest("hex")}`,
      ),
    },
  };
}

test("preparation records are idempotent for the exact snapshot and conflict otherwise", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "exoframe-prep-store-"));
  t.after(async () => rm(sandbox, { recursive: true, force: true }));
  const store = new FilePreparationStore(join(sandbox, "state"));
  const intent = normalizeTask(
    outcome("Add CSV export to the orders page"),
    facts,
    now,
  );
  if ("packet_id" in intent) {
    throw new Error("expected intent");
  }

  assert.deepEqual(await store.saveIntent(intent), intent);
  assert.deepEqual(await store.saveIntent(intent), intent);
  assert.deepEqual(await store.loadIntent("task-prep-store"), intent);

  const mutated = {
    ...intent,
    intent_id: "intent-other",
  };
  await assert.rejects(store.saveIntent(mutated), /conflicting/iu);
  assert.deepEqual(await store.loadIntent("task-prep-store"), intent);
});
