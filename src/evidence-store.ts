import { randomUUID } from "node:crypto";
import {
  chmod,
  constants,
  link,
  lstat,
  mkdir,
  open,
  readdir,
  unlink,
} from "node:fs/promises";
import path from "node:path";

import { parseSha256Digest } from "./domain.ts";
import type { Sha256Digest } from "./domain.ts";
import {
  isUncertainEvidenceKey,
  serializeCanonical,
} from "./evidence-key.ts";
import type {
  EvidenceKey,
  EvidenceKeyResult,
  UncertainEvidenceKey,
} from "./evidence-key.ts";
import { isRunCatalogIdentifier } from "./run-catalog.ts";
import { GATE_RESULTS, RUNNER_ATTEMPTS } from "./run-state.ts";
import type { GateResult, RunnerAttempt } from "./run-state.ts";

export type Measurement = Readonly<{
  schema_version: 1;
  id: string;
  task_id: string;
  gate_id: string;
  measured_sha: string;
  base_sha: string;
  policy_digest: Sha256Digest;
  runner_digest: Sha256Digest;
  template_digest: Sha256Digest;
  input_digest: Sha256Digest;
  environment_digest: Sha256Digest;
  oracle_digest: Sha256Digest | null;
  deliberate_attempt: number;
  outcome: RunnerAttempt;
  structured_observations: Readonly<Record<never, never>>;
  artifacts: readonly string[];
  runner_identity: string;
  authoritative: boolean;
}>;

export type ReuseDecision = Readonly<{
  schema_version: 1;
  id: string;
  kind: "reuse" | "stale";
  measurement_id: string | null;
  evidence_key: EvidenceKey | UncertainEvidenceKey;
}>;

export type ConsultResult =
  | Readonly<{
      status: "reused";
      result: GateResult;
      measurement: Measurement;
      decision: ReuseDecision;
    }>
  | Readonly<{
      status: "stale";
      decision: ReuseDecision;
    }>
  | Readonly<{
      status: "missing";
    }>;

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

const measurementKeysWithoutAuthoritative = measurementKeys.filter(
  (key) => key !== "authoritative",
);

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

function invalidMeasurement(): never {
  throw new TypeError("Invalid evidence measurement");
}

function invalidConsult(): never {
  throw new TypeError("Invalid evidence key");
}

function getOwnDataProperty(object: object, key: PropertyKey): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (descriptor === undefined || !("value" in descriptor)) {
    invalidMeasurement();
  }
  return descriptor.value;
}

function ownKeyNames(value: object): string[] {
  return Reflect.ownKeys(value).map((key) => {
    if (typeof key !== "string") {
      invalidMeasurement();
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
    invalidMeasurement();
  }
}

function assertNonEmptyString(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    invalidMeasurement();
  }
}

function parseDigest(value: unknown): Sha256Digest {
  if (typeof value !== "string") {
    invalidMeasurement();
  }
  return parseSha256Digest(value);
}

function parseOptionalDigest(value: unknown): Sha256Digest | null {
  if (value === null) {
    return null;
  }
  return parseDigest(value);
}

function parseArtifacts(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    invalidMeasurement();
  }
  const length = getOwnDataProperty(value, "length");
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) {
    invalidMeasurement();
  }
  const captured: string[] = [];
  for (let index = 0; index < length; index += 1) {
    const token = getOwnDataProperty(value, index);
    assertNonEmptyString(token);
    captured[index] = token;
  }
  return Object.freeze(captured);
}

function parseObservations(value: unknown): Readonly<Record<never, never>> {
  if (!isPlainObject(value)) {
    invalidMeasurement();
  }
  if (ownKeyNames(value).length !== 0) {
    invalidMeasurement();
  }
  return Object.freeze({});
}

function parseMeasurement(value: unknown, authoritative: boolean): Measurement {
  if (!isPlainObject(value)) {
    invalidMeasurement();
  }
  const keys = ownKeyNames(value);
  if (keys.includes("authoritative")) {
    assertExactKeys(value, measurementKeys);
    const claimed = getOwnDataProperty(value, "authoritative");
    if (typeof claimed !== "boolean") {
      invalidMeasurement();
    }
    if (authoritative === false && claimed === true) {
      throw new TypeError("Callers cannot write authoritative measurements");
    }
    if (authoritative === true && claimed === false) {
      invalidMeasurement();
    }
  } else {
    assertExactKeys(value, measurementKeysWithoutAuthoritative);
  }

  const schemaVersion = getOwnDataProperty(value, "schema_version");
  const id = getOwnDataProperty(value, "id");
  const taskId = getOwnDataProperty(value, "task_id");
  const gateId = getOwnDataProperty(value, "gate_id");
  const measuredSha = getOwnDataProperty(value, "measured_sha");
  const baseSha = getOwnDataProperty(value, "base_sha");
  const attempt = getOwnDataProperty(value, "deliberate_attempt");
  const outcome = getOwnDataProperty(value, "outcome");
  const runnerIdentity = getOwnDataProperty(value, "runner_identity");
  if (
    schemaVersion !== 1 ||
    !isRunCatalogIdentifier(id) ||
    typeof taskId !== "string" ||
    taskId.length === 0
  ) {
    invalidMeasurement();
  }
  if (typeof gateId !== "string" || !gateIdPattern.test(gateId)) {
    invalidMeasurement();
  }
  assertNonEmptyString(measuredSha);
  assertNonEmptyString(baseSha);
  assertNonEmptyString(runnerIdentity);
  if (typeof attempt !== "number" || !Number.isSafeInteger(attempt) || attempt < 1) {
    invalidMeasurement();
  }
  if (!knownOutcomes.has(outcome)) {
    invalidMeasurement();
  }

  return Object.freeze({
    schema_version: 1,
    id,
    task_id: taskId,
    gate_id: gateId,
    measured_sha: measuredSha,
    base_sha: baseSha,
    policy_digest: parseDigest(getOwnDataProperty(value, "policy_digest")),
    runner_digest: parseDigest(getOwnDataProperty(value, "runner_digest")),
    template_digest: parseDigest(getOwnDataProperty(value, "template_digest")),
    input_digest: parseDigest(getOwnDataProperty(value, "input_digest")),
    environment_digest: parseDigest(getOwnDataProperty(value, "environment_digest")),
    oracle_digest: parseOptionalDigest(getOwnDataProperty(value, "oracle_digest")),
    deliberate_attempt: attempt,
    outcome: outcome as RunnerAttempt,
    structured_observations: parseObservations(
      getOwnDataProperty(value, "structured_observations"),
    ),
    artifacts: parseArtifacts(getOwnDataProperty(value, "artifacts")),
    runner_identity: runnerIdentity,
    authoritative,
  });
}

function serializeRecord(value: object): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function keyFromMeasurement(measurement: Measurement): EvidenceKey {
  return Object.freeze({
    schema_version: 1,
    gate_id: measurement.gate_id,
    template_digest: measurement.template_digest,
    input_digest: measurement.input_digest,
    environment_digest: measurement.environment_digest,
    oracle_digest: measurement.oracle_digest,
  });
}

function parseEvidenceKey(value: unknown): EvidenceKey {
  if (!isPlainObject(value)) {
    invalidConsult();
  }
  assertExactKeys(value, evidenceKeyFields);
  const schemaVersion = getOwnDataProperty(value, "schema_version");
  const gateId = getOwnDataProperty(value, "gate_id");
  if (schemaVersion !== 1 || typeof gateId !== "string" || !gateIdPattern.test(gateId)) {
    invalidConsult();
  }
  return Object.freeze({
    schema_version: 1,
    gate_id: gateId,
    template_digest: parseDigest(getOwnDataProperty(value, "template_digest")),
    input_digest: parseDigest(getOwnDataProperty(value, "input_digest")),
    environment_digest: parseDigest(getOwnDataProperty(value, "environment_digest")),
    oracle_digest: parseOptionalDigest(getOwnDataProperty(value, "oracle_digest")),
  });
}

function parseConsultKey(value: unknown): EvidenceKey | UncertainEvidenceKey {
  if (isUncertainEvidenceKey(value as EvidenceKeyResult)) {
    if (!isPlainObject(value)) {
      invalidConsult();
    }
    assertExactKeys(value, ["kind", "reason"]);
    const reason = getOwnDataProperty(value, "reason");
    if (reason !== "uncertain_dependency_selection") {
      invalidConsult();
    }
    return Object.freeze({
      kind: "uncertain",
      reason: "uncertain_dependency_selection",
    });
  }
  return parseEvidenceKey(value);
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

function compareMeasurements(left: Measurement, right: Measurement): number {
  if (left.deliberate_attempt !== right.deliberate_attempt) {
    return left.deliberate_attempt - right.deliberate_attempt;
  }
  return compareUtf8(left.id, right.id);
}

function productHistory(measurements: readonly Measurement[]): Measurement[] {
  const product: Measurement[] = [];
  for (let index = 0; index < measurements.length; index += 1) {
    const candidate = measurements[index];
    if (
      candidate !== undefined &&
      candidate.authoritative &&
      productOutcomes.has(candidate.outcome)
    ) {
      product.push(candidate);
    }
  }
  product.sort(compareMeasurements);
  return product;
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

function historyResult(product: readonly Measurement[]): GateResult | null {
  if (stickyFlaky(product)) {
    return GATE_RESULTS.FLAKY;
  }
  const latest = product[product.length - 1];
  if (latest === undefined) {
    return null;
  }
  return latest.outcome === RUNNER_ATTEMPTS.PRODUCT_PASS
    ? GATE_RESULTS.PASS
    : GATE_RESULTS.FAIL;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

function isMissing(error: unknown): boolean {
  return hasErrorCode(error, "ENOENT");
}

async function syncDirectory(directory: string): Promise<void> {
  if (process.platform === "win32") {
    return;
  }
  const handle = await open(directory, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export class FileEvidenceStore {
  readonly #directory: string;

  constructor(directory: string) {
    if (typeof directory !== "string" || directory.length === 0) {
      throw new TypeError("Invalid evidence directory");
    }
    this.#directory = path.resolve(directory);
  }

  async appendAdvisory(value: unknown): Promise<Measurement> {
    return this.#appendMeasurement(parseMeasurement(value, false));
  }

  async appendAuthoritative(value: unknown): Promise<Measurement> {
    return this.#appendMeasurement(parseMeasurement(value, true));
  }

  async consult(key: unknown): Promise<ConsultResult> {
    const parsed = parseConsultKey(key);
    if (isUncertainEvidenceKey(parsed)) {
      const decision = await this.#appendDecision({
        schema_version: 1,
        id: `d-${randomUUID()}`,
        kind: "stale",
        measurement_id: null,
        evidence_key: parsed,
      });
      return Object.freeze({
        status: "stale",
        decision,
      });
    }

    const matching = (await this.#loadMeasurements()).filter(
      (candidate) =>
        candidate.authoritative &&
        serializeCanonical(keyFromMeasurement(candidate)) ===
          serializeCanonical(parsed),
    );
    matching.sort(compareMeasurements);
    const product = productHistory(matching);
    const result = historyResult(product);
    const first = matching[0];
    if (result === null || first === undefined) {
      return Object.freeze({ status: "missing" });
    }

    const decision = await this.#appendDecision({
      schema_version: 1,
      id: `d-${randomUUID()}`,
      kind: "reuse",
      measurement_id: first.id,
      evidence_key: parsed,
    });
    return Object.freeze({
      status: "reused",
      result,
      measurement: first,
      decision,
    });
  }

  async list(): Promise<readonly Measurement[]> {
    const loaded = await this.#readExistingMeasurements();
    loaded.sort(compareMeasurements);
    return Object.freeze(loaded);
  }

  async #appendMeasurement(measurement: Measurement): Promise<Measurement> {
    await this.#prepareDirectory(this.#measurementsDirectory());
    await this.#publishExclusive(
      this.#measurementPath(measurement.id),
      serializeRecord(measurement),
    );
    return measurement;
  }

  async #appendDecision(decision: ReuseDecision): Promise<ReuseDecision> {
    const frozen = Object.freeze({
      schema_version: 1 as const,
      id: decision.id,
      kind: decision.kind,
      measurement_id: decision.measurement_id,
      evidence_key: decision.evidence_key,
    });
    await this.#prepareDirectory(this.#decisionsDirectory());
    await this.#publishExclusive(
      this.#decisionPath(frozen.id),
      serializeRecord(frozen),
    );
    return frozen;
  }

  async #loadMeasurements(): Promise<Measurement[]> {
    await this.#prepareDirectory(this.#measurementsDirectory());
    return this.#readExistingMeasurements();
  }

  async #readExistingMeasurements(): Promise<Measurement[]> {
    let entries: string[];
    try {
      entries = await readdir(this.#measurementsDirectory());
    } catch (error) {
      if (isMissing(error)) {
        return [];
      }
      throw error;
    }
    const loaded: Measurement[] = [];
    for (let index = 0; index < entries.length; index += 1) {
      const name = entries[index];
      if (name === undefined || name.startsWith(".") || !name.endsWith(".json")) {
        continue;
      }
      const contents = await this.#readFile(
        path.join(this.#measurementsDirectory(), name),
      );
      if (contents === null) {
        continue;
      }
      try {
        const parsed = JSON.parse(contents) as unknown;
        const authoritative = isPlainObject(parsed)
          ? getOwnDataProperty(parsed, "authoritative") === true
          : false;
        loaded.push(parseMeasurement(parsed, authoritative === true));
      } catch (error) {
        throw new Error(`Corrupt evidence record ${name}`, { cause: error });
      }
    }
    return loaded;
  }

  async #publishExclusive(targetPath: string, contents: string): Promise<void> {
    const existing = await this.#readFile(targetPath);
    if (existing !== null) {
      if (existing === contents) {
        return;
      }
      throw new Error(`Conflicting evidence record for ${path.basename(targetPath)}`);
    }
    const temporaryPath = path.join(
      path.dirname(targetPath),
      `.${path.basename(targetPath)}.${randomUUID()}.tmp`,
    );
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(temporaryPath, "wx", 0o600);
      await handle.writeFile(contents, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await link(temporaryPath, targetPath);
      await unlink(temporaryPath);
      await syncDirectory(path.dirname(targetPath));
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await unlink(temporaryPath).catch((unlinkError: unknown) => {
        if (!isMissing(unlinkError)) {
          throw unlinkError;
        }
      });
      if (hasErrorCode(error, "EEXIST")) {
        const published = await this.#readFile(targetPath);
        if (published === contents) {
          return;
        }
        throw new Error(
          `Conflicting evidence record for ${path.basename(targetPath)}`,
        );
      }
      throw error;
    }
  }

  async #readFile(recordPath: string): Promise<string | null> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      const pathMetadata = await lstat(recordPath);
      if (!pathMetadata.isFile()) {
        throw new TypeError("Evidence record is not a regular file");
      }
      handle = await open(
        recordPath,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      return await handle.readFile("utf8");
    } catch (error) {
      if (isMissing(error)) {
        return null;
      }
      throw error;
    } finally {
      await handle?.close();
    }
  }

  async #prepareDirectory(directory: string): Promise<void> {
    await mkdir(this.#directory, { recursive: true, mode: 0o700 });
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const rootMetadata = await lstat(this.#directory);
    const metadata = await lstat(directory);
    if (
      !rootMetadata.isDirectory() ||
      rootMetadata.isSymbolicLink() ||
      !metadata.isDirectory() ||
      metadata.isSymbolicLink()
    ) {
      throw new TypeError("Invalid evidence directory");
    }
    if (process.platform !== "win32") {
      await chmod(this.#directory, 0o700);
      await chmod(directory, 0o700);
    }
  }

  #measurementsDirectory(): string {
    return path.join(this.#directory, "measurements");
  }

  #decisionsDirectory(): string {
    return path.join(this.#directory, "decisions");
  }

  #measurementPath(id: string): string {
    return path.join(this.#measurementsDirectory(), `${id}.json`);
  }

  #decisionPath(id: string): string {
    return path.join(this.#decisionsDirectory(), `${id}.json`);
  }
}
