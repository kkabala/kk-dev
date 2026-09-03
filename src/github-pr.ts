import { isRunCatalogIdentifier } from "./run-catalog.ts";
import { ENGINEERING_STATUSES } from "./run-state.ts";
import type { EngineeringStatus } from "./run-state.ts";
import type { GithubPullRequest } from "./github.ts";

export type ExoframeCheck = Readonly<{
  name: "exoframe/engineering" | "exoframe/merge-ready";
  conclusion: "pending" | "success" | "failure";
}>;

export type DraftPullRequestSync = Readonly<{
  schema_version: 1;
  action: "create" | "update";
  pull_request: GithubPullRequest;
  checks: Readonly<{
    engineering: ExoframeCheck;
    merge_ready: ExoframeCheck;
  }>;
  run_complete: false;
}>;

const inputKeys = [
  "task_id",
  "candidate_sha",
  "base_sha",
  "assigned_number",
  "existing_pull_request",
  "engineering_status",
  "merge_ready",
] as const;
const pullRequestKeys = [
  "number",
  "draft",
  "head_sha",
  "base_sha",
  "merged",
] as const;
const knownStatuses = new Set<unknown>(Object.values(ENGINEERING_STATUSES));
const successfulEngineering = new Set<unknown>([
  ENGINEERING_STATUSES.ENGINEERING_READY,
  ENGINEERING_STATUSES.ENGINEERING_READY_WITH_EXCEPTION,
]);
const failedEngineering = new Set<unknown>([
  ENGINEERING_STATUSES.FAIL,
  ENGINEERING_STATUSES.BLOCKED,
]);

function invalidInput(): never {
  throw new TypeError("Invalid draft pull request input");
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

function parseBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") {
    invalidInput();
  }
  return value;
}

function parsePullNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    invalidInput();
  }
  return value;
}

function parsePullRequest(value: unknown): GithubPullRequest | null {
  if (value === null) {
    return null;
  }
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, pullRequestKeys);
  return Object.freeze({
    number: parsePullNumber(getOwnDataProperty(value, "number")),
    draft: parseBoolean(getOwnDataProperty(value, "draft")),
    head_sha: parseRequiredString(getOwnDataProperty(value, "head_sha")),
    base_sha: parseRequiredString(getOwnDataProperty(value, "base_sha")),
    merged: parseBoolean(getOwnDataProperty(value, "merged")),
  });
}

function engineeringConclusion(
  status: EngineeringStatus,
): ExoframeCheck["conclusion"] {
  if (successfulEngineering.has(status)) {
    return "success";
  }
  if (failedEngineering.has(status)) {
    return "failure";
  }
  return "pending";
}

export function syncDraftPullRequest(value: unknown): DraftPullRequestSync {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, inputKeys);
  const taskId = getOwnDataProperty(value, "task_id");
  if (!isRunCatalogIdentifier(taskId)) {
    invalidInput();
  }
  const candidateSha = parseRequiredString(getOwnDataProperty(value, "candidate_sha"));
  const baseSha = parseRequiredString(getOwnDataProperty(value, "base_sha"));
  const assignedNumber = parsePullNumber(getOwnDataProperty(value, "assigned_number"));
  const existing = parsePullRequest(getOwnDataProperty(value, "existing_pull_request"));
  const status = getOwnDataProperty(value, "engineering_status");
  if (!knownStatuses.has(status)) {
    invalidInput();
  }
  const mergeReady = parseBoolean(getOwnDataProperty(value, "merge_ready"));
  if (
    (mergeReady && !successfulEngineering.has(status)) ||
    (existing !== null && (existing.merged || existing.number !== assignedNumber))
  ) {
    invalidInput();
  }

  const action = existing === null ? "create" : "update";
  return Object.freeze({
    schema_version: 1,
    action,
    pull_request: Object.freeze({
      number: assignedNumber,
      draft: true,
      head_sha: candidateSha,
      base_sha: baseSha,
      merged: false,
    }),
    checks: Object.freeze({
      engineering: Object.freeze({
        name: "exoframe/engineering",
        conclusion: engineeringConclusion(status as EngineeringStatus),
      }),
      merge_ready: Object.freeze({
        name: "exoframe/merge-ready",
        conclusion: mergeReady ? "success" : "pending",
      }),
    }),
    run_complete: false,
  });
}
