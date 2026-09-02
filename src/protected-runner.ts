import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

import { parseSha256Digest } from "./domain.ts";
import type { Sha256Digest } from "./domain.ts";
import { serializeCanonical } from "./evidence-key.ts";
import { FileEvidenceStore } from "./evidence-store.ts";
import type { Measurement } from "./evidence-store.ts";
import { isResolvedProtectedCommand } from "./gate-template.ts";
import type { ResolvedProtectedCommand } from "./gate-template.ts";
import { isRunCatalogIdentifier } from "./run-catalog.ts";
import { GATE_RESULTS, RUNNER_ATTEMPTS } from "./run-state.ts";
import type { GateResult, RunnerAttempt } from "./run-state.ts";

export const DEFAULT_INFRASTRUCTURE_RETRIES = 2;
export const DEFAULT_MAX_ARTIFACT_BYTES = 5_242_880;

export type ObservedArtifact = Readonly<{
  relative_path: string;
  bytes: string;
  symlink_target: string | null;
  runner_identity: string | null;
  measured_sha: string | null;
  gate_id: string | null;
}>;

export type RunnerObservation = Readonly<{
  stdout: string;
  stderr: string;
  exit_code: number | null;
  timed_out: boolean;
  sandbox_error: string | null;
  artifacts: readonly ObservedArtifact[];
}>;

export type ArtifactPolicy = Readonly<{
  artifact_allowlist: readonly string[];
  writable_roots: readonly string[];
  sandbox_root: string;
  max_artifact_bytes: number;
  runner_identity: string;
  measured_sha: string;
  gate_id: string;
}>;

export type BoundArtifact = Readonly<{
  path: string;
  digest: Sha256Digest;
  runner_identity: string;
  measured_sha: string;
  gate_id: string;
}>;

export type AdvisoryArtifact = Readonly<{
  path: string;
  digest: Sha256Digest;
  reason: "missing_provenance";
}>;

export type ParsedRunnerAttempt = Readonly<{
  outcome: RunnerAttempt;
  redacted_stdout: string;
  redacted_stderr: string;
  output_digest: Sha256Digest;
  artifacts: readonly BoundArtifact[];
  advisory_artifacts: readonly AdvisoryArtifact[];
}>;

export type ExecuteProtectedCommand = (
  command: ResolvedProtectedCommand,
  context: Readonly<{ sandbox_root: string }>,
) => Promise<unknown>;

export type ProtectedRunRequest = Readonly<{
  task_id: string;
  measured_sha: string;
  base_sha: string;
  policy_digest: Sha256Digest;
  runner_digest: Sha256Digest;
  template_digest: Sha256Digest;
  input_digest: Sha256Digest;
  environment_digest: Sha256Digest;
  oracle_digest: Sha256Digest | null;
  sandbox_root: string;
  evidence_store: FileEvidenceStore;
  execute: ExecuteProtectedCommand;
  secrets: readonly string[];
  infrastructure_retries: number;
  max_artifact_bytes: number;
  runner_identity: string;
}>;

export type RunnerSessionResult = Readonly<{
  status: "measured" | "blocked";
  gate_result: GateResult | null;
  bounce: null;
  measurements: readonly Measurement[];
  redacted_stdout: string;
  redacted_stderr: string;
  output_digest: Sha256Digest;
  advisory_artifacts: readonly AdvisoryArtifact[];
}>;

const observationKeys = [
  "stdout",
  "stderr",
  "exit_code",
  "timed_out",
  "sandbox_error",
  "artifacts",
] as const;

const observedArtifactKeys = [
  "relative_path",
  "bytes",
  "symlink_target",
  "runner_identity",
  "measured_sha",
  "gate_id",
] as const;

const policyKeys = [
  "artifact_allowlist",
  "writable_roots",
  "sandbox_root",
  "max_artifact_bytes",
  "runner_identity",
  "measured_sha",
  "gate_id",
] as const;

const requestKeys = [
  "task_id",
  "measured_sha",
  "base_sha",
  "policy_digest",
  "runner_digest",
  "template_digest",
  "input_digest",
  "environment_digest",
  "oracle_digest",
  "sandbox_root",
  "evidence_store",
  "execute",
  "secrets",
  "infrastructure_retries",
  "max_artifact_bytes",
  "runner_identity",
] as const;

const rawCommandKeys = new Set([
  "argv",
  "authoritative",
  "cmd",
  "command",
  "command_text",
  "raw",
  "script",
  "shell",
  "stdin",
]);

const productOutcomes = new Set<unknown>([
  RUNNER_ATTEMPTS.PRODUCT_PASS,
  RUNNER_ATTEMPTS.PRODUCT_FAIL,
]);

function invalidObservation(): never {
  throw new TypeError("Invalid runner observation");
}

function invalidPolicy(): never {
  throw new TypeError("Invalid artifact policy");
}

function invalidRequest(): never {
  throw new TypeError("Invalid protected run request");
}

function rawCommand(): never {
  throw new TypeError("Raw command is not allowed");
}

function getOwnDataProperty(
  object: object,
  key: PropertyKey,
  invalid: () => never,
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (descriptor === undefined || !("value" in descriptor)) {
    invalid();
  }
  return descriptor.value;
}

function ownKeyNames(value: object, invalid: () => never): string[] {
  return Reflect.ownKeys(value).map((key) => {
    if (typeof key !== "string") {
      invalid();
    }
    return key;
  });
}

function isPlainObject(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactKeys(
  value: object,
  expected: readonly string[],
  invalid: () => never,
): void {
  const keys = ownKeyNames(value, invalid);
  const expectedKeys = new Set(expected);
  const extraKeys = keys.filter((key) => !expectedKeys.has(key));
  if (extraKeys.some((key) => rawCommandKeys.has(key))) {
    rawCommand();
  }
  if (
    extraKeys.length > 0 ||
    expected.some((key) => !keys.includes(key)) ||
    keys.length !== expected.length
  ) {
    invalid();
  }
}

function captureDenseList<Item>(
  value: unknown,
  readItem: (item: unknown) => Item,
  invalid: () => never,
): Item[] {
  if (!Array.isArray(value)) {
    invalid();
  }
  const length = getOwnDataProperty(value, "length", invalid);
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) {
    invalid();
  }
  const captured: Item[] = [];
  for (let index = 0; index < length; index += 1) {
    captured[index] = readItem(getOwnDataProperty(value, index, invalid));
  }
  return captured;
}

function captureStringArray(value: unknown, invalid: () => never): string[] {
  return captureDenseList(
    value,
    (item) => {
      if (typeof item !== "string" || item.includes("\0")) {
        invalid();
      }
      return item;
    },
    invalid,
  );
}

function digestUtf8(value: string): Sha256Digest {
  return parseSha256Digest(
    `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`,
  );
}

function posixPath(value: string): string {
  return value.replaceAll("\\", "/");
}

function isInsideRoot(root: string, candidate: string): boolean {
  const resolvedRoot = path.posix.resolve(posixPath(root));
  const resolvedCandidate = path.posix.resolve(posixPath(candidate));
  return (
    resolvedCandidate === resolvedRoot ||
    resolvedCandidate.startsWith(`${resolvedRoot}/`)
  );
}

function matchesGlob(pattern: string, relativePath: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/gu, "\\$&");
  const regexSource = escaped
    .replaceAll("**", "\0")
    .replaceAll("*", "[^/]*")
    .replaceAll("\0", ".*");
  return new RegExp(`^${regexSource}$`, "u").test(relativePath);
}

function isUnderPrefix(relativePath: string, prefix: string): boolean {
  return relativePath === prefix || relativePath.startsWith(`${prefix}/`);
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

export function redactText(value: string, secrets: readonly string[]): string {
  const ordered: string[] = [];
  for (let index = 0; index < secrets.length; index += 1) {
    const secret = secrets[index];
    if (secret !== undefined && secret.length > 0) {
      ordered.push(secret);
    }
  }
  ordered.sort(
    (left, right) => right.length - left.length || compareUtf8(left, right),
  );
  let redacted = value;
  for (let index = 0; index < ordered.length; index += 1) {
    const secret = ordered[index];
    if (secret === undefined) {
      continue;
    }
    redacted = redacted.split(secret).join("[REDACTED]");
  }
  return redacted;
}

function parseOptionalString(
  value: unknown,
  invalid: () => never,
): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string" || value.includes("\0")) {
    invalid();
  }
  return value;
}

function parseRequiredString(value: unknown, invalid: () => never): string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    invalid();
  }
  return value;
}

function parseObservedArtifact(value: unknown): ObservedArtifact {
  if (!isPlainObject(value)) {
    invalidObservation();
  }
  assertExactKeys(value, observedArtifactKeys, invalidObservation);
  const relativePath = parseRequiredString(
    getOwnDataProperty(value, "relative_path", invalidObservation),
    invalidObservation,
  );
  const bytes = getOwnDataProperty(value, "bytes", invalidObservation);
  if (typeof bytes !== "string") {
    invalidObservation();
  }
  return Object.freeze({
    relative_path: relativePath,
    bytes,
    symlink_target: parseOptionalString(
      getOwnDataProperty(value, "symlink_target", invalidObservation),
      invalidObservation,
    ),
    runner_identity: parseOptionalString(
      getOwnDataProperty(value, "runner_identity", invalidObservation),
      invalidObservation,
    ),
    measured_sha: parseOptionalString(
      getOwnDataProperty(value, "measured_sha", invalidObservation),
      invalidObservation,
    ),
    gate_id: parseOptionalString(
      getOwnDataProperty(value, "gate_id", invalidObservation),
      invalidObservation,
    ),
  });
}

function parseObservation(value: unknown): RunnerObservation {
  if (!isPlainObject(value)) {
    invalidObservation();
  }
  assertExactKeys(value, observationKeys, invalidObservation);
  const stdout = getOwnDataProperty(value, "stdout", invalidObservation);
  const stderr = getOwnDataProperty(value, "stderr", invalidObservation);
  const exitCode = getOwnDataProperty(value, "exit_code", invalidObservation);
  const timedOut = getOwnDataProperty(value, "timed_out", invalidObservation);
  const sandboxError = getOwnDataProperty(
    value,
    "sandbox_error",
    invalidObservation,
  );
  if (typeof stdout !== "string" || typeof stderr !== "string") {
    invalidObservation();
  }
  if (typeof timedOut !== "boolean") {
    invalidObservation();
  }
  if (
    exitCode !== null &&
    (typeof exitCode !== "number" || !Number.isSafeInteger(exitCode))
  ) {
    invalidObservation();
  }
  if (
    sandboxError !== null &&
    (typeof sandboxError !== "string" || sandboxError.includes("\0"))
  ) {
    invalidObservation();
  }
  return Object.freeze({
    stdout,
    stderr,
    exit_code: exitCode,
    timed_out: timedOut,
    sandbox_error: sandboxError,
    artifacts: Object.freeze(
      captureDenseList(
        getOwnDataProperty(value, "artifacts", invalidObservation),
        parseObservedArtifact,
        invalidObservation,
      ),
    ),
  });
}

function parsePolicy(value: unknown): ArtifactPolicy {
  if (!isPlainObject(value)) {
    invalidPolicy();
  }
  assertExactKeys(value, policyKeys, invalidPolicy);
  const maxArtifactBytes = getOwnDataProperty(
    value,
    "max_artifact_bytes",
    invalidPolicy,
  );
  if (
    typeof maxArtifactBytes !== "number" ||
    !Number.isSafeInteger(maxArtifactBytes) ||
    maxArtifactBytes <= 0
  ) {
    invalidPolicy();
  }
  return Object.freeze({
    artifact_allowlist: Object.freeze(
      captureStringArray(
        getOwnDataProperty(value, "artifact_allowlist", invalidPolicy),
        invalidPolicy,
      ),
    ),
    writable_roots: Object.freeze(
      captureStringArray(
        getOwnDataProperty(value, "writable_roots", invalidPolicy),
        invalidPolicy,
      ),
    ),
    sandbox_root: parseRequiredString(
      getOwnDataProperty(value, "sandbox_root", invalidPolicy),
      invalidPolicy,
    ),
    max_artifact_bytes: maxArtifactBytes,
    runner_identity: parseRequiredString(
      getOwnDataProperty(value, "runner_identity", invalidPolicy),
      invalidPolicy,
    ),
    measured_sha: parseRequiredString(
      getOwnDataProperty(value, "measured_sha", invalidPolicy),
      invalidPolicy,
    ),
    gate_id: parseRequiredString(
      getOwnDataProperty(value, "gate_id", invalidPolicy),
      invalidPolicy,
    ),
  });
}

function pathEscapes(relativePath: string): boolean {
  if (
    relativePath.startsWith("/") ||
    relativePath.includes("\\") ||
    relativePath.includes("\0")
  ) {
    return true;
  }
  const segments = relativePath.split("/");
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment === undefined || segment.length === 0 || segment === "..") {
      return true;
    }
  }
  return false;
}

function matchesAllowlist(
  relativePath: string,
  allowlist: readonly string[],
): boolean {
  for (let index = 0; index < allowlist.length; index += 1) {
    const pattern = allowlist[index];
    if (pattern !== undefined && matchesGlob(pattern, relativePath)) {
      return true;
    }
  }
  return false;
}

function underWritableRoot(
  relativePath: string,
  writableRoots: readonly string[],
): boolean {
  for (let index = 0; index < writableRoots.length; index += 1) {
    const root = writableRoots[index];
    if (root !== undefined && isUnderPrefix(relativePath, root)) {
      return true;
    }
  }
  return false;
}

function symlinkEscapes(
  sandboxRoot: string,
  relativePath: string,
  symlinkTarget: string,
): boolean {
  const resolved = path.posix.resolve(
    posixPath(sandboxRoot),
    path.posix.dirname(relativePath),
    posixPath(symlinkTarget),
  );
  return !isInsideRoot(sandboxRoot, resolved);
}

type StructuredProduct =
  | Readonly<{ kind: "product"; outcome: RunnerAttempt }>
  | Readonly<{ kind: "non_product" }>
  | Readonly<{ kind: "unparseable" }>;

function parseStructuredProduct(stdout: string): StructuredProduct {
  try {
    const parsed: unknown = JSON.parse(stdout);
    if (!isPlainObject(parsed)) {
      return Object.freeze({ kind: "unparseable" });
    }
    const outcome = getOwnDataProperty(parsed, "outcome", () => {
      throw new TypeError("missing outcome");
    });
    if (productOutcomes.has(outcome)) {
      return Object.freeze({
        kind: "product",
        outcome: outcome as RunnerAttempt,
      });
    }
    return Object.freeze({ kind: "non_product" });
  } catch {
    return Object.freeze({ kind: "unparseable" });
  }
}

function classifyOutcome(
  observation: RunnerObservation,
  policyViolated: boolean,
  redactedStdout: string,
): RunnerAttempt {
  if (
    observation.sandbox_error !== null &&
    observation.sandbox_error.length > 0
  ) {
    return RUNNER_ATTEMPTS.INFRA_ERROR;
  }
  if (observation.timed_out) {
    return RUNNER_ATTEMPTS.PRODUCT_TIMEOUT;
  }
  if (policyViolated) {
    return RUNNER_ATTEMPTS.PRODUCT_FAIL;
  }
  if (observation.exit_code === null) {
    return RUNNER_ATTEMPTS.INFRA_ERROR;
  }
  const structured = parseStructuredProduct(redactedStdout);
  if (structured.kind === "product") {
    return structured.outcome;
  }
  return RUNNER_ATTEMPTS.PRODUCT_FAIL;
}

export function parseRunnerAttempt(
  observationValue: unknown,
  policyValue: unknown,
  secretsValue: unknown,
): ParsedRunnerAttempt {
  const observation = parseObservation(observationValue);
  const policy = parsePolicy(policyValue);
  const secrets = Object.freeze(captureStringArray(secretsValue, invalidObservation));
  const redactedStdout = redactText(observation.stdout, secrets);
  const redactedStderr = redactText(observation.stderr, secrets);
  const bound: BoundArtifact[] = [];
  const advisory: AdvisoryArtifact[] = [];
  let policyViolated = false;

  for (let index = 0; index < observation.artifacts.length; index += 1) {
    const artifact = observation.artifacts[index];
    if (artifact === undefined) {
      invalidObservation();
    }
    const resolvedPath = path.posix.resolve(
      posixPath(policy.sandbox_root),
      artifact.relative_path,
    );
    const size = Buffer.byteLength(artifact.bytes, "utf8");
    const allowlisted = matchesAllowlist(
      artifact.relative_path,
      policy.artifact_allowlist,
    );
    const writable = underWritableRoot(
      artifact.relative_path,
      policy.writable_roots,
    );
    if (
      pathEscapes(artifact.relative_path) ||
      !isInsideRoot(policy.sandbox_root, resolvedPath) ||
      (artifact.symlink_target !== null &&
        symlinkEscapes(
          policy.sandbox_root,
          artifact.relative_path,
          artifact.symlink_target,
        )) ||
      size > policy.max_artifact_bytes ||
      (!allowlisted && !writable)
    ) {
      policyViolated = true;
      continue;
    }
    if (!allowlisted) {
      continue;
    }
    const digest = digestUtf8(redactText(artifact.bytes, secrets));
    const provenanceMatches =
      artifact.runner_identity === policy.runner_identity &&
      artifact.measured_sha === policy.measured_sha &&
      artifact.gate_id === policy.gate_id;
    if (provenanceMatches) {
      bound.push(
        Object.freeze({
          path: artifact.relative_path,
          digest,
          runner_identity: policy.runner_identity,
          measured_sha: policy.measured_sha,
          gate_id: policy.gate_id,
        }),
      );
      continue;
    }
    advisory.push(
      Object.freeze({
        path: artifact.relative_path,
        digest,
        reason: "missing_provenance",
      }),
    );
  }

  const survivingBound = policyViolated ? [] : bound;
  const survivingAdvisory = policyViolated ? [] : advisory;
  const artifactDigestDocument: { digest: Sha256Digest; path: string }[] = [];
  for (let index = 0; index < survivingBound.length; index += 1) {
    const artifact = survivingBound[index];
    if (artifact !== undefined) {
      artifactDigestDocument.push({
        digest: artifact.digest,
        path: artifact.path,
      });
    }
  }
  for (let index = 0; index < survivingAdvisory.length; index += 1) {
    const artifact = survivingAdvisory[index];
    if (artifact !== undefined) {
      artifactDigestDocument.push({
        digest: artifact.digest,
        path: artifact.path,
      });
    }
  }
  artifactDigestDocument.sort((left, right) => compareUtf8(left.path, right.path));

  return Object.freeze({
    outcome: classifyOutcome(observation, policyViolated, redactedStdout),
    redacted_stdout: redactedStdout,
    redacted_stderr: redactedStderr,
    output_digest: digestUtf8(
      serializeCanonical({
        artifacts: artifactDigestDocument,
        stderr: redactedStderr,
        stdout: redactedStdout,
      }),
    ),
    artifacts: Object.freeze(survivingBound),
    advisory_artifacts: Object.freeze(survivingAdvisory),
  });
}

function parseDigest(value: unknown): Sha256Digest {
  if (typeof value !== "string") {
    invalidRequest();
  }
  return parseSha256Digest(value);
}

function parseOptionalDigest(value: unknown): Sha256Digest | null {
  if (value === null) {
    return null;
  }
  return parseDigest(value);
}

function parseRequest(value: unknown): ProtectedRunRequest {
  if (!isPlainObject(value)) {
    invalidRequest();
  }
  assertExactKeys(value, requestKeys, invalidRequest);
  const evidenceStore = getOwnDataProperty(
    value,
    "evidence_store",
    invalidRequest,
  );
  const execute = getOwnDataProperty(value, "execute", invalidRequest);
  const retries = getOwnDataProperty(
    value,
    "infrastructure_retries",
    invalidRequest,
  );
  const maxArtifactBytes = getOwnDataProperty(
    value,
    "max_artifact_bytes",
    invalidRequest,
  );
  if (!(evidenceStore instanceof FileEvidenceStore)) {
    invalidRequest();
  }
  if (typeof execute !== "function") {
    invalidRequest();
  }
  if (
    typeof retries !== "number" ||
    !Number.isSafeInteger(retries) ||
    retries < 0
  ) {
    invalidRequest();
  }
  if (
    typeof maxArtifactBytes !== "number" ||
    !Number.isSafeInteger(maxArtifactBytes) ||
    maxArtifactBytes <= 0
  ) {
    invalidRequest();
  }
  const secrets = captureStringArray(
    getOwnDataProperty(value, "secrets", invalidRequest),
    invalidRequest,
  );
  return Object.freeze({
    task_id: parseRequiredString(
      getOwnDataProperty(value, "task_id", invalidRequest),
      invalidRequest,
    ),
    measured_sha: parseRequiredString(
      getOwnDataProperty(value, "measured_sha", invalidRequest),
      invalidRequest,
    ),
    base_sha: parseRequiredString(
      getOwnDataProperty(value, "base_sha", invalidRequest),
      invalidRequest,
    ),
    policy_digest: parseDigest(
      getOwnDataProperty(value, "policy_digest", invalidRequest),
    ),
    runner_digest: parseDigest(
      getOwnDataProperty(value, "runner_digest", invalidRequest),
    ),
    template_digest: parseDigest(
      getOwnDataProperty(value, "template_digest", invalidRequest),
    ),
    input_digest: parseDigest(
      getOwnDataProperty(value, "input_digest", invalidRequest),
    ),
    environment_digest: parseDigest(
      getOwnDataProperty(value, "environment_digest", invalidRequest),
    ),
    oracle_digest: parseOptionalDigest(
      getOwnDataProperty(value, "oracle_digest", invalidRequest),
    ),
    sandbox_root: parseRequiredString(
      getOwnDataProperty(value, "sandbox_root", invalidRequest),
      invalidRequest,
    ),
    evidence_store: evidenceStore,
    execute: execute as ExecuteProtectedCommand,
    secrets: Object.freeze(secrets),
    infrastructure_retries: retries,
    max_artifact_bytes: maxArtifactBytes,
    runner_identity: parseRequiredString(
      getOwnDataProperty(value, "runner_identity", invalidRequest),
      invalidRequest,
    ),
  });
}

function measurementId(): string {
  const id = `m-${randomUUID()}`;
  if (!isRunCatalogIdentifier(id)) {
    throw new TypeError("Invalid evidence measurement");
  }
  return id;
}

function toMeasurement(
  request: ProtectedRunRequest,
  command: ResolvedProtectedCommand,
  parsed: ParsedRunnerAttempt,
  attempt: number,
): Measurement {
  const artifactPaths: string[] = [];
  for (let index = 0; index < parsed.artifacts.length; index += 1) {
    const artifact = parsed.artifacts[index];
    if (artifact !== undefined) {
      artifactPaths.push(artifact.path);
    }
  }
  return Object.freeze({
    schema_version: 1,
    id: measurementId(),
    task_id: request.task_id,
    gate_id: command.gate_id,
    measured_sha: request.measured_sha,
    base_sha: request.base_sha,
    policy_digest: request.policy_digest,
    runner_digest: request.runner_digest,
    template_digest: request.template_digest,
    input_digest: request.input_digest,
    environment_digest: request.environment_digest,
    oracle_digest: request.oracle_digest,
    deliberate_attempt: attempt,
    outcome: parsed.outcome,
    structured_observations: Object.freeze({}),
    artifacts: Object.freeze(artifactPaths),
    runner_identity: request.runner_identity,
    authoritative: true,
  });
}

function sessionResult(
  status: "measured" | "blocked",
  parsed: ParsedRunnerAttempt,
  measurements: Measurement[],
): RunnerSessionResult {
  return Object.freeze({
    status,
    gate_result: status === "blocked" ? GATE_RESULTS.BLOCKED : null,
    bounce: null,
    measurements: Object.freeze(measurements),
    redacted_stdout: parsed.redacted_stdout,
    redacted_stderr: parsed.redacted_stderr,
    output_digest: parsed.output_digest,
    advisory_artifacts: parsed.advisory_artifacts,
  });
}

export class ProtectedRunner {
  async run(
    commandValue: unknown,
    requestValue: unknown,
  ): Promise<RunnerSessionResult> {
    if (!isResolvedProtectedCommand(commandValue)) {
      rawCommand();
    }
    const request = parseRequest(requestValue);
    const policy = Object.freeze({
      artifact_allowlist: commandValue.template.artifact_allowlist,
      writable_roots: commandValue.template.writable_roots,
      sandbox_root: request.sandbox_root,
      max_artifact_bytes: request.max_artifact_bytes,
      runner_identity: request.runner_identity,
      measured_sha: request.measured_sha,
      gate_id: commandValue.gate_id,
    });
    const measurements: Measurement[] = [];
    const maxAttempts = 1 + request.infrastructure_retries;
    let parsed: ParsedRunnerAttempt | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let observationValue: unknown;
      try {
        observationValue = await request.execute(commandValue, {
          sandbox_root: request.sandbox_root,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "execute failed";
        observationValue = Object.freeze({
          stdout: "",
          stderr: message,
          exit_code: null,
          timed_out: false,
          sandbox_error: "execute failed",
          artifacts: Object.freeze([]),
        });
      }
      parsed = parseRunnerAttempt(observationValue, policy, request.secrets);
      const measurement = await request.evidence_store.appendAuthoritative(
        toMeasurement(request, commandValue, parsed, attempt),
      );
      measurements.push(measurement);
      if (parsed.outcome !== RUNNER_ATTEMPTS.INFRA_ERROR) {
        return sessionResult("measured", parsed, measurements);
      }
    }

    if (parsed === undefined) {
      invalidRequest();
    }
    return sessionResult("blocked", parsed, measurements);
  }
}
