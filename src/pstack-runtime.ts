import { parseSha256Digest } from "./domain.ts";
import type { Sha256Digest } from "./domain.ts";
import type { AdvisoryArtifact, BoundArtifact } from "./protected-runner.ts";

export type PstackRuntime = Readonly<{
  schema_version: 1;
  granted_capability_ids: readonly string[];
  artifacts: readonly BoundArtifact[];
  advisory_artifacts: readonly AdvisoryArtifact[];
}>;

const inputKeys = [
  "supported_capability_ids",
  "required_capability_ids",
  "protected_runner",
  "artifacts",
] as const;
const runnerKeys = ["runner_identity", "measured_sha", "gate_id"] as const;
const artifactKeys = [
  "path",
  "digest",
  "runner_identity",
  "measured_sha",
  "gate_id",
] as const;
const idPattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u;

function invalidInput(): never {
  throw new TypeError("Invalid pstack runtime input");
}

function missingCapability(ids: readonly string[]): never {
  throw new TypeError(`Missing required pstack capability: ${ids.join(", ")}`);
}

function getOwnDataProperty(object: object, key: PropertyKey): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (descriptor === undefined || !("value" in descriptor)) {
    invalidInput();
  }
  return descriptor.value;
}

function ownKeyNames(value: object): string[] {
  return Reflect.ownKeys(value).map((key) => {
    if (typeof key !== "string") {
      invalidInput();
    }
    return key;
  });
}

function isPlainObject(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactKeys(value: object, expected: readonly string[]): void {
  const keys = ownKeyNames(value);
  const expectedKeys = new Set(expected);
  if (
    keys.length !== expected.length ||
    keys.some((key) => !expectedKeys.has(key)) ||
    expected.some((key) => !keys.includes(key))
  ) {
    invalidInput();
  }
}

function captureDenseList<Item>(
  value: unknown,
  readItem: (item: unknown) => Item,
): Item[] {
  if (!Array.isArray(value)) {
    invalidInput();
  }
  const length = getOwnDataProperty(value, "length");
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) {
    invalidInput();
  }
  const captured: Item[] = [];
  for (let index = 0; index < length; index += 1) {
    captured[index] = readItem(getOwnDataProperty(value, index));
  }
  return captured;
}

function compareUtf8(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function parseRequiredString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    invalidInput();
  }
  return value;
}

function parseId(value: unknown): string {
  if (typeof value !== "string" || !idPattern.test(value)) {
    invalidInput();
  }
  return value;
}

function parseOptionalString(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  return parseRequiredString(value);
}

function parseRelativePath(value: unknown): string {
  const token = parseRequiredString(value);
  if (token.startsWith("/") || token.includes("\\")) {
    invalidInput();
  }
  const segments = token.split("/");
  if (
    segments.length === 0 ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    invalidInput();
  }
  return token;
}

function parseIdList(value: unknown): readonly string[] {
  const captured = captureDenseList(value, parseId);
  const seen = new Set<string>();
  for (let index = 0; index < captured.length; index += 1) {
    const item = captured[index];
    if (item === undefined || seen.has(item)) {
      invalidInput();
    }
    seen.add(item);
  }
  return Object.freeze(captured);
}

function parseProtectedRunner(value: unknown): {
  runner_identity: string;
  measured_sha: string;
  gate_id: string;
} {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, runnerKeys);
  return {
    runner_identity: parseRequiredString(getOwnDataProperty(value, "runner_identity")),
    measured_sha: parseRequiredString(getOwnDataProperty(value, "measured_sha")),
    gate_id: parseId(getOwnDataProperty(value, "gate_id")),
  };
}

function parseObservedArtifact(value: unknown): {
  path: string;
  digest: Sha256Digest;
  runner_identity: string | null;
  measured_sha: string | null;
  gate_id: string | null;
} {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, artifactKeys);
  const digest = getOwnDataProperty(value, "digest");
  if (typeof digest !== "string") {
    invalidInput();
  }
  const gateId = getOwnDataProperty(value, "gate_id");
  return {
    path: parseRelativePath(getOwnDataProperty(value, "path")),
    digest: parseSha256Digest(digest),
    runner_identity: parseOptionalString(getOwnDataProperty(value, "runner_identity")),
    measured_sha: parseOptionalString(getOwnDataProperty(value, "measured_sha")),
    gate_id: gateId === null ? null : parseId(gateId),
  };
}

export function resolvePstackRuntime(value: unknown): PstackRuntime {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, inputKeys);
  const supported = parseIdList(getOwnDataProperty(value, "supported_capability_ids"));
  const required = parseIdList(getOwnDataProperty(value, "required_capability_ids"));
  const protectedRunner = parseProtectedRunner(
    getOwnDataProperty(value, "protected_runner"),
  );
  const observed = captureDenseList(
    getOwnDataProperty(value, "artifacts"),
    parseObservedArtifact,
  );

  const supportedSet = new Set(supported);
  const missing: string[] = [];
  const granted: string[] = [];
  for (let index = 0; index < required.length; index += 1) {
    const id = required[index];
    if (id === undefined) {
      invalidInput();
    }
    if (!supportedSet.has(id)) {
      missing.push(id);
    } else {
      granted.push(id);
    }
  }
  if (missing.length > 0) {
    missing.sort(compareUtf8);
    missingCapability(missing);
  }
  granted.sort(compareUtf8);

  const bound: BoundArtifact[] = [];
  const advisory: AdvisoryArtifact[] = [];
  const seenPaths = new Set<string>();
  for (let index = 0; index < observed.length; index += 1) {
    const artifact = observed[index];
    if (artifact === undefined || seenPaths.has(artifact.path)) {
      invalidInput();
    }
    seenPaths.add(artifact.path);
    if (
      artifact.runner_identity === protectedRunner.runner_identity &&
      artifact.measured_sha === protectedRunner.measured_sha &&
      artifact.gate_id === protectedRunner.gate_id
    ) {
      bound.push(
        Object.freeze({
          path: artifact.path,
          digest: artifact.digest,
          runner_identity: artifact.runner_identity,
          measured_sha: artifact.measured_sha,
          gate_id: artifact.gate_id,
        }),
      );
    } else {
      advisory.push(
        Object.freeze({
          path: artifact.path,
          digest: artifact.digest,
          reason: "missing_provenance",
        }),
      );
    }
  }
  bound.sort((left, right) => compareUtf8(left.path, right.path));
  advisory.sort((left, right) => compareUtf8(left.path, right.path));

  return Object.freeze({
    schema_version: 1,
    granted_capability_ids: Object.freeze(granted),
    artifacts: Object.freeze(bound),
    advisory_artifacts: Object.freeze(advisory),
  });
}
