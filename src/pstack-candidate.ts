import { isRunCatalogIdentifier } from "./run-catalog.ts";

export type AdvisoryObservation = Readonly<{
  kind: "diagnostic" | "self_check";
  summary: string;
}>;

export type PstackCandidate = Readonly<{
  schema_version: 1;
  task_id: string;
  candidate_sha: string;
  changed_paths: readonly string[];
  observations: readonly AdvisoryObservation[];
  claimed_result: string | null;
  authoritative: false;
}>;

const inputKeys = [
  "task_id",
  "candidate_sha",
  "changed_paths",
  "observations",
  "claimed_result",
] as const;
const observationKeys = ["kind", "summary"] as const;
const knownObservationKinds = new Set(["diagnostic", "self_check"]);

function invalidInput(): never {
  throw new TypeError("Invalid candidate input");
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

function parseObservation(value: unknown): AdvisoryObservation {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, observationKeys);
  const kind = getOwnDataProperty(value, "kind");
  if (typeof kind !== "string" || !knownObservationKinds.has(kind)) {
    invalidInput();
  }
  return Object.freeze({
    kind: kind as AdvisoryObservation["kind"],
    summary: parseRequiredString(getOwnDataProperty(value, "summary")),
  });
}

function parseClaimedResult(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  return parseRequiredString(value);
}

export function collectCandidate(value: unknown): PstackCandidate {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, inputKeys);
  const taskId = getOwnDataProperty(value, "task_id");
  if (!isRunCatalogIdentifier(taskId)) {
    invalidInput();
  }
  const changedPaths = [...parseStringList(
    getOwnDataProperty(value, "changed_paths"),
    parseRelativePath,
  )];
  if (changedPaths.length === 0) {
    invalidInput();
  }
  changedPaths.sort(compareUtf8);
  const observations = Object.freeze(
    captureDenseList(getOwnDataProperty(value, "observations"), parseObservation),
  );

  return Object.freeze({
    schema_version: 1,
    task_id: taskId,
    candidate_sha: parseRequiredString(getOwnDataProperty(value, "candidate_sha")),
    changed_paths: Object.freeze(changedPaths),
    observations,
    claimed_result: parseClaimedResult(getOwnDataProperty(value, "claimed_result")),
    authoritative: false,
  });
}
