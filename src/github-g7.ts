import { parseSha256Digest } from "./domain.ts";
import type { Sha256Digest } from "./domain.ts";
import { GATE_RESULTS } from "./run-state.ts";

export const MERGE_METHODS = Object.freeze({
  MERGE: "merge",
  SQUASH: "squash",
  REBASE: "rebase",
} as const);

export type MergeMethod = (typeof MERGE_METHODS)[keyof typeof MERGE_METHODS];

export type QueueMergeCandidate = Readonly<{
  kind: "queue";
  candidate_sha: string;
}>;

export type TupleMergeCandidate = Readonly<{
  kind: "tuple";
  base_sha: string;
  head_sha: string;
  merge_method: MergeMethod;
  candidate_tree_digest: Sha256Digest;
}>;

export type MergeCandidateIdentity = QueueMergeCandidate | TupleMergeCandidate;

export type MergeCandidateDecision = Readonly<{
  schema_version: 1;
  identity: MergeCandidateIdentity;
  stale: boolean;
  return_to_pstack: boolean;
  run_complete: false;
}>;

const inputKeys = [
  "queue_present",
  "queue_candidate_sha",
  "base_sha",
  "head_sha",
  "merge_method",
  "candidate_tree_digest",
  "bound",
  "g7_result",
  "landed_tree_digest",
] as const;
const queueIdentityKeys = ["kind", "candidate_sha"] as const;
const tupleIdentityKeys = [
  "kind",
  "base_sha",
  "head_sha",
  "merge_method",
  "candidate_tree_digest",
] as const;
const knownMethods = new Set<unknown>(Object.values(MERGE_METHODS));
const knownResults = new Set<unknown>([GATE_RESULTS.PASS, GATE_RESULTS.FAIL]);

function invalidInput(): never {
  throw new TypeError("Invalid merge candidate input");
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

function parseBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") {
    invalidInput();
  }
  return value;
}

function parseRequiredString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
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

function parseDigest(value: unknown): Sha256Digest {
  if (typeof value !== "string") {
    invalidInput();
  }
  try {
    return parseSha256Digest(value);
  } catch {
    invalidInput();
  }
}

function parseOptionalDigest(value: unknown): Sha256Digest | null {
  if (value === null) {
    return null;
  }
  return parseDigest(value);
}

function parseMergeMethod(value: unknown): MergeMethod {
  if (!knownMethods.has(value)) {
    invalidInput();
  }
  return value as MergeMethod;
}

function identitiesEqual(
  left: MergeCandidateIdentity,
  right: MergeCandidateIdentity,
): boolean {
  if (left.kind === "queue" && right.kind === "queue") {
    return left.candidate_sha === right.candidate_sha;
  }
  if (left.kind === "tuple" && right.kind === "tuple") {
    return (
      left.base_sha === right.base_sha &&
      left.head_sha === right.head_sha &&
      left.merge_method === right.merge_method &&
      left.candidate_tree_digest === right.candidate_tree_digest
    );
  }
  return false;
}

function parseQueueIdentity(value: object): QueueMergeCandidate {
  assertExactKeys(value, queueIdentityKeys);
  if (getOwnDataProperty(value, "kind") !== "queue") {
    invalidInput();
  }
  return Object.freeze({
    kind: "queue",
    candidate_sha: parseRequiredString(getOwnDataProperty(value, "candidate_sha")),
  });
}

function parseTupleIdentity(value: object): TupleMergeCandidate {
  assertExactKeys(value, tupleIdentityKeys);
  if (getOwnDataProperty(value, "kind") !== "tuple") {
    invalidInput();
  }
  return Object.freeze({
    kind: "tuple",
    base_sha: parseRequiredString(getOwnDataProperty(value, "base_sha")),
    head_sha: parseRequiredString(getOwnDataProperty(value, "head_sha")),
    merge_method: parseMergeMethod(getOwnDataProperty(value, "merge_method")),
    candidate_tree_digest: parseDigest(
      getOwnDataProperty(value, "candidate_tree_digest"),
    ),
  });
}

function parseBound(value: unknown): MergeCandidateIdentity | null {
  if (value === null) {
    return null;
  }
  if (!isPlainObject(value)) {
    invalidInput();
  }
  const kind = getOwnDataProperty(value, "kind");
  if (kind === "queue") {
    return parseQueueIdentity(value);
  }
  if (kind === "tuple") {
    return parseTupleIdentity(value);
  }
  invalidInput();
}

function parseG7Result(value: unknown): typeof GATE_RESULTS.PASS | typeof GATE_RESULTS.FAIL | null {
  if (value === null) {
    return null;
  }
  if (!knownResults.has(value)) {
    invalidInput();
  }
  return value as typeof GATE_RESULTS.PASS | typeof GATE_RESULTS.FAIL;
}

function bindIdentity(input: {
  queuePresent: boolean;
  queueCandidateSha: string | null;
  baseSha: string | null;
  headSha: string | null;
  mergeMethod: unknown;
  candidateTreeDigest: unknown;
}): MergeCandidateIdentity {
  if (input.queuePresent) {
    if (
      input.queueCandidateSha === null ||
      input.baseSha !== null ||
      input.headSha !== null ||
      input.mergeMethod !== null ||
      input.candidateTreeDigest !== null
    ) {
      invalidInput();
    }
    return Object.freeze({
      kind: "queue",
      candidate_sha: input.queueCandidateSha,
    });
  }
  if (
    input.queueCandidateSha !== null ||
    input.baseSha === null ||
    input.headSha === null ||
    input.mergeMethod === null ||
    input.candidateTreeDigest === null
  ) {
    invalidInput();
  }
  return Object.freeze({
    kind: "tuple",
    base_sha: input.baseSha,
    head_sha: input.headSha,
    merge_method: parseMergeMethod(input.mergeMethod),
    candidate_tree_digest: parseDigest(input.candidateTreeDigest),
  });
}

export function resolveMergeCandidate(value: unknown): MergeCandidateDecision {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, inputKeys);
  const queuePresent = parseBoolean(getOwnDataProperty(value, "queue_present"));
  const identity = bindIdentity({
    queuePresent,
    queueCandidateSha: parseOptionalString(
      getOwnDataProperty(value, "queue_candidate_sha"),
    ),
    baseSha: parseOptionalString(getOwnDataProperty(value, "base_sha")),
    headSha: parseOptionalString(getOwnDataProperty(value, "head_sha")),
    mergeMethod: getOwnDataProperty(value, "merge_method"),
    candidateTreeDigest: getOwnDataProperty(value, "candidate_tree_digest"),
  });
  const bound = parseBound(getOwnDataProperty(value, "bound"));
  const g7Result = parseG7Result(getOwnDataProperty(value, "g7_result"));
  const landedTree = parseOptionalDigest(
    getOwnDataProperty(value, "landed_tree_digest"),
  );
  const stale = bound !== null && !identitiesEqual(bound, identity);
  if (landedTree !== null) {
    if (
      identity.kind !== "tuple" ||
      g7Result !== GATE_RESULTS.PASS ||
      stale ||
      landedTree !== identity.candidate_tree_digest
    ) {
      invalidInput();
    }
  }
  return Object.freeze({
    schema_version: 1,
    identity,
    stale,
    return_to_pstack: stale || g7Result === GATE_RESULTS.FAIL,
    run_complete: false,
  });
}
