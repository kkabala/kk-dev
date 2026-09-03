import { GATE_CLASSES } from "./gate-template.ts";
import type { GateClass } from "./gate-template.ts";
import type {
  CandidateReviewRequestPacket,
  NonEmptyReadonlyArray,
} from "./domain.ts";
import { serializeCanonical } from "./evidence-key.ts";
import type { PlannedGate } from "./gates.ts";
import { isRunCatalogIdentifier } from "./run-catalog.ts";
import { GATE_RESULTS } from "./run-state.ts";
import type { GateResult } from "./run-state.ts";

export type RepairBounce = Readonly<{
  task_id: string;
  candidate_sha: string;
  failed_gate: string;
  result: typeof GATE_RESULTS.FAIL | typeof GATE_RESULTS.FLAKY;
  summary: string;
  evidence_refs: NonEmptyReadonlyArray<string>;
  hypotheses: readonly string[];
  allowed_paths: readonly string[];
  rerun_gate_ids: readonly string[];
}>;

export type BounceDecision =
  | Readonly<{
      kind: "bounce";
      bounce: RepairBounce;
      packet: null;
    }>
  | Readonly<{
      kind: "packet";
      bounce: null;
      packet: CandidateReviewRequestPacket;
    }>
  | Readonly<{
      kind: "none";
      bounce: null;
      packet: null;
    }>;

const inputKeys = [
  "task_id",
  "candidate_sha",
  "failed_gate",
  "result",
  "summary",
  "evidence_refs",
  "hypotheses",
  "allowed_paths",
  "required_gates",
  "fingerprint_history",
  "repeated_fingerprint_limit",
  "source",
  "now",
] as const;
const plannedGateKeys = ["gate_class", "gate_id"] as const;
const fingerprintKeys = ["failed_gate", "result", "summary"] as const;
const knownGateClasses = new Set<unknown>(Object.values(GATE_CLASSES));
const knownResults = new Set<unknown>(Object.values(GATE_RESULTS));
const productBounceResults = new Set<unknown>([
  GATE_RESULTS.FAIL,
  GATE_RESULTS.FLAKY,
]);
const knownSources = new Set(["gate_failure", "review_request"]);
const classRank: Readonly<Record<string, number>> = Object.freeze({
  [GATE_CLASSES.G0]: 0,
  [GATE_CLASSES.G1]: 1,
  [GATE_CLASSES.G2]: 2,
  [GATE_CLASSES.G3]: 3,
  [GATE_CLASSES.G4]: 4,
  [GATE_CLASSES.G5]: 5,
  [GATE_CLASSES.G6]: 6,
  [GATE_CLASSES.G7]: 7,
  [GATE_CLASSES.G8]: 8,
  [GATE_CLASSES.G9]: 9,
});
const idPattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u;

function invalidInput(): never {
  throw new TypeError("Invalid bounce input");
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

function parseGlobPattern(value: unknown): string {
  const token = parseRequiredString(value);
  if (token.startsWith("/") || token.includes("\\")) {
    invalidInput();
  }
  const segments = token.split("/");
  if (
    segments.length === 0 ||
    segments.some(
      (segment) =>
        segment === "" ||
        segment === "." ||
        segment === ".." ||
        (segment.includes("**") && segment !== "**"),
    )
  ) {
    invalidInput();
  }
  return token;
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

function uniqueSorted(values: readonly string[]): readonly string[] {
  const unique: string[] = [];
  const seen = new Set<string>();
  const ordered = [...values];
  ordered.sort(compareUtf8);
  for (let index = 0; index < ordered.length; index += 1) {
    const item = ordered[index];
    if (item !== undefined && !seen.has(item)) {
      seen.add(item);
      unique.push(item);
    }
  }
  return Object.freeze(unique);
}

function parseGateClass(value: unknown): GateClass {
  if (!knownGateClasses.has(value)) {
    invalidInput();
  }
  return value as GateClass;
}

function parseGateResult(value: unknown): GateResult {
  if (!knownResults.has(value)) {
    invalidInput();
  }
  return value as GateResult;
}

function parsePlannedGate(value: unknown): PlannedGate {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, plannedGateKeys);
  return Object.freeze({
    gate_class: parseGateClass(getOwnDataProperty(value, "gate_class")),
    gate_id: parseId(getOwnDataProperty(value, "gate_id")),
  });
}

function parseFingerprint(value: unknown): {
  failed_gate: string;
  result: GateResult;
  summary: string;
} {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, fingerprintKeys);
  return Object.freeze({
    failed_gate: parseId(getOwnDataProperty(value, "failed_gate")),
    result: parseGateResult(getOwnDataProperty(value, "result")),
    summary: parseRequiredString(getOwnDataProperty(value, "summary")),
  });
}

function fingerprintOf(value: {
  failed_gate: string;
  result: GateResult;
  summary: string;
}): string {
  return serializeCanonical({
    failed_gate: value.failed_gate,
    result: value.result,
    summary: value.summary,
  });
}

function none(): BounceDecision {
  return Object.freeze({
    kind: "none",
    bounce: null,
    packet: null,
  });
}

function rerunGateIds(
  requiredGates: readonly PlannedGate[],
  failedGate: string,
): readonly string[] {
  const selected: PlannedGate[] = [];
  const seen = new Set<string>();
  function add(gate: PlannedGate): void {
    if (seen.has(gate.gate_id)) {
      return;
    }
    seen.add(gate.gate_id);
    selected.push(gate);
  }
  let failed: PlannedGate | undefined;
  for (let index = 0; index < requiredGates.length; index += 1) {
    const gate = requiredGates[index];
    if (gate === undefined) {
      invalidInput();
    }
    if (gate.gate_id === failedGate) {
      failed = gate;
    }
    if (gate.gate_class === GATE_CLASSES.G1 || gate.gate_class === GATE_CLASSES.G2) {
      add(gate);
    }
  }
  if (failed === undefined) {
    invalidInput();
  }
  add(failed);
  selected.sort((left, right) => {
    const byClass = (classRank[left.gate_class] ?? 0) - (classRank[right.gate_class] ?? 0);
    if (byClass !== 0) {
      return byClass;
    }
    return compareUtf8(left.gate_id, right.gate_id);
  });
  return Object.freeze(selected.map((gate) => gate.gate_id));
}

export function buildBounce(value: unknown): BounceDecision {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, inputKeys);
  const taskId = getOwnDataProperty(value, "task_id");
  if (!isRunCatalogIdentifier(taskId)) {
    invalidInput();
  }
  const failedGate = parseId(getOwnDataProperty(value, "failed_gate"));
  const result = parseGateResult(getOwnDataProperty(value, "result"));
  const summary = parseRequiredString(getOwnDataProperty(value, "summary"));
  const evidenceRefs = parseStringList(
    getOwnDataProperty(value, "evidence_refs"),
    parseRequiredString,
  );
  if (evidenceRefs.length === 0) {
    invalidInput();
  }
  const hypotheses = uniqueSorted(
    parseStringList(getOwnDataProperty(value, "hypotheses"), parseId),
  );
  const allowedPaths = uniqueSorted(
    parseStringList(getOwnDataProperty(value, "allowed_paths"), parseGlobPattern),
  );
  if (allowedPaths.length === 0) {
    invalidInput();
  }
  const requiredGates = Object.freeze(
    captureDenseList(getOwnDataProperty(value, "required_gates"), parsePlannedGate),
  );
  const seenGates = new Set<string>();
  for (let index = 0; index < requiredGates.length; index += 1) {
    const gate = requiredGates[index];
    if (gate === undefined || seenGates.has(gate.gate_id)) {
      invalidInput();
    }
    seenGates.add(gate.gate_id);
  }
  const history = captureDenseList(
    getOwnDataProperty(value, "fingerprint_history"),
    parseFingerprint,
  );
  const limit = getOwnDataProperty(value, "repeated_fingerprint_limit");
  if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1) {
    invalidInput();
  }
  const source = getOwnDataProperty(value, "source");
  if (typeof source !== "string" || !knownSources.has(source)) {
    invalidInput();
  }
  const nowValue = parseRequiredString(getOwnDataProperty(value, "now"));
  const now = new Date(nowValue);
  if (Number.isNaN(now.getTime()) || now.toISOString() !== nowValue) {
    invalidInput();
  }

  const candidateSha = parseRequiredString(getOwnDataProperty(value, "candidate_sha"));
  const rerun = rerunGateIds(requiredGates, failedGate);
  const currentFingerprint = fingerprintOf({
    failed_gate: failedGate,
    result,
    summary,
  });
  let matches = 0;
  for (let index = 0; index < history.length; index += 1) {
    const prior = history[index];
    if (prior !== undefined && fingerprintOf(prior) === currentFingerprint) {
      matches += 1;
    }
  }

  if (source === "gate_failure" && !productBounceResults.has(result)) {
    return none();
  }
  if (source === "gate_failure" && matches >= limit) {
    return Object.freeze({
      kind: "packet",
      bounce: null,
      packet: Object.freeze({
        schema_version: 1 as const,
        packet_id: `packet-${taskId}-repeated-failure`,
        task_id: taskId,
        subject: Object.freeze({
          kind: "candidate" as const,
          candidate_sha: candidateSha,
        }),
        request: Object.freeze({
          kind: "review_request" as const,
          review_request:
            "The same repair bounce failed three times and needs a human decision.",
          recommended_answer:
            "Inspect the repeated failure and decide the next product or PAC change.",
          alternatives: Object.freeze([
            "Change the PAC or harness",
            "Approve a narrow exception",
            "Stop the run",
          ]) as NonEmptyReadonlyArray<string>,
        }),
        why_automation_cannot_decide:
          "Three repeated equivalent repair failures did not change the outcome.",
        affected_behavior: summary,
        risk_summary:
          "Continuing the bounce loop would spend more time without new evidence.",
        evidence_refs: evidenceRefs as NonEmptyReadonlyArray<string>,
        expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
        required_approver_identity: "user:task-author",
      }),
    });
  }
  if (!productBounceResults.has(result) && source !== "review_request") {
    return none();
  }
  if (!productBounceResults.has(result)) {
    invalidInput();
  }

  return Object.freeze({
    kind: "bounce",
    bounce: Object.freeze({
      task_id: taskId,
      candidate_sha: candidateSha,
      failed_gate: failedGate,
      result: result as RepairBounce["result"],
      summary,
      evidence_refs: evidenceRefs as NonEmptyReadonlyArray<string>,
      hypotheses,
      allowed_paths: allowedPaths,
      rerun_gate_ids: rerun,
    }),
    packet: null,
  });
}
