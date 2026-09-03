import { MERGE_MODES } from "./run-state.ts";
import type { MergeMode } from "./run-state.ts";

export type GithubActor = Readonly<{
  kind: "github_app" | "github_user";
  identity: string;
}>;

export type GithubPullRequest = Readonly<{
  number: number;
  draft: boolean;
  head_sha: string;
  base_sha: string;
  merged: boolean;
}>;

export type GithubState = Readonly<{
  schema_version: 1;
  authenticated: true;
  actor: GithubActor;
  repository: Readonly<{
    owner: string;
    name: string;
  }>;
  pull_request: GithubPullRequest | null;
  checks: Readonly<{
    engineering: string | null;
    merge_ready: string | null;
  }>;
  reviews: Readonly<{
    required_count: number;
    submitted_count: number;
    codeowners_satisfied: boolean;
    approval_fresh: boolean;
  }>;
  queue: Readonly<{
    present: boolean;
    candidate_sha: string | null;
  }>;
  merge: Readonly<{
    mode: MergeMode;
    merged_sha: string | null;
  }>;
}>;

const inputKeys = [
  "authenticated",
  "actor",
  "repository",
  "pull_request",
  "checks",
  "reviews",
  "queue",
  "merge",
] as const;
const actorKeys = ["kind", "identity"] as const;
const repositoryKeys = ["owner", "name"] as const;
const pullRequestKeys = [
  "number",
  "draft",
  "head_sha",
  "base_sha",
  "merged",
] as const;
const checkKeys = ["engineering", "merge_ready"] as const;
const reviewKeys = [
  "required_count",
  "submitted_count",
  "codeowners_satisfied",
  "approval_fresh",
] as const;
const queueKeys = ["present", "candidate_sha"] as const;
const mergeKeys = ["mode", "merged_sha"] as const;
const knownActorKinds = new Set(["github_app", "github_user"]);
const knownMergeModes = new Set<unknown>(Object.values(MERGE_MODES));

function invalidInput(): never {
  throw new TypeError("Invalid GitHub provider input");
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

function parseBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") {
    invalidInput();
  }
  return value;
}

function parseCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    invalidInput();
  }
  return value;
}

function parseActor(value: unknown): GithubActor {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, actorKeys);
  const kind = getOwnDataProperty(value, "kind");
  if (typeof kind !== "string" || !knownActorKinds.has(kind)) {
    invalidInput();
  }
  return Object.freeze({
    kind: kind as GithubActor["kind"],
    identity: parseRequiredString(getOwnDataProperty(value, "identity")),
  });
}

function parseRepository(value: unknown): GithubState["repository"] {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, repositoryKeys);
  return Object.freeze({
    owner: parseRequiredString(getOwnDataProperty(value, "owner")),
    name: parseRequiredString(getOwnDataProperty(value, "name")),
  });
}

function parsePullRequest(value: unknown): GithubPullRequest | null {
  if (value === null) {
    return null;
  }
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, pullRequestKeys);
  const number = getOwnDataProperty(value, "number");
  if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 1) {
    invalidInput();
  }
  return Object.freeze({
    number,
    draft: parseBoolean(getOwnDataProperty(value, "draft")),
    head_sha: parseRequiredString(getOwnDataProperty(value, "head_sha")),
    base_sha: parseRequiredString(getOwnDataProperty(value, "base_sha")),
    merged: parseBoolean(getOwnDataProperty(value, "merged")),
  });
}

function parseChecks(value: unknown): GithubState["checks"] {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, checkKeys);
  return Object.freeze({
    engineering: parseOptionalString(getOwnDataProperty(value, "engineering")),
    merge_ready: parseOptionalString(getOwnDataProperty(value, "merge_ready")),
  });
}

function parseReviews(value: unknown): GithubState["reviews"] {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, reviewKeys);
  const required = parseCount(getOwnDataProperty(value, "required_count"));
  const submitted = parseCount(getOwnDataProperty(value, "submitted_count"));
  return Object.freeze({
    required_count: required,
    submitted_count: submitted,
    codeowners_satisfied: parseBoolean(
      getOwnDataProperty(value, "codeowners_satisfied"),
    ),
    approval_fresh: parseBoolean(getOwnDataProperty(value, "approval_fresh")),
  });
}

function parseQueue(value: unknown): GithubState["queue"] {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, queueKeys);
  const present = parseBoolean(getOwnDataProperty(value, "present"));
  const candidateSha = parseOptionalString(getOwnDataProperty(value, "candidate_sha"));
  if (!present && candidateSha !== null) {
    invalidInput();
  }
  return Object.freeze({
    present,
    candidate_sha: candidateSha,
  });
}

function parseMerge(value: unknown): GithubState["merge"] {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, mergeKeys);
  const mode = getOwnDataProperty(value, "mode");
  if (!knownMergeModes.has(mode)) {
    invalidInput();
  }
  return Object.freeze({
    mode: mode as MergeMode,
    merged_sha: parseOptionalString(getOwnDataProperty(value, "merged_sha")),
  });
}

export function parseGithubState(value: unknown): GithubState {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, inputKeys);
  if (getOwnDataProperty(value, "authenticated") !== true) {
    invalidInput();
  }
  const pullRequest = parsePullRequest(getOwnDataProperty(value, "pull_request"));
  const merge = parseMerge(getOwnDataProperty(value, "merge"));
  const merged = pullRequest !== null && pullRequest.merged;
  if (merged !== (merge.merged_sha !== null)) {
    invalidInput();
  }
  if (pullRequest !== null && pullRequest.merged && pullRequest.draft) {
    invalidInput();
  }

  return Object.freeze({
    schema_version: 1,
    authenticated: true,
    actor: parseActor(getOwnDataProperty(value, "actor")),
    repository: parseRepository(getOwnDataProperty(value, "repository")),
    pull_request: pullRequest,
    checks: parseChecks(getOwnDataProperty(value, "checks")),
    reviews: parseReviews(getOwnDataProperty(value, "reviews")),
    queue: parseQueue(getOwnDataProperty(value, "queue")),
    merge,
  });
}
