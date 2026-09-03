import assert from "node:assert/strict";
import test from "node:test";

import {
  parseSha256Digest,
  resolvePstackRuntime,
} from "../src/index.ts";

const digestA = parseSha256Digest(
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
);
const digestB = parseSha256Digest(
  "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
);

const protectedRunner = {
  runner_identity: "github-actions:exoframe-gates",
  measured_sha: "def456",
  gate_id: "g4.orders-export-browser",
};

function resolve(overrides: Record<string, unknown> = {}) {
  return resolvePstackRuntime({
    supported_capability_ids: [
      "engine.pstack",
      "runtime.browser",
      "runtime.cli",
      "runtime.control",
      "skills.poteto-mode",
    ],
    required_capability_ids: ["runtime.browser", "runtime.control"],
    protected_runner: protectedRunner,
    artifacts: [
      {
        path: "artifacts/trace.json",
        digest: digestA,
        runner_identity: protectedRunner.runner_identity,
        measured_sha: protectedRunner.measured_sha,
        gate_id: protectedRunner.gate_id,
      },
      {
        path: "artifacts/screenshot.png",
        digest: digestB,
        runner_identity: "pstack.implementer",
        measured_sha: null,
        gate_id: null,
      },
    ],
    ...overrides,
  });
}

test("declared browser and runtime-control capabilities are granted only from public support", () => {
  const runtime = resolve();
  assert.deepEqual(runtime.granted_capability_ids, [
    "runtime.browser",
    "runtime.control",
  ]);
  assert.equal(runtime.schema_version, 1);
  assert.throws(
    () =>
      resolve({
        supported_capability_ids: ["engine.pstack", "skills.poteto-mode"],
      }),
    {
      name: "TypeError",
      message:
        "Missing required pstack capability: runtime.browser, runtime.control",
    },
  );
});

test("declared CLI runtime is granted when present and fails closed when undeclared", () => {
  const runtime = resolve({
    required_capability_ids: ["runtime.cli"],
    artifacts: [],
  });
  assert.deepEqual(runtime.granted_capability_ids, ["runtime.cli"]);
  assert.throws(
    () =>
      resolve({
        required_capability_ids: ["runtime.cli", "runtime.undocumented-debugger"],
        artifacts: [],
      }),
    {
      name: "TypeError",
      message: "Missing required pstack capability: runtime.undocumented-debugger",
    },
  );
});

test("pstack runtime artifacts stay advisory until the protected runner binds them", () => {
  const runtime = resolve();
  assert.deepEqual(runtime.artifacts, [
    {
      path: "artifacts/trace.json",
      digest: digestA,
      runner_identity: protectedRunner.runner_identity,
      measured_sha: protectedRunner.measured_sha,
      gate_id: protectedRunner.gate_id,
    },
  ]);
  assert.deepEqual(runtime.advisory_artifacts, [
    {
      path: "artifacts/screenshot.png",
      digest: digestB,
      reason: "missing_provenance",
    },
  ]);
});
