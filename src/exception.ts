import { parseSha256Digest } from "./domain.ts";
import type { Sha256Digest } from "./domain.ts";
import {
  isUncertainEvidenceKey,
  serializeCanonical,
} from "./evidence-key.ts";
import type { EvidenceKey, EvidenceKeyResult } from "./evidence-key.ts";
import { GATE_CLASSES } from "./gate-template.ts";
import type { GateClass } from "./gate-template.ts";
import { isRunCatalogIdentifier } from "./run-catalog.ts";
import {
  GATE_RESULTS,
  MERGE_MODES,
  RUN_EVENTS,
} from "./run-state.ts";
import type { GateResult, MergeMode, RunEvent } from "./run-state.ts";

export type ExceptionDecision = "pending" | "approved" | "rejected";

export type AcceptedGap = Readonly<{
  schema_version: 1;
  kind: "accepted_gap";
  id: string;
  gate_id: string;
  owner: string;
  reason: string;
  expires_at: string;
  compensating_evidence_key: EvidenceKey;
  decision: ExceptionDecision;
  approved_by: string | null;
}>;

export type OverrideException = Readonly<{
  schema_version: 1;
  kind: "override";
  id: string;
  gate_id: string;
  owner: string;
  reason: string;
  expires_at: string;
  compensating_evidence_key: EvidenceKey;
  evidence_key: EvidenceKey;
  independent_approver: string;
  decision: ExceptionDecision;
  approved_by: string | null;
}>;

export type ExceptionRecord = AcceptedGap | OverrideException;

export type ExceptionCoverage = Readonly<{
  gate_id: string;
  covered_by_live_exception: boolean;
}>;

export type ExceptionResolution = Readonly<{
  coverage: readonly ExceptionCoverage[];
  merge_mode: MergeMode;
  run_event: RunEvent;
  needs_human: boolean;
}>;

const inputKeys = ["exceptions", "now", "gates", "compensating_evidence"] as const;
const gateInputKeys = ["gate_id", "result", "gate_class", "trust_boundary"] as const;
const gapKeys = [
  "schema_version",
  "kind",
  "id",
  "gate_id",
  "owner",
  "reason",
  "expires_at",
  "compensating_evidence_key",
  "decision",
  "approved_by",
] as const;
const overrideKeys = [...gapKeys, "evidence_key", "independent_approver"] as const;
const evidenceKeyFields = [
  "schema_version",
  "gate_id",
  "template_digest",
  "input_digest",
  "environment_digest",
  "oracle_digest",
] as const;

const gateIdPattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u;
const isoUtcPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const knownDecisions = new Set(["pending", "approved", "rejected"]);
const knownGateResults = new Set<unknown>(Object.values(GATE_RESULTS));
const knownGateClasses = new Set<unknown>(Object.values(GATE_CLASSES));
const forbiddenGateClasses = new Set<GateClass>([
  GATE_CLASSES.G0,
  GATE_CLASSES.G2,
  GATE_CLASSES.G7,
  GATE_CLASSES.G8,
]);

function invalidInput(): never {
  throw new TypeError("Invalid exception input");
}

function cannotCover(): never {
  throw new TypeError("Exception cannot cover this gate");
}

function independentApproverRequired(): never {
  throw new TypeError("Override requires an independent approver");
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

function parseOptionalApprover(
  value: unknown,
  decision: ExceptionDecision,
): string | null {
  if (decision === "approved") {
    return parseRequiredString(value);
  }
  if (value !== null) {
    invalidInput();
  }
  return null;
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

function parseIsoUtc(value: unknown): string {
  const token = parseRequiredString(value);
  if (!isoUtcPattern.test(token)) {
    invalidInput();
  }
  return token;
}

function parseGateId(value: unknown): string {
  if (typeof value !== "string" || !gateIdPattern.test(value)) {
    invalidInput();
  }
  return value;
}

function gateClassFromId(gateId: string): GateClass | null {
  const match = /^g([0-9])(?:[.-]|$)/u.exec(gateId);
  const index = match?.[1];
  if (index === undefined) {
    return null;
  }
  const name = `G${index}` as keyof typeof GATE_CLASSES;
  return GATE_CLASSES[name] ?? null;
}

function assertCoverableGateId(gateId: string): void {
  const gateClass = gateClassFromId(gateId);
  if (gateClass === null || forbiddenGateClasses.has(gateClass)) {
    cannotCover();
  }
}

function parseEvidenceKey(value: unknown): EvidenceKey {
  if (isUncertainEvidenceKey(value as EvidenceKeyResult)) {
    invalidInput();
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

function parseDecision(value: unknown): ExceptionDecision {
  if (typeof value !== "string" || !knownDecisions.has(value)) {
    invalidInput();
  }
  return value as ExceptionDecision;
}

function parseCommon(value: Record<PropertyKey, unknown>): {
  schema_version: 1;
  id: string;
  gate_id: string;
  owner: string;
  reason: string;
  expires_at: string;
  compensating_evidence_key: EvidenceKey;
  decision: ExceptionDecision;
  approved_by: string | null;
} {
  const schemaVersion = getOwnDataProperty(value, "schema_version");
  const id = getOwnDataProperty(value, "id");
  if (schemaVersion !== 1 || !isRunCatalogIdentifier(id)) {
    invalidInput();
  }
  const gateId = parseGateId(getOwnDataProperty(value, "gate_id"));
  assertCoverableGateId(gateId);
  const decision = parseDecision(getOwnDataProperty(value, "decision"));
  return {
    schema_version: 1,
    id,
    gate_id: gateId,
    owner: parseRequiredString(getOwnDataProperty(value, "owner")),
    reason: parseRequiredString(getOwnDataProperty(value, "reason")),
    expires_at: parseIsoUtc(getOwnDataProperty(value, "expires_at")),
    compensating_evidence_key: parseEvidenceKey(
      getOwnDataProperty(value, "compensating_evidence_key"),
    ),
    decision,
    approved_by: parseOptionalApprover(
      getOwnDataProperty(value, "approved_by"),
      decision,
    ),
  };
}

function parseException(value: unknown): ExceptionRecord {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  const kind = getOwnDataProperty(value, "kind");
  if (kind === "accepted_gap") {
    assertExactKeys(value, gapKeys);
    return Object.freeze({
      kind: "accepted_gap",
      ...parseCommon(value),
    });
  }
  if (kind !== "override") {
    invalidInput();
  }
  assertExactKeys(value, overrideKeys);
  const common = parseCommon(value);
  const independentApprover = parseRequiredString(
    getOwnDataProperty(value, "independent_approver"),
  );
  const evidenceKey = parseEvidenceKey(getOwnDataProperty(value, "evidence_key"));
  if (
    independentApprover === common.owner ||
    (common.decision === "approved" &&
      common.approved_by !== independentApprover)
  ) {
    independentApproverRequired();
  }
  if (evidenceKey.gate_id !== common.gate_id) {
    invalidInput();
  }
  return Object.freeze({
    kind: "override",
    ...common,
    evidence_key: evidenceKey,
    independent_approver: independentApprover,
  });
}

function parseGateInput(value: unknown): {
  gate_id: string;
  result: GateResult | null;
  gate_class: GateClass;
  trust_boundary: boolean;
} {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, gateInputKeys);
  const result = getOwnDataProperty(value, "result");
  const gateClass = getOwnDataProperty(value, "gate_class");
  const trustBoundary = getOwnDataProperty(value, "trust_boundary");
  if (
    (result !== null && !knownGateResults.has(result)) ||
    !knownGateClasses.has(gateClass) ||
    typeof trustBoundary !== "boolean"
  ) {
    invalidInput();
  }
  return Object.freeze({
    gate_id: parseGateId(getOwnDataProperty(value, "gate_id")),
    result: result as GateResult | null,
    gate_class: gateClass as GateClass,
    trust_boundary: trustBoundary,
  });
}

function compensatingSatisfied(
  needed: EvidenceKey,
  available: readonly EvidenceKey[],
): boolean {
  const expected = serializeCanonical(needed);
  for (let index = 0; index < available.length; index += 1) {
    const candidate = available[index];
    if (candidate !== undefined && serializeCanonical(candidate) === expected) {
      return true;
    }
  }
  return false;
}

function findGate(
  gateId: string,
  gates: readonly {
    gate_id: string;
    result: GateResult | null;
    gate_class: GateClass;
    trust_boundary: boolean;
  }[],
) {
  for (let index = 0; index < gates.length; index += 1) {
    const gate = gates[index];
    if (gate !== undefined && gate.gate_id === gateId) {
      return gate;
    }
  }
  invalidInput();
}

function assertGateCoverable(gate: {
  result: GateResult | null;
  gate_class: GateClass;
  trust_boundary: boolean;
}): void {
  if (
    forbiddenGateClasses.has(gate.gate_class) ||
    gate.trust_boundary ||
    gate.result === GATE_RESULTS.FLAKY
  ) {
    cannotCover();
  }
}

function isExpired(expiresAt: string, now: string): boolean {
  return now >= expiresAt;
}

export function resolveExceptions(value: unknown): ExceptionResolution {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, inputKeys);
  const now = parseIsoUtc(getOwnDataProperty(value, "now"));
  const exceptions = captureDenseList(
    getOwnDataProperty(value, "exceptions"),
    parseException,
  );
  const gates = captureDenseList(
    getOwnDataProperty(value, "gates"),
    parseGateInput,
  );
  const compensating = captureDenseList(
    getOwnDataProperty(value, "compensating_evidence"),
    parseEvidenceKey,
  );

  const liveGates = new Set<string>();
  const seenExceptionIds = new Set<string>();
  const seenGateIds = new Set<string>();
  let pending = false;
  let live = false;

  for (let index = 0; index < gates.length; index += 1) {
    const gate = gates[index];
    if (gate === undefined || seenGateIds.has(gate.gate_id)) {
      invalidInput();
    }
    seenGateIds.add(gate.gate_id);
  }

  for (let index = 0; index < exceptions.length; index += 1) {
    const exception = exceptions[index];
    if (exception === undefined || seenExceptionIds.has(exception.id)) {
      invalidInput();
    }
    seenExceptionIds.add(exception.id);
    const target = findGate(exception.gate_id, gates);
    assertGateCoverable(target);
    if (exception.decision === "pending" && !isExpired(exception.expires_at, now)) {
      pending = true;
      continue;
    }
    if (
      exception.decision === "approved" &&
      !isExpired(exception.expires_at, now) &&
      compensatingSatisfied(exception.compensating_evidence_key, compensating)
    ) {
      live = true;
      liveGates.add(exception.gate_id);
    }
  }

  const coverage: ExceptionCoverage[] = [];
  for (let index = 0; index < gates.length; index += 1) {
    const gate = gates[index];
    if (gate === undefined) {
      invalidInput();
    }
    coverage.push(
      Object.freeze({
        gate_id: gate.gate_id,
        covered_by_live_exception: liveGates.has(gate.gate_id),
      }),
    );
  }

  const runEvent = live
    ? RUN_EVENTS.EXCEPTION_ACCEPTED
    : pending
      ? RUN_EVENTS.EXCEPTION_PROPOSED
      : RUN_EVENTS.EXCEPTION_NOT_ACCEPTED;
  const humanMerge = live || pending;

  return Object.freeze({
    coverage: Object.freeze(coverage),
    merge_mode: humanMerge ? MERGE_MODES.HUMAN_MERGE : MERGE_MODES.GITHUB_AUTO_MERGE,
    run_event: runEvent,
    needs_human: pending,
  });
}
