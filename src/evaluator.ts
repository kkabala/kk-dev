import { parseSha256Digest } from "./domain.ts";
import type { Sha256Digest } from "./domain.ts";
import {
  isUncertainEvidenceKey,
  serializeCanonical,
} from "./evidence-key.ts";
import type { EvidenceKey, UncertainEvidenceKey } from "./evidence-key.ts";
import type { Measurement } from "./evidence-store.ts";
import { DEFAULT_INFRASTRUCTURE_RETRIES } from "./protected-runner.ts";
import { isRunCatalogIdentifier } from "./run-catalog.ts";
import {
  deriveEngineeringStatus,
  ENGINEERING_STATUSES,
  GATE_RESULTS,
  RUNNER_ATTEMPTS,
} from "./run-state.ts";
import type { EngineeringStatus, GateResult, RunnerAttempt } from "./run-state.ts";

export type EvaluatedGate = Readonly<{
  gate_id: string;
  result: GateResult | null;
  covered_by_live_exception: boolean;
}>;

export type TaskDecision = Readonly<{
  schema_version: 1;
  engineering_status: EngineeringStatus;
  gates: readonly EvaluatedGate[];
  bounce: null;
}>;

const inputKeys = [
  "task",
  "required_gates",
  "measurements",
  "github_state",
  "now",
  "needs_human",
] as const;

const requiredGateKeys = [
  "gate_id",
  "evidence_key",
  "covered_by_live_exception",
] as const;

const githubStateKeys = ["agent_success_claim"] as const;
const taskKeys = ["task_id"] as const;

const measurementKeys = [
  "schema_version",
  "id",
  "task_id",
  "gate_id",
  "measured_sha",
  "base_sha",
  "policy_digest",
  "runner_digest",
  "template_digest",
  "input_digest",
  "environment_digest",
  "oracle_digest",
  "deliberate_attempt",
  "outcome",
  "structured_observations",
  "artifacts",
  "runner_identity",
  "authoritative",
] as const;

const evidenceKeyFields = [
  "schema_version",
  "gate_id",
  "template_digest",
  "input_digest",
  "environment_digest",
  "oracle_digest",
] as const;

const gateIdPattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u;
const knownOutcomes = new Set<unknown>(Object.values(RUNNER_ATTEMPTS));
const productOutcomes = new Set<unknown>([
  RUNNER_ATTEMPTS.PRODUCT_PASS,
  RUNNER_ATTEMPTS.PRODUCT_FAIL,
]);
const exhaustedInfraAttempts = 1 + DEFAULT_INFRASTRUCTURE_RETRIES;

function invalidInput(): never {
  throw new TypeError("Invalid evaluator input");
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

function parseDigest(value: unknown): Sha256Digest {
  if (typeof value !== "string") {
    invalidInput();
  }
  return parseSha256Digest(value);
}

function parseOptionalDigest(value: unknown): Sha256Digest | null {
  if (value === null) {
    return null;
  }
  return parseDigest(value);
}

function parseEvidenceKey(value: unknown): EvidenceKey | UncertainEvidenceKey {
  if (isUncertainEvidenceKey(value as EvidenceKey | UncertainEvidenceKey)) {
    if (!isPlainObject(value)) {
      invalidInput();
    }
    assertExactKeys(value, ["kind", "reason"]);
    const reason = getOwnDataProperty(value, "reason");
    if (reason !== "uncertain_dependency_selection") {
      invalidInput();
    }
    return Object.freeze({
      kind: "uncertain",
      reason: "uncertain_dependency_selection",
    });
  }
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, evidenceKeyFields);
  const schemaVersion = getOwnDataProperty(value, "schema_version");
  const gateId = getOwnDataProperty(value, "gate_id");
  if (
    schemaVersion !== 1 ||
    typeof gateId !== "string" ||
    !gateIdPattern.test(gateId)
  ) {
    invalidInput();
  }
  return Object.freeze({
    schema_version: 1,
    gate_id: gateId,
    template_digest: parseDigest(getOwnDataProperty(value, "template_digest")),
    input_digest: parseDigest(getOwnDataProperty(value, "input_digest")),
    environment_digest: parseDigest(
      getOwnDataProperty(value, "environment_digest"),
    ),
    oracle_digest: parseOptionalDigest(getOwnDataProperty(value, "oracle_digest")),
  });
}

function parseRequiredGate(value: unknown): {
  gate_id: string;
  evidence_key: EvidenceKey | UncertainEvidenceKey;
  covered_by_live_exception: boolean;
} {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, requiredGateKeys);
  const gateId = getOwnDataProperty(value, "gate_id");
  const covered = getOwnDataProperty(value, "covered_by_live_exception");
  if (typeof gateId !== "string" || !gateIdPattern.test(gateId)) {
    invalidInput();
  }
  if (typeof covered !== "boolean") {
    invalidInput();
  }
  const evidenceKey = parseEvidenceKey(getOwnDataProperty(value, "evidence_key"));
  if (
    !isUncertainEvidenceKey(evidenceKey) &&
    evidenceKey.gate_id !== gateId
  ) {
    invalidInput();
  }
  return Object.freeze({
    gate_id: gateId,
    evidence_key: evidenceKey,
    covered_by_live_exception: covered,
  });
}

function parseMeasurement(value: unknown): Measurement {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, measurementKeys);
  const schemaVersion = getOwnDataProperty(value, "schema_version");
  const attempt = getOwnDataProperty(value, "deliberate_attempt");
  const outcome = getOwnDataProperty(value, "outcome");
  const authoritative = getOwnDataProperty(value, "authoritative");
  const gateId = getOwnDataProperty(value, "gate_id");
  const observations = getOwnDataProperty(value, "structured_observations");
  if (
    schemaVersion !== 1 ||
    typeof attempt !== "number" ||
    !Number.isSafeInteger(attempt) ||
    attempt < 1 ||
    !knownOutcomes.has(outcome) ||
    typeof authoritative !== "boolean" ||
    typeof gateId !== "string" ||
    !gateIdPattern.test(gateId) ||
    !isRunCatalogIdentifier(getOwnDataProperty(value, "id")) ||
    !isPlainObject(observations) ||
    ownKeyNames(observations).length !== 0
  ) {
    invalidInput();
  }
  const artifacts = getOwnDataProperty(value, "artifacts");
  const capturedArtifacts = captureDenseList(artifacts, (item) => {
    if (typeof item !== "string" || item.length === 0 || item.includes("\0")) {
      invalidInput();
    }
    return item;
  });
  return Object.freeze({
    schema_version: 1,
    id: parseRequiredString(getOwnDataProperty(value, "id")),
    task_id: parseRequiredString(getOwnDataProperty(value, "task_id")),
    gate_id: gateId,
    measured_sha: parseRequiredString(getOwnDataProperty(value, "measured_sha")),
    base_sha: parseRequiredString(getOwnDataProperty(value, "base_sha")),
    policy_digest: parseDigest(getOwnDataProperty(value, "policy_digest")),
    runner_digest: parseDigest(getOwnDataProperty(value, "runner_digest")),
    template_digest: parseDigest(getOwnDataProperty(value, "template_digest")),
    input_digest: parseDigest(getOwnDataProperty(value, "input_digest")),
    environment_digest: parseDigest(
      getOwnDataProperty(value, "environment_digest"),
    ),
    oracle_digest: parseOptionalDigest(getOwnDataProperty(value, "oracle_digest")),
    deliberate_attempt: attempt,
    outcome: outcome as RunnerAttempt,
    structured_observations: Object.freeze({}),
    artifacts: Object.freeze(capturedArtifacts),
    runner_identity: parseRequiredString(
      getOwnDataProperty(value, "runner_identity"),
    ),
    authoritative,
  });
}

function keyFromMeasurement(measurement: Measurement): string {
  return serializeCanonical({
    schema_version: 1,
    gate_id: measurement.gate_id,
    template_digest: measurement.template_digest,
    input_digest: measurement.input_digest,
    environment_digest: measurement.environment_digest,
    oracle_digest: measurement.oracle_digest,
  });
}

function compareMeasurements(left: Measurement, right: Measurement): number {
  if (left.deliberate_attempt !== right.deliberate_attempt) {
    return left.deliberate_attempt - right.deliberate_attempt;
  }
  if (left.id < right.id) {
    return -1;
  }
  if (left.id > right.id) {
    return 1;
  }
  return 0;
}

function stickyFlaky(product: readonly Measurement[]): boolean {
  for (let end = 1; end <= product.length; end += 1) {
    const start = end - 3 > 0 ? end - 3 : 0;
    const window = product.slice(start, end);
    let seenPass = false;
    let seenFail = false;
    for (let index = 0; index < window.length; index += 1) {
      const attempt = window[index];
      if (attempt?.outcome === RUNNER_ATTEMPTS.PRODUCT_PASS) {
        seenPass = true;
      }
      if (attempt?.outcome === RUNNER_ATTEMPTS.PRODUCT_FAIL) {
        seenFail = true;
      }
    }
    if (seenPass && seenFail) {
      return true;
    }
  }
  return false;
}

function classifyGate(
  evidenceKey: EvidenceKey | UncertainEvidenceKey,
  measurements: readonly Measurement[],
): GateResult | null {
  if (isUncertainEvidenceKey(evidenceKey)) {
    return GATE_RESULTS.STALE;
  }
  const expected = serializeCanonical(evidenceKey);
  const matching: Measurement[] = [];
  for (let index = 0; index < measurements.length; index += 1) {
    const candidate = measurements[index];
    if (
      candidate !== undefined &&
      candidate.authoritative &&
      keyFromMeasurement(candidate) === expected
    ) {
      matching.push(candidate);
    }
  }
  matching.sort(compareMeasurements);
  const product: Measurement[] = [];
  const infra: Measurement[] = [];
  for (let index = 0; index < matching.length; index += 1) {
    const candidate = matching[index];
    if (candidate === undefined) {
      continue;
    }
    if (productOutcomes.has(candidate.outcome)) {
      product.push(candidate);
    }
    if (candidate.outcome === RUNNER_ATTEMPTS.INFRA_ERROR) {
      infra.push(candidate);
    }
  }
  if (stickyFlaky(product)) {
    return GATE_RESULTS.FLAKY;
  }
  let latestConclusive: Measurement | undefined;
  for (let index = matching.length - 1; index >= 0; index -= 1) {
    const candidate = matching[index];
    if (
      candidate !== undefined &&
      (productOutcomes.has(candidate.outcome) ||
        candidate.outcome === RUNNER_ATTEMPTS.PRODUCT_TIMEOUT)
    ) {
      latestConclusive = candidate;
      break;
    }
  }
  if (latestConclusive !== undefined) {
    return latestConclusive.outcome === RUNNER_ATTEMPTS.PRODUCT_PASS
      ? GATE_RESULTS.PASS
      : GATE_RESULTS.FAIL;
  }
  if (infra.length >= exhaustedInfraAttempts) {
    return GATE_RESULTS.BLOCKED;
  }
  return null;
}

export function evaluateTask(value: unknown): TaskDecision {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, inputKeys);
  const taskValue = getOwnDataProperty(value, "task");
  if (!isPlainObject(taskValue)) {
    invalidInput();
  }
  assertExactKeys(taskValue, taskKeys);
  parseRequiredString(getOwnDataProperty(taskValue, "task_id"));

  const githubState = getOwnDataProperty(value, "github_state");
  if (!isPlainObject(githubState)) {
    invalidInput();
  }
  assertExactKeys(githubState, githubStateKeys);
  const agentSuccessClaim = getOwnDataProperty(
    githubState,
    "agent_success_claim",
  );
  const needsHuman = getOwnDataProperty(value, "needs_human");
  const now = getOwnDataProperty(value, "now");
  if (typeof agentSuccessClaim !== "boolean" || typeof needsHuman !== "boolean") {
    invalidInput();
  }
  parseRequiredString(now);

  const requiredGates = captureDenseList(
    getOwnDataProperty(value, "required_gates"),
    parseRequiredGate,
  );
  const measurements = captureDenseList(
    getOwnDataProperty(value, "measurements"),
    parseMeasurement,
  );

  const gates: EvaluatedGate[] = [];
  for (let index = 0; index < requiredGates.length; index += 1) {
    const gate = requiredGates[index];
    if (gate === undefined) {
      invalidInput();
    }
    gates.push(
      Object.freeze({
        gate_id: gate.gate_id,
        result: classifyGate(gate.evidence_key, measurements),
        covered_by_live_exception: gate.covered_by_live_exception,
      }),
    );
  }

  const statusGates: { result: GateResult | null; covered_by_live_exception: boolean }[] =
    [];
  for (let index = 0; index < gates.length; index += 1) {
    const gate = gates[index];
    if (gate === undefined) {
      invalidInput();
    }
    statusGates.push({
      result: gate.result,
      covered_by_live_exception: gate.covered_by_live_exception,
    });
  }

  const engineeringStatus = deriveEngineeringStatus({
    required_gates: statusGates,
    needs_human: needsHuman,
  });

  if (
    agentSuccessClaim &&
    engineeringStatus === ENGINEERING_STATUSES.WAITING_GATES
  ) {
    return Object.freeze({
      schema_version: 1 as const,
      engineering_status: ENGINEERING_STATUSES.WAITING_GATES,
      gates: Object.freeze(gates),
      bounce: null,
    });
  }

  return Object.freeze({
    schema_version: 1,
    engineering_status: engineeringStatus,
    gates: Object.freeze(gates),
    bounce: null,
  });
}
