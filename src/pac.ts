import { createHash } from "node:crypto";

import { parseSha256Digest } from "./domain.ts";
import type { Sha256Digest } from "./domain.ts";
import { serializeCanonical } from "./evidence-key.ts";

export type PacOutcome = Readonly<{
  id: string;
  observation: string;
  matcher: "equals";
  expected: string | number | boolean;
}>;

export type PacRecord = Readonly<{
  schema_version: 1;
  id: string;
  task_id: string;
  surface_id: string;
  claim: string;
  outcomes: readonly PacOutcome[];
  intended_red: readonly string[];
  template_id: string;
  artifact_paths: readonly string[];
  semantic_digest: Sha256Digest;
  oracle_digest: Sha256Digest;
  locked_at_base_sha: string;
}>;

export type OverlayEntry = Readonly<{
  path: string;
  digest: Sha256Digest;
  source: "base" | "pac";
}>;

export type IntendedRedOverlay = Readonly<{
  base_sha: string;
  overlay_digest: Sha256Digest;
  tree: readonly OverlayEntry[];
}>;

export type PacRunEvaluation = Readonly<{
  status:
    | "accepted"
    | "return_to_author"
    | "already_green"
    | "infra"
    | "green";
  assign_pstack: boolean;
  oracle_digest: Sha256Digest;
}>;

const draftKeys = [
  "schema_version",
  "id",
  "task_id",
  "surface_id",
  "claim",
  "outcomes",
  "intended_red",
  "template_id",
  "artifact_paths",
  "base_sha",
] as const;
const lockedKeys = [
  "schema_version",
  "id",
  "task_id",
  "surface_id",
  "claim",
  "outcomes",
  "intended_red",
  "template_id",
  "artifact_paths",
  "semantic_digest",
  "oracle_digest",
  "locked_at_base_sha",
] as const;
const outcomeKeys = ["id", "observation", "matcher", "expected"] as const;
const overlayInputKeys = [
  "pac",
  "base_tree",
  "candidate_tree",
  "overlay_artifacts",
] as const;
const treeEntryKeys = ["path", "digest", "role"] as const;
const overlayArtifactKeys = ["path", "digest"] as const;
const evaluationKeys = [
  "pac",
  "setup_succeeded",
  "named_outcome_ids_failed",
  "import_error",
  "crash",
  "timed_out",
  "unrelated_assertion",
  "infra_error",
] as const;

const idPattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u;

function invalidInput(): never {
  throw new TypeError("Invalid PAC input");
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

function parseDigest(value: unknown): Sha256Digest {
  if (typeof value !== "string") {
    invalidInput();
  }
  return parseSha256Digest(value);
}

function parseExpected(value: unknown): string | number | boolean {
  if (typeof value === "string") {
    if (value.length === 0 || value.includes("\0")) {
      invalidInput();
    }
    return value;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  invalidInput();
}

function parseOutcome(value: unknown): PacOutcome {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, outcomeKeys);
  if (getOwnDataProperty(value, "matcher") !== "equals") {
    invalidInput();
  }
  return Object.freeze({
    id: parseId(getOwnDataProperty(value, "id")),
    observation: parseRequiredString(getOwnDataProperty(value, "observation")),
    matcher: "equals",
    expected: parseExpected(getOwnDataProperty(value, "expected")),
  });
}

function parseStringList(
  value: unknown,
  readItem: (item: unknown) => string,
): readonly string[] {
  const captured = captureDenseList(value, readItem);
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

function digestOf(value: unknown): Sha256Digest {
  return parseSha256Digest(
    `sha256:${createHash("sha256").update(serializeCanonical(value), "utf8").digest("hex")}`,
  );
}

function computeDigests(fields: {
  id: string;
  task_id: string;
  surface_id: string;
  claim: string;
  outcomes: readonly PacOutcome[];
  intended_red: readonly string[];
  template_id: string;
  artifact_paths: readonly string[];
}): { semantic_digest: Sha256Digest; oracle_digest: Sha256Digest } {
  return {
    semantic_digest: digestOf({
      id: fields.id,
      task_id: fields.task_id,
      surface_id: fields.surface_id,
      claim: fields.claim,
      outcomes: fields.outcomes,
      intended_red: fields.intended_red,
    }),
    oracle_digest: digestOf({
      template_id: fields.template_id,
      artifact_paths: fields.artifact_paths,
    }),
  };
}

function parseCommon(value: Record<PropertyKey, unknown>): {
  schema_version: 1;
  id: string;
  task_id: string;
  surface_id: string;
  claim: string;
  outcomes: readonly PacOutcome[];
  intended_red: readonly string[];
  template_id: string;
  artifact_paths: readonly string[];
} {
  if (getOwnDataProperty(value, "schema_version") !== 1) {
    invalidInput();
  }
  const outcomes = Object.freeze(
    captureDenseList(getOwnDataProperty(value, "outcomes"), parseOutcome),
  );
  if (outcomes.length === 0) {
    invalidInput();
  }
  const outcomeIds = new Set(outcomes.map((outcome) => outcome.id));
  if (outcomeIds.size !== outcomes.length) {
    invalidInput();
  }
  const intendedRed = parseStringList(
    getOwnDataProperty(value, "intended_red"),
    parseId,
  );
  if (intendedRed.length === 0 || intendedRed.some((id) => !outcomeIds.has(id))) {
    invalidInput();
  }
  return {
    schema_version: 1,
    id: parseId(getOwnDataProperty(value, "id")),
    task_id: parseRequiredString(getOwnDataProperty(value, "task_id")),
    surface_id: parseId(getOwnDataProperty(value, "surface_id")),
    claim: parseRequiredString(getOwnDataProperty(value, "claim")),
    outcomes,
    intended_red: intendedRed,
    template_id: parseId(getOwnDataProperty(value, "template_id")),
    artifact_paths: parseStringList(
      getOwnDataProperty(value, "artifact_paths"),
      parseRelativePath,
    ),
  };
}

function freezePac(
  common: ReturnType<typeof parseCommon>,
  digests: { semantic_digest: Sha256Digest; oracle_digest: Sha256Digest },
  baseSha: string,
): PacRecord {
  return Object.freeze({
    ...common,
    semantic_digest: digests.semantic_digest,
    oracle_digest: digests.oracle_digest,
    locked_at_base_sha: baseSha,
  });
}

export function lockPac(value: unknown): PacRecord {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, draftKeys);
  const common = parseCommon(value);
  return freezePac(
    common,
    computeDigests(common),
    parseRequiredString(getOwnDataProperty(value, "base_sha")),
  );
}

export function parsePac(value: unknown): PacRecord {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, lockedKeys);
  const common = parseCommon(value);
  const digests = computeDigests(common);
  const semantic = parseDigest(getOwnDataProperty(value, "semantic_digest"));
  const oracle = parseDigest(getOwnDataProperty(value, "oracle_digest"));
  if (semantic !== digests.semantic_digest || oracle !== digests.oracle_digest) {
    invalidInput();
  }
  return freezePac(
    common,
    digests,
    parseRequiredString(getOwnDataProperty(value, "locked_at_base_sha")),
  );
}

function parseTreeEntry(value: unknown): {
  path: string;
  digest: Sha256Digest;
  role: "production" | "other";
} {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, treeEntryKeys);
  const role = getOwnDataProperty(value, "role");
  if (role !== "production" && role !== "other") {
    invalidInput();
  }
  return Object.freeze({
    path: parseRelativePath(getOwnDataProperty(value, "path")),
    digest: parseDigest(getOwnDataProperty(value, "digest")),
    role,
  });
}

function parseOverlayArtifact(value: unknown): {
  path: string;
  digest: Sha256Digest;
} {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, overlayArtifactKeys);
  return Object.freeze({
    path: parseRelativePath(getOwnDataProperty(value, "path")),
    digest: parseDigest(getOwnDataProperty(value, "digest")),
  });
}

export function applyIntendedRedOverlay(value: unknown): IntendedRedOverlay {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, overlayInputKeys);
  const pac = parsePac(getOwnDataProperty(value, "pac"));
  const baseTree = captureDenseList(
    getOwnDataProperty(value, "base_tree"),
    parseTreeEntry,
  );
  const candidateTree = captureDenseList(
    getOwnDataProperty(value, "candidate_tree"),
    parseTreeEntry,
  );
  const overlayArtifacts = captureDenseList(
    getOwnDataProperty(value, "overlay_artifacts"),
    parseOverlayArtifact,
  );
  const allowed = new Set(pac.artifact_paths);
  const candidatePaths = new Set<string>();
  const candidateProduction = new Set<string>();
  for (let index = 0; index < candidateTree.length; index += 1) {
    const entry = candidateTree[index];
    if (entry === undefined || candidatePaths.has(entry.path)) {
      invalidInput();
    }
    candidatePaths.add(entry.path);
    if (entry.role === "production") {
      candidateProduction.add(entry.path);
    }
  }

  const tree: OverlayEntry[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < baseTree.length; index += 1) {
    const entry = baseTree[index];
    if (entry === undefined || seen.has(entry.path)) {
      invalidInput();
    }
    seen.add(entry.path);
    tree.push(
      Object.freeze({
        path: entry.path,
        digest: entry.digest,
        source: "base" as const,
      }),
    );
  }
  const overlaySorted = [...overlayArtifacts];
  overlaySorted.sort((left, right) => {
    if (left.path < right.path) {
      return -1;
    }
    if (left.path > right.path) {
      return 1;
    }
    return 0;
  });
  const overlayPaths = new Set<string>();
  for (let index = 0; index < overlaySorted.length; index += 1) {
    const artifact = overlaySorted[index];
    if (
      artifact === undefined ||
      !allowed.has(artifact.path) ||
      overlayPaths.has(artifact.path) ||
      candidateProduction.has(artifact.path)
    ) {
      invalidInput();
    }
    overlayPaths.add(artifact.path);
    const existing = tree.findIndex((entry) => entry.path === artifact.path);
    const next = Object.freeze({
      path: artifact.path,
      digest: artifact.digest,
      source: "pac" as const,
    });
    if (existing >= 0) {
      tree[existing] = next;
    } else {
      tree.push(next);
    }
  }
  if (overlayPaths.size !== allowed.size) {
    invalidInput();
  }
  for (let index = 0; index < tree.length; index += 1) {
    const entry = tree[index];
    if (entry !== undefined && candidateProduction.has(entry.path) && entry.source === "pac") {
      invalidInput();
    }
  }
  tree.sort((left, right) => {
    if (left.path < right.path) {
      return -1;
    }
    if (left.path > right.path) {
      return 1;
    }
    return 0;
  });

  return Object.freeze({
    base_sha: pac.locked_at_base_sha,
    overlay_digest: digestOf({
      artifact_paths: pac.artifact_paths,
      artifacts: overlaySorted.map((artifact) =>
        Object.freeze({
          digest: artifact.digest,
          path: artifact.path,
        }),
      ),
    }),
    tree: Object.freeze(tree),
  });
}

function parseEvaluation(value: unknown): {
  pac: PacRecord;
  setup_succeeded: boolean;
  named_failed: readonly string[];
  import_error: boolean;
  crash: boolean;
  timed_out: boolean;
  unrelated_assertion: boolean;
  infra_error: boolean;
} {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, evaluationKeys);
  const setup = getOwnDataProperty(value, "setup_succeeded");
  const importError = getOwnDataProperty(value, "import_error");
  const crash = getOwnDataProperty(value, "crash");
  const timedOut = getOwnDataProperty(value, "timed_out");
  const unrelated = getOwnDataProperty(value, "unrelated_assertion");
  const infra = getOwnDataProperty(value, "infra_error");
  if (
    typeof setup !== "boolean" ||
    typeof importError !== "boolean" ||
    typeof crash !== "boolean" ||
    typeof timedOut !== "boolean" ||
    typeof unrelated !== "boolean" ||
    typeof infra !== "boolean"
  ) {
    invalidInput();
  }
  return {
    pac: parsePac(getOwnDataProperty(value, "pac")),
    setup_succeeded: setup,
    named_failed: parseStringList(
      getOwnDataProperty(value, "named_outcome_ids_failed"),
      parseId,
    ),
    import_error: importError,
    crash,
    timed_out: timedOut,
    unrelated_assertion: unrelated,
    infra_error: infra,
  };
}

function evaluateRun(
  value: unknown,
  mode: "base" | "candidate",
): PacRunEvaluation {
  const parsed = parseEvaluation(value);
  for (let index = 0; index < parsed.named_failed.length; index += 1) {
    const id = parsed.named_failed[index];
    if (id === undefined || parsed.pac.outcomes.every((outcome) => outcome.id !== id)) {
      invalidInput();
    }
  }
  if (parsed.infra_error) {
    return Object.freeze({
      status: "infra",
      assign_pstack: false,
      oracle_digest: parsed.pac.oracle_digest,
    });
  }
  if (
    !parsed.setup_succeeded ||
    parsed.import_error ||
    parsed.crash ||
    parsed.timed_out ||
    parsed.unrelated_assertion
  ) {
    return Object.freeze({
      status: "return_to_author",
      assign_pstack: false,
      oracle_digest: parsed.pac.oracle_digest,
    });
  }
  const intended = new Set(parsed.pac.intended_red);
  const failed = new Set(parsed.named_failed);
  let namedFailed = false;
  let extraFailed = false;
  for (const id of failed) {
    if (intended.has(id)) {
      namedFailed = true;
    } else {
      extraFailed = true;
    }
  }
  let intendedMissing = false;
  for (let index = 0; index < parsed.pac.intended_red.length; index += 1) {
    const id = parsed.pac.intended_red[index];
    if (id !== undefined && !failed.has(id)) {
      intendedMissing = true;
    }
  }
  if (mode === "candidate") {
    if (namedFailed || extraFailed) {
      return Object.freeze({
        status: "return_to_author",
        assign_pstack: false,
        oracle_digest: parsed.pac.oracle_digest,
      });
    }
    return Object.freeze({
      status: "green",
      assign_pstack: false,
      oracle_digest: parsed.pac.oracle_digest,
    });
  }
  if (extraFailed || (namedFailed && intendedMissing) || !namedFailed) {
    return Object.freeze({
      status: namedFailed || extraFailed ? "return_to_author" : "already_green",
      assign_pstack: false,
      oracle_digest: parsed.pac.oracle_digest,
    });
  }
  return Object.freeze({
    status: "accepted",
    assign_pstack: true,
    oracle_digest: parsed.pac.oracle_digest,
  });
}

export function evaluateIntendedRed(value: unknown): PacRunEvaluation {
  return evaluateRun(value, "base");
}

export function evaluateCandidatePac(value: unknown): PacRunEvaluation {
  return evaluateRun(value, "candidate");
}
