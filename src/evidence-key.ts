import { createHash } from "node:crypto";

import { parseSha256Digest } from "./domain.ts";
import type { Sha256Digest } from "./domain.ts";

export type EvidenceGate = Readonly<{
  gate_id: string;
  template_digest: Sha256Digest;
  oracle_digest: Sha256Digest | null;
}>;

export type CertainRepositoryObject = Readonly<{
  path: string;
  digest: Sha256Digest;
  uncertain?: never;
}>;

export type UncertainRepositoryObject = Readonly<{
  path: string;
  uncertain: true;
  digest?: never;
}>;

export type RepositoryObject = CertainRepositoryObject | UncertainRepositoryObject;

export type CertainNamedArtifact = Readonly<{
  name: string;
  digest: Sha256Digest;
  uncertain?: never;
}>;

export type UncertainNamedArtifact = Readonly<{
  name: string;
  uncertain: true;
  digest?: never;
}>;

export type NamedArtifact = CertainNamedArtifact | UncertainNamedArtifact;

export type RunnerEnvironment = Readonly<{
  runner_image: string;
  toolchain: string;
  capability_profile: string;
  hostname?: string;
  timestamp?: string;
  observed_at?: string;
  now?: string;
  pid?: string;
}>;

export type EvidenceKey = Readonly<{
  schema_version: 1;
  gate_id: string;
  template_digest: Sha256Digest;
  input_digest: Sha256Digest;
  environment_digest: Sha256Digest;
  oracle_digest: Sha256Digest | null;
}>;

export type UncertainEvidenceKey = Readonly<{
  kind: "uncertain";
  reason: "uncertain_dependency_selection";
}>;

export type EvidenceKeyResult = EvidenceKey | UncertainEvidenceKey;

const gateIdPattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u;
const ephemeralEnvironmentKeys = new Set([
  "hostname",
  "now",
  "observed_at",
  "pid",
  "timestamp",
]);
const environmentKeys = [
  "capability_profile",
  "runner_image",
  "toolchain",
] as const;
const gateKeys = ["gate_id", "oracle_digest", "template_digest"] as const;

function invalidInput(): never {
  throw new TypeError("Invalid evidence key input");
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

function assertNonEmptyString(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    invalidInput();
  }
}

function digestUtf8(canonical: string): Sha256Digest {
  return parseSha256Digest(
    `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`,
  );
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

export function serializeCanonical(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      invalidInput();
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const length = getOwnDataProperty(value, "length");
    if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) {
      invalidInput();
    }
    const items: string[] = [];
    for (let index = 0; index < length; index += 1) {
      items[index] = serializeCanonical(getOwnDataProperty(value, index));
    }
    return `[${items.join(",")}]`;
  }
  if (!isPlainObject(value)) {
    invalidInput();
  }
  const keys = ownKeyNames(value).sort(compareUtf8);
  const fields = keys.map(
    (key) =>
      `${JSON.stringify(key)}:${serializeCanonical(getOwnDataProperty(value, key))}`,
  );
  return `{${fields.join(",")}}`;
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

function parseOptionalDigest(value: unknown): Sha256Digest | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    invalidInput();
  }
  return parseSha256Digest(value);
}

function parseGate(value: unknown): EvidenceGate {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, gateKeys);
  const gateId = getOwnDataProperty(value, "gate_id");
  const templateDigest = getOwnDataProperty(value, "template_digest");
  if (typeof gateId !== "string" || !gateIdPattern.test(gateId)) {
    invalidInput();
  }
  if (typeof templateDigest !== "string") {
    invalidInput();
  }
  return Object.freeze({
    gate_id: gateId,
    template_digest: parseSha256Digest(templateDigest),
    oracle_digest: parseOptionalDigest(getOwnDataProperty(value, "oracle_digest")),
  });
}

function parsePathOrName(value: object, key: "path" | "name"): string {
  const token = getOwnDataProperty(value, key);
  assertNonEmptyString(token);
  return token;
}

function parseSelectionEntry(
  value: unknown,
  identityKey: "path" | "name",
): { identity: string; digest: Sha256Digest } | "uncertain" {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  const keys = ownKeyNames(value);
  if (keys.includes("uncertain")) {
    const allowed = [identityKey, "uncertain"];
    assertExactKeys(value, allowed);
    if (getOwnDataProperty(value, "uncertain") !== true) {
      invalidInput();
    }
    parsePathOrName(value, identityKey);
    return "uncertain";
  }
  assertExactKeys(value, [identityKey, "digest"]);
  const digest = getOwnDataProperty(value, "digest");
  if (typeof digest !== "string") {
    invalidInput();
  }
  return {
    identity: parsePathOrName(value, identityKey),
    digest: parseSha256Digest(digest),
  };
}

function captureSelections(
  value: unknown,
  identityKey: "path" | "name",
): { digest: Sha256Digest; identity: string }[] | "uncertain" {
  const captured: { digest: Sha256Digest; identity: string }[] = [];
  const seen = new Set<string>();
  const items = captureDenseList(value, (item) =>
    parseSelectionEntry(item, identityKey),
  );
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item === undefined) {
      invalidInput();
    }
    if (item === "uncertain") {
      return "uncertain";
    }
    if (seen.has(item.identity)) {
      invalidInput();
    }
    seen.add(item.identity);
    captured.push(item);
  }
  captured.sort((left, right) => compareUtf8(left.identity, right.identity));
  return captured;
}

function parseEnvironment(value: unknown): {
  capability_profile: string;
  runner_image: string;
  toolchain: string;
} {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  const keys = ownKeyNames(value);
  for (const key of keys) {
    if (
      !environmentKeys.includes(key as (typeof environmentKeys)[number]) &&
      !ephemeralEnvironmentKeys.has(key)
    ) {
      invalidInput();
    }
  }
  for (const required of environmentKeys) {
    if (!keys.includes(required)) {
      invalidInput();
    }
  }

  const runnerImage = getOwnDataProperty(value, "runner_image");
  const toolchain = getOwnDataProperty(value, "toolchain");
  const capabilityProfile = getOwnDataProperty(value, "capability_profile");
  assertNonEmptyString(runnerImage);
  assertNonEmptyString(toolchain);
  assertNonEmptyString(capabilityProfile);
  return Object.freeze({
    capability_profile: capabilityProfile,
    runner_image: runnerImage,
    toolchain: toolchain,
  });
}

export function isUncertainEvidenceKey(
  value: EvidenceKeyResult,
): value is UncertainEvidenceKey {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    value.kind === "uncertain"
  );
}

export function computeEvidenceKey(
  gate: EvidenceGate,
  tree: readonly RepositoryObject[],
  artifacts: readonly NamedArtifact[],
  environment: RunnerEnvironment,
): EvidenceKeyResult {
  const parsedGate = parseGate(gate);
  const parsedTree = captureSelections(tree, "path");
  const parsedArtifacts = captureSelections(artifacts, "name");
  const parsedEnvironment = parseEnvironment(environment);

  if (parsedTree === "uncertain" || parsedArtifacts === "uncertain") {
    return Object.freeze({
      kind: "uncertain",
      reason: "uncertain_dependency_selection",
    });
  }

  const inputDocument = {
    artifacts: parsedArtifacts.map((artifact) =>
      Object.freeze({
        digest: artifact.digest,
        name: artifact.identity,
      }),
    ),
    tree: parsedTree.map((object) =>
      Object.freeze({
        digest: object.digest,
        path: object.identity,
      }),
    ),
  };

  return Object.freeze({
    schema_version: 1,
    gate_id: parsedGate.gate_id,
    template_digest: parsedGate.template_digest,
    input_digest: digestUtf8(serializeCanonical(inputDocument)),
    environment_digest: digestUtf8(serializeCanonical(parsedEnvironment)),
    oracle_digest: parsedGate.oracle_digest,
  });
}
