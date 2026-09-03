import assert from "node:assert/strict";
import test from "node:test";

import { PATH_CATEGORIES, RISK_TIERS, evaluateHardening } from "../src/index.ts";

const baseDigest =
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const candidateDigest =
  "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const leak = "ARTIFACT_BYTES_MUST_NOT_LEAK";
const secret = "sk-live-secret-value";

function harden(overrides: Record<string, unknown> = {}) {
  return evaluateHardening({
    trust: {
      base_digest: baseDigest,
      judging_digest: baseDigest,
      candidate_digest: candidateDigest,
      changed_trust_boundary: false,
    },
    scope: {
      requested_path: "src/orders/export.ts",
      affected_surface_paths: ["src/orders/**"],
      known_surface_paths: ["src/orders/**", "src/billing/**"],
      category: PATH_CATEGORIES.PRODUCTION,
      trust_boundary: false,
    },
    secrets: [secret],
    material: {
      parameters: `token=${secret}`,
      output: `printed ${secret}`,
      observation: `saw ${secret}`,
    },
    artifact: {
      relative_path: "screenshots/ok.png",
      bytes: "png-ok",
      symlink_target: null,
    },
    artifact_policy: {
      allowlist: ["screenshots/**"],
      max_artifact_bytes: 64,
      sandbox_root: "/sandbox",
    },
    ...overrides,
  });
}

test("a PR that changes its runner or policy is judged by the accepted base and cannot pass itself", () => {
  const selfPass = harden({
    trust: {
      base_digest: baseDigest,
      judging_digest: candidateDigest,
      candidate_digest: candidateDigest,
      changed_trust_boundary: true,
    },
  });
  assert.equal(selfPass.base_judges_candidate, false);
  assert.equal(selfPass.accepted, false);

  const baseJudges = harden({
    trust: {
      base_digest: baseDigest,
      judging_digest: baseDigest,
      candidate_digest: candidateDigest,
      changed_trust_boundary: true,
    },
  });
  assert.equal(baseJudges.base_judges_candidate, true);
  assert.equal(baseJudges.accepted, true);
});

test("scope expansion inside an affected surface is automatic; unknown production is provisional R2; trust-boundary needs approval", () => {
  const inside = harden();
  assert.equal(inside.scope_decision, "automatic");

  const unknown = harden({
    scope: {
      requested_path: "src/new-service/handler.ts",
      affected_surface_paths: ["src/orders/**"],
      known_surface_paths: ["src/orders/**", "src/billing/**"],
      category: PATH_CATEGORIES.PRODUCTION,
      trust_boundary: false,
    },
  });
  assert.equal(unknown.scope_decision, "provisional_r2");
  assert.equal(unknown.scope_tier, RISK_TIERS.R2);

  const trust = harden({
    scope: {
      requested_path: ".exoframe/policy.yaml",
      affected_surface_paths: ["src/orders/**"],
      known_surface_paths: ["src/orders/**"],
      category: PATH_CATEGORIES.CONTROL_PLANE,
      trust_boundary: true,
    },
  });
  assert.equal(trust.scope_decision, "needs_approval");
});

test("secrets are redacted before storage and rejected artifacts do not leak their content", () => {
  const stored = harden();
  assert.equal(stored.material.parameters.includes(secret), false);
  assert.equal(stored.material.output.includes(secret), false);
  assert.equal(stored.material.observation.includes(secret), false);
  assert.match(stored.material.parameters, /\[REDACTED\]/u);

  const rejected = harden({
    artifact: {
      relative_path: "screenshots/ok.png",
      bytes: leak,
      symlink_target: null,
    },
    artifact_policy: {
      allowlist: ["screenshots/**"],
      max_artifact_bytes: 4,
      sandbox_root: "/sandbox",
    },
  });
  assert.equal(rejected.artifact_accepted, false);
  assert.equal(rejected.artifact_stored, null);
  assert.equal(JSON.stringify(rejected).includes(leak), false);

  const escaped = harden({
    artifact: {
      relative_path: "../outside.png",
      bytes: leak,
      symlink_target: null,
    },
  });
  assert.equal(escaped.artifact_accepted, false);
  assert.equal(JSON.stringify(escaped).includes(leak), false);

  const symlinkEscape = harden({
    artifact: {
      relative_path: "screenshots/ok.png",
      bytes: leak,
      symlink_target: "/sandbox/../etc/passwd",
    },
  });
  assert.equal(symlinkEscape.artifact_accepted, false);
  assert.equal(symlinkEscape.artifact_stored, null);
  assert.equal(JSON.stringify(symlinkEscape).includes(leak), false);
});
