import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  computeEvidenceKey,
  isUncertainEvidenceKey,
  parseSha256Digest,
  serializeCanonical,
} from "../src/index.ts";
import type {
  EvidenceGate,
  EvidenceKey,
  NamedArtifact,
  RepositoryObject,
  RunnerEnvironment,
} from "../src/index.ts";

const templateDigest = parseSha256Digest(
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
);
const oracleDigest = parseSha256Digest(
  "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
);
const exportDigest = parseSha256Digest(
  "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
);
const screenshotDigest = parseSha256Digest(
  "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
);
const otherFileDigest = parseSha256Digest(
  "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
);

const gate = {
  gate_id: "g2.orders-export",
  template_digest: templateDigest,
  oracle_digest: oracleDigest,
} as const satisfies EvidenceGate;

const tree = [
  {
    path: "src/orders/export.ts",
    digest: exportDigest,
  },
] as const satisfies readonly RepositoryObject[];

const artifacts = [
  {
    name: "screenshots/empty-export.png",
    digest: screenshotDigest,
  },
] as const satisfies readonly NamedArtifact[];

const environment = {
  capability_profile: "linux-x64",
  runner_image: "ghcr.io/exoframe/gates:1",
  toolchain: "node-22.18",
} as const satisfies RunnerEnvironment;

const canonicalInputJson =
  '{"artifacts":[{"digest":"sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","name":"screenshots/empty-export.png"}],"tree":[{"digest":"sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","path":"src/orders/export.ts"}]}';

const canonicalEnvironmentJson =
  '{"capability_profile":"linux-x64","runner_image":"ghcr.io/exoframe/gates:1","toolchain":"node-22.18"}';

function digestJson(canonical: string) {
  return parseSha256Digest(
    `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`,
  );
}

const expectedKey = {
  schema_version: 1,
  gate_id: "g2.orders-export",
  template_digest: templateDigest,
  input_digest: digestJson(canonicalInputJson),
  environment_digest: digestJson(canonicalEnvironmentJson),
  oracle_digest: oracleDigest,
} as const satisfies EvidenceKey;

if (false) {
  const uncertainWithDigest = {
    path: "src/orders/export.ts",
    digest: exportDigest,
    uncertain: true,
  } as const;
  // @ts-expect-error uncertain objects cannot carry a selected digest
  const invalidUncertain: RepositoryObject = uncertainWithDigest;
  void invalidUncertain;

  const environmentWithHostname = {
    ...environment,
    hostname: "runner-7",
  } as const;
  const typedEnvironment: RunnerEnvironment = environmentWithHostname;
  void typedEnvironment;
}

test("computeEvidenceKey matches golden canonical vectors", () => {
  assert.equal(
    serializeCanonical({
      artifacts: [
        { digest: screenshotDigest, name: "screenshots/empty-export.png" },
      ],
      tree: [{ digest: exportDigest, path: "src/orders/export.ts" }],
    }),
    canonicalInputJson,
  );
  assert.equal(serializeCanonical(environment), canonicalEnvironmentJson);

  const result = computeEvidenceKey(gate, tree, artifacts, environment);
  assert.equal(isUncertainEvidenceKey(result), false);
  if (isUncertainEvidenceKey(result)) {
    return;
  }

  assert.deepEqual(result, expectedKey);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(
    serializeCanonical(result),
    serializeCanonical(expectedKey),
  );
});

test("ephemeral hostname and timestamp do not change the evidence key", () => {
  const withEphemeral = computeEvidenceKey(gate, tree, artifacts, {
    ...environment,
    hostname: "runner-7.internal",
    timestamp: "2026-09-02T12:00:00.000Z",
  });
  const withoutEphemeral = computeEvidenceKey(gate, tree, artifacts, environment);

  assert.equal(isUncertainEvidenceKey(withEphemeral), false);
  assert.deepEqual(withEphemeral, withoutEphemeral);
  assert.deepEqual(withEphemeral, expectedKey);
});

test("a change to gate, template, input, environment, or oracle produces a new key", () => {
  const baseline = computeEvidenceKey(gate, tree, artifacts, environment);
  assert.equal(isUncertainEvidenceKey(baseline), false);

  const variants = [
    computeEvidenceKey(
      { ...gate, gate_id: "g1.lint" },
      tree,
      artifacts,
      environment,
    ),
    computeEvidenceKey(
      { ...gate, template_digest: otherFileDigest },
      tree,
      artifacts,
      environment,
    ),
    computeEvidenceKey(
      { ...gate, oracle_digest: otherFileDigest },
      tree,
      artifacts,
      environment,
    ),
    computeEvidenceKey(
      { ...gate, oracle_digest: null },
      tree,
      artifacts,
      environment,
    ),
    computeEvidenceKey(
      gate,
      [{ path: "src/orders/export.ts", digest: otherFileDigest }],
      artifacts,
      environment,
    ),
    computeEvidenceKey(gate, tree, [], environment),
    computeEvidenceKey(gate, tree, artifacts, {
      ...environment,
      toolchain: "node-22.19",
    }),
  ];

  const serialized = new Set(
    [baseline, ...variants].map((value) => serializeCanonical(value)),
  );
  assert.equal(serialized.size, 8);
});

test("uncertain dependency selection cannot produce an evidence key", () => {
  const uncertainTree = computeEvidenceKey(
    gate,
    [{ path: "src/orders/export.ts", uncertain: true }],
    artifacts,
    environment,
  );
  const uncertainArtifact = computeEvidenceKey(
    gate,
    tree,
    [{ name: "screenshots/empty-export.png", uncertain: true }],
    environment,
  );

  assert.equal(isUncertainEvidenceKey(uncertainTree), true);
  assert.equal(isUncertainEvidenceKey(uncertainArtifact), true);
  assert.deepEqual(uncertainTree, {
    kind: "uncertain",
    reason: "uncertain_dependency_selection",
  });
});

test("the calculator owns dense captured fields and rejects accessors", () => {
  let pathReads = 0;
  const accessorTree = [
    Object.defineProperties({}, {
      path: {
        enumerable: true,
        get: () => {
          pathReads += 1;
          return "src/orders/export.ts";
        },
      },
      digest: {
        enumerable: true,
        value: exportDigest,
      },
    }),
  ];

  assert.throws(
    () => computeEvidenceKey(gate, accessorTree as unknown as RepositoryObject[], artifacts, environment),
    {
      name: "TypeError",
      message: "Invalid evidence key input",
    },
  );
  assert.equal(pathReads, 0, "validation must not invoke external accessors");

  const sparseTree = new Array<RepositoryObject>(1);
  assert.throws(
    () => computeEvidenceKey(gate, sparseTree, artifacts, environment),
    {
      name: "TypeError",
      message: "Invalid evidence key input",
    },
  );
});
