import { createHash } from "node:crypto";

import { parseSha256Digest } from "./domain.ts";
import type { Task } from "./domain.ts";
import type { RepositoryFacts } from "./intake.ts";
import { isIntakePacket, normalizeTask } from "./intake.ts";
import { buildAssignment } from "./pstack-assignment.ts";
import { collectCandidate } from "./pstack-candidate.ts";
import { syncDraftPullRequest } from "./github-pr.ts";
import { evaluateAutoMerge } from "./github-auto-merge.ts";
import { resolveMergeCandidate } from "./github-g7.ts";
import { observeDelivery } from "./delivery.ts";
import { GATE_RESULTS } from "./run-state.ts";
import { isRunCatalogIdentifier } from "./run-catalog.ts";

export type EndToEndDecision = Readonly<{
  schema_version: 1;
  intake_normalized: boolean;
  assignment_secrets: "none";
  candidate_authoritative: false;
  pull_request_number: number;
  agent_direct_merge: false;
  g8_result:
    | typeof GATE_RESULTS.PASS
    | typeof GATE_RESULTS.FAIL
    | typeof GATE_RESULTS.NOT_APPLICABLE;
  path_complete: boolean;
  run_complete: boolean;
}>;

const inputKeys = [
  "intake",
  "assignment",
  "candidate",
  "pull_request",
  "auto_merge",
  "g7",
  "delivery",
] as const;
const intakeKeys = ["task_id", "requested_outcome", "now", "facts"] as const;
const factsKeys = [
  "schema_version",
  "checkout_root",
  "base_ref",
  "instruction_paths",
  "test_command",
  "build_command",
] as const;
const instantPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function invalidInput(): never {
  throw new TypeError("Invalid end-to-end input");
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

function parseInstant(value: unknown): Date {
  const text = parseRequiredString(value);
  if (!instantPattern.test(text)) {
    invalidInput();
  }
  const ms = Date.parse(text);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== text) {
    invalidInput();
  }
  return new Date(ms);
}

function parseStringList(value: unknown): readonly string[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    invalidInput();
  }
  const captured: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      invalidInput();
    }
    captured.push(parseRequiredString(value[index]));
  }
  return Object.freeze(captured);
}

function parseFacts(value: unknown): RepositoryFacts {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, factsKeys);
  if (getOwnDataProperty(value, "schema_version") !== 1) {
    invalidInput();
  }
  return Object.freeze({
    schema_version: 1,
    checkout_root: parseRequiredString(getOwnDataProperty(value, "checkout_root")),
    base_ref: parseRequiredString(getOwnDataProperty(value, "base_ref")),
    instruction_paths: parseStringList(getOwnDataProperty(value, "instruction_paths")),
    test_command: parseOptionalString(getOwnDataProperty(value, "test_command")),
    build_command: parseOptionalString(getOwnDataProperty(value, "build_command")),
  });
}

function parseIntake(value: unknown): {
  task: Task;
  facts: RepositoryFacts;
  now: Date;
} {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, intakeKeys);
  const taskId = getOwnDataProperty(value, "task_id");
  if (!isRunCatalogIdentifier(taskId)) {
    invalidInput();
  }
  const requestedOutcome = parseRequiredString(
    getOwnDataProperty(value, "requested_outcome"),
  );
  return Object.freeze({
    task: Object.freeze({
      schema_version: 1 as const,
      task_id: taskId,
      requested_outcome: requestedOutcome,
      source: Object.freeze({
        kind: "direct_text" as const,
        content_digest: parseSha256Digest(
          `sha256:${createHash("sha256").update(requestedOutcome).digest("hex")}`,
        ),
      }),
    }),
    facts: parseFacts(getOwnDataProperty(value, "facts")),
    now: parseInstant(getOwnDataProperty(value, "now")),
  });
}

export function evaluateEndToEnd(value: unknown): EndToEndDecision {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, inputKeys);
  const intake = parseIntake(getOwnDataProperty(value, "intake"));
  const intakeDecision = normalizeTask(intake.task, intake.facts, intake.now);
  const intakeNormalized = !isIntakePacket(intakeDecision);
  const assignment = buildAssignment(getOwnDataProperty(value, "assignment"));
  const candidate = collectCandidate(getOwnDataProperty(value, "candidate"));
  const pullRequest = syncDraftPullRequest(getOwnDataProperty(value, "pull_request"));
  const autoMerge = evaluateAutoMerge(getOwnDataProperty(value, "auto_merge"));
  const g7 = resolveMergeCandidate(getOwnDataProperty(value, "g7"));
  const delivery = observeDelivery(getOwnDataProperty(value, "delivery"));
  const pathComplete =
    intakeNormalized &&
    assignment.capabilities.secrets === "none" &&
    candidate.authoritative === false &&
    pullRequest.pull_request.number > 0 &&
    autoMerge.agent_direct_merge === false &&
    g7.return_to_pstack === false &&
    g7.stale === false &&
    delivery.g8_result === GATE_RESULTS.PASS;
  return Object.freeze({
    schema_version: 1,
    intake_normalized: intakeNormalized,
    assignment_secrets: "none",
    candidate_authoritative: false,
    pull_request_number: pullRequest.pull_request.number,
    agent_direct_merge: false,
    g8_result: delivery.g8_result,
    path_complete: pathComplete,
    run_complete: pathComplete,
  });
}
