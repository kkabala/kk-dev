import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  FileEvidenceStore,
  GATE_RESULTS,
  parseSha256Digest,
  RUNNER_ATTEMPTS,
} from "../src/index.ts";
import type {
  EvidenceKey,
  Measurement,
  UncertainEvidenceKey,
} from "../src/index.ts";

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

const evidenceKey = {
  schema_version: 1,
  gate_id: "g2.orders-export",
  template_digest: digestA,
  input_digest: digestB,
  environment_digest: digestC,
  oracle_digest: digestD,
} as const satisfies EvidenceKey;

function measurement(
  id: string,
  overrides: Partial<Measurement> = {},
): Measurement {
  return {
    schema_version: 1,
    id,
    task_id: "TASK-184",
    gate_id: evidenceKey.gate_id,
    measured_sha: "def456",
    base_sha: "abc123",
    policy_digest: digestA,
    runner_digest: digestA,
    template_digest: evidenceKey.template_digest,
    input_digest: evidenceKey.input_digest,
    environment_digest: evidenceKey.environment_digest,
    oracle_digest: evidenceKey.oracle_digest,
    deliberate_attempt: 1,
    outcome: RUNNER_ATTEMPTS.PRODUCT_PASS,
    structured_observations: {},
    artifacts: [],
    runner_identity: "github-actions:exoframe-gates",
    authoritative: false,
    ...overrides,
  };
}

async function sandbox(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), "exoframe-evidence-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const directory = join(root, "store");
  await mkdir(directory, { recursive: true });
  return { directory, store: new FileEvidenceStore(directory) };
}

test("measurements are immutable, idempotent, and conflict on a different body", async (t) => {
  const { directory, store } = await sandbox(t);
  const first = measurement("run-20260831-001");

  const stored = await store.appendAdvisory(first);
  const path = join(directory, "measurements", "run-20260831-001.json");
  const original = await readFile(path, "utf8");

  assert.equal(stored.authoritative, false);
  assert.deepEqual(await store.appendAdvisory(first), stored);
  assert.equal(await readFile(path, "utf8"), original);

  await assert.rejects(
    () =>
      store.appendAdvisory(
        measurement("run-20260831-001", {
          outcome: RUNNER_ATTEMPTS.PRODUCT_FAIL,
        }),
      ),
    /Conflicting evidence record/,
  );
  assert.equal(await readFile(path, "utf8"), original);
});

test("callers cannot write authoritative measurements; the protected runner can", async (t) => {
  const { store } = await sandbox(t);

  await assert.rejects(
    () =>
      store.appendAdvisory(
        measurement("run-20260831-002", { authoritative: true }),
      ),
    {
      name: "TypeError",
      message: "Callers cannot write authoritative measurements",
    },
  );

  const recorded = await store.appendAuthoritative(
    measurement("run-20260831-003", {
      authoritative: true,
      outcome: RUNNER_ATTEMPTS.PRODUCT_PASS,
    }),
  );
  assert.equal(recorded.authoritative, true);
  assert.equal(recorded.outcome, RUNNER_ATTEMPTS.PRODUCT_PASS);
});

test("exact-key reuse succeeds without rewriting the original measurement", async (t) => {
  const { directory, store } = await sandbox(t);
  const recorded = await store.appendAuthoritative(
    measurement("run-20260831-004", { authoritative: true }),
  );
  const original = await readFile(
    join(directory, "measurements", "run-20260831-004.json"),
    "utf8",
  );

  const reused = await store.consult(evidenceKey);
  assert.equal(reused.status, "reused");
  if (reused.status !== "reused") {
    return;
  }
  assert.equal(reused.result, GATE_RESULTS.PASS);
  assert.deepEqual(reused.measurement, recorded);
  assert.equal(reused.decision.kind, "reuse");
  assert.equal(reused.decision.measurement_id, recorded.id);

  assert.equal(
    await readFile(join(directory, "measurements", "run-20260831-004.json"), "utf8"),
    original,
  );
  const decisionBytes = await readFile(
    join(directory, "decisions", `${reused.decision.id}.json`),
    "utf8",
  );
  assert.match(decisionBytes, /"kind": "reuse"/);
});

test("uncertain selection and mismatched keys cannot satisfy a stored gate", async (t) => {
  const { store } = await sandbox(t);
  await store.appendAuthoritative(
    measurement("run-20260831-005", { authoritative: true }),
  );

  const uncertain: UncertainEvidenceKey = {
    kind: "uncertain",
    reason: "uncertain_dependency_selection",
  };
  const stale = await store.consult(uncertain);
  assert.equal(stale.status, "stale");
  if (stale.status !== "stale") {
    return;
  }
  assert.equal(stale.decision.kind, "stale");

  const wrongTemplate = await store.consult({
    ...evidenceKey,
    template_digest: digestC,
  });
  assert.equal(wrongTemplate.status, "missing");

  const wrongInput = await store.consult({
    ...evidenceKey,
    input_digest: digestA,
  });
  assert.equal(wrongInput.status, "missing");
});

test("mixed product outcomes are FLAKY and later green cannot clear them", async (t) => {
  const { store } = await sandbox(t);
  await store.appendAuthoritative(
    measurement("run-20260831-010", {
      authoritative: true,
      deliberate_attempt: 1,
      outcome: RUNNER_ATTEMPTS.PRODUCT_PASS,
    }),
  );
  await store.appendAuthoritative(
    measurement("run-20260831-011", {
      authoritative: true,
      deliberate_attempt: 2,
      outcome: RUNNER_ATTEMPTS.PRODUCT_FAIL,
    }),
  );

  const mixed = await store.consult(evidenceKey);
  assert.equal(mixed.status, "reused");
  if (mixed.status !== "reused") {
    return;
  }
  assert.equal(mixed.result, GATE_RESULTS.FLAKY);

  await store.appendAuthoritative(
    measurement("run-20260831-012", {
      authoritative: true,
      deliberate_attempt: 3,
      outcome: RUNNER_ATTEMPTS.PRODUCT_PASS,
    }),
  );
  const stillFlaky = await store.consult(evidenceKey);
  assert.equal(stillFlaky.status, "reused");
  if (stillFlaky.status !== "reused") {
    return;
  }
  assert.equal(stillFlaky.result, GATE_RESULTS.FLAKY);
  assert.equal(stillFlaky.measurement.id, "run-20260831-010");
});
