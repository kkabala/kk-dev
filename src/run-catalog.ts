import { createHash, randomUUID } from "node:crypto";
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

import type { Task } from "./domain.ts";

export type RunCatalogRecord = Readonly<{
  schema_version: 1;
  run_id: string;
  task: Task;
}>;

const identifierPattern = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const windowsReservedName = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/u;
const recordKeys = ["schema_version", "run_id", "task"] as const;
const taskKeys = [
  "schema_version",
  "task_id",
  "requested_outcome",
  "source",
] as const;
const sourceKeys = ["kind", "content_digest"] as const;

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

export function isRunCatalogIdentifier(value: unknown): value is string {
  return typeof value === "string" &&
    identifierPattern.test(value) &&
    !value.endsWith(".") &&
    !windowsReservedName.test(value);
}

function assertIdentifier(value: unknown): asserts value is string {
  if (!isRunCatalogIdentifier(value)) {
    throw new TypeError("Invalid task or run identifier");
  }
}

function getOwnDataProperty(object: object, key: PropertyKey): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (descriptor === undefined || !("value" in descriptor)) {
    throw new TypeError("Invalid run catalog record");
  }
  return descriptor.value;
}

function assertExactKeys(value: object, expected: readonly string[]): void {
  const keys = Reflect.ownKeys(value).sort();
  const sortedExpected = [...expected].sort();
  if (
    keys.length !== sortedExpected.length ||
    keys.some(
      (key, index) =>
        typeof key !== "string" || key !== sortedExpected[index],
    )
  ) {
    throw new TypeError("Invalid run catalog record");
  }
}

function normalizeRecord(value: unknown): RunCatalogRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Invalid run catalog record");
  }
  assertExactKeys(value, recordKeys);

  const schemaVersion = getOwnDataProperty(value, "schema_version");
  const runId = getOwnDataProperty(value, "run_id");
  const taskValue = getOwnDataProperty(value, "task");
  if (
    schemaVersion !== 1 ||
    typeof taskValue !== "object" ||
    taskValue === null ||
    Array.isArray(taskValue)
  ) {
    throw new TypeError("Invalid run catalog record");
  }
  assertIdentifier(runId);
  assertExactKeys(taskValue, taskKeys);

  const taskSchemaVersion = getOwnDataProperty(taskValue, "schema_version");
  const taskId = getOwnDataProperty(taskValue, "task_id");
  const requestedOutcome = getOwnDataProperty(taskValue, "requested_outcome");
  const sourceValue = getOwnDataProperty(taskValue, "source");
  if (
    taskSchemaVersion !== 1 ||
    typeof requestedOutcome !== "string" ||
    requestedOutcome.trim().length === 0 ||
    typeof sourceValue !== "object" ||
    sourceValue === null ||
    Array.isArray(sourceValue)
  ) {
    throw new TypeError("Invalid run catalog record");
  }
  assertIdentifier(taskId);
  assertExactKeys(sourceValue, sourceKeys);

  const sourceKind = getOwnDataProperty(sourceValue, "kind");
  const contentDigest = getOwnDataProperty(sourceValue, "content_digest");
  const expectedDigest = `sha256:${createHash("sha256")
    .update(requestedOutcome)
    .digest("hex")}`;
  if (sourceKind !== "direct_text" || contentDigest !== expectedDigest) {
    throw new TypeError("Invalid run catalog record");
  }

  const source = Object.freeze({
    kind: "direct_text" as const,
    content_digest: contentDigest as Task["source"]["content_digest"],
  });
  const task = Object.freeze({
    schema_version: 1 as const,
    task_id: taskId,
    requested_outcome: requestedOutcome,
    source,
  });
  return Object.freeze({
    schema_version: 1,
    run_id: runId,
    task,
  });
}

function serializeRecord(record: RunCatalogRecord): string {
  return `${JSON.stringify({
    schema_version: record.schema_version,
    run_id: record.run_id,
    task: {
      schema_version: record.task.schema_version,
      task_id: record.task.task_id,
      requested_outcome: record.task.requested_outcome,
      source: {
        kind: record.task.source.kind,
        content_digest: record.task.source.content_digest,
      },
    },
  }, null, 2)}\n`;
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

export class FileRunCatalog {
  readonly #directory: string;

  constructor(directory: string) {
    if (typeof directory !== "string" || directory.length === 0) {
      throw new TypeError("Invalid run catalog directory");
    }
    this.#directory = path.resolve(directory);
  }

  async create(value: RunCatalogRecord): Promise<RunCatalogRecord> {
    const record = await this.stage(value);
    return this.commit(record.task.task_id);
  }

  async stage(value: RunCatalogRecord): Promise<RunCatalogRecord> {
    const record = normalizeRecord(value);
    await this.#prepareDirectory(true);
    const pendingPath = this.#pendingPath(record.task.task_id);
    await this.#publishExclusive(record, pendingPath);
    try {
      if (
        await this.#loadAt(
          record.task.task_id,
          this.#recordPath(record.task.task_id),
        )
      ) {
        throw new Error(`Task ${record.task.task_id} already exists`);
      }
    } catch (error) {
      await unlink(pendingPath).catch((unlinkError: unknown) => {
        if (!isMissing(unlinkError)) {
          throw unlinkError;
        }
      });
      await syncDirectory(this.#directory);
      throw error;
    }
    return record;
  }

  async commit(taskId: string): Promise<RunCatalogRecord> {
    assertIdentifier(taskId);
    await this.#prepareDirectory(true);
    const pendingPath = this.#pendingPath(taskId);
    const committedPath = this.#recordPath(taskId);
    const pending = await this.#loadAt(taskId, pendingPath);
    if (pending === null) {
      const committed = await this.#loadAt(taskId, committedPath);
      if (committed === null) {
        throw new Error(`No pending run catalog entry for task ${taskId}`);
      }
      return committed;
    }

    try {
      await link(pendingPath, committedPath);
    } catch (error) {
      if (!hasErrorCode(error, "EEXIST") && !isMissing(error)) {
        throw error;
      }
      const committed = await this.#loadAt(taskId, committedPath);
      if (
        committed === null ||
        serializeRecord(committed) !== serializeRecord(pending)
      ) {
        throw new Error(`Conflicting run catalog entry for task ${taskId}`);
      }
    }
    await syncDirectory(this.#directory);
    await unlink(pendingPath).catch((error: unknown) => {
      if (!isMissing(error)) {
        throw error;
      }
    });
    await syncDirectory(this.#directory);
    return pending;
  }

  async #publishExclusive(
    record: RunCatalogRecord,
    targetPath: string,
  ): Promise<void> {
    const temporaryPath = path.join(
      this.#directory,
      `.${record.task.task_id}.${randomUUID()}.task.tmp`,
    );
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(temporaryPath, "wx", 0o600);
      await handle.writeFile(serializeRecord(record), "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await link(temporaryPath, targetPath);
      await unlink(temporaryPath);
      await syncDirectory(this.#directory);
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }

  async load(taskId: string): Promise<RunCatalogRecord | null> {
    assertIdentifier(taskId);
    if (!(await this.#prepareDirectory(false))) {
      return null;
    }
    return this.#loadAt(taskId, this.#recordPath(taskId));
  }

  async loadPending(taskId: string): Promise<RunCatalogRecord | null> {
    assertIdentifier(taskId);
    if (!(await this.#prepareDirectory(false))) {
      return null;
    }
    return this.#loadAt(taskId, this.#pendingPath(taskId));
  }

  async #loadAt(
    taskId: string,
    recordPath: string,
  ): Promise<RunCatalogRecord | null> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      const pathMetadata = await lstat(recordPath);
      if (!pathMetadata.isFile()) {
        throw new TypeError("Run catalog entry is not a regular file");
      }
      handle = await open(
        recordPath,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      const openedMetadata = await handle.stat();
      if (!openedMetadata.isFile()) {
        throw new TypeError("Run catalog entry is not a regular file");
      }
      const record = normalizeRecord(
        JSON.parse(await handle.readFile("utf8")) as unknown,
      );
      if (record.task.task_id !== taskId) {
        throw new TypeError("Task identifier does not match its catalog file");
      }
      return record;
    } catch (error) {
      if (isMissing(error)) {
        return null;
      }
      if (
        error instanceof TypeError ||
        error instanceof SyntaxError ||
        hasErrorCode(error, "ELOOP") ||
        hasErrorCode(error, "EISDIR") ||
        hasErrorCode(error, "ENXIO")
      ) {
        throw new Error(`Corrupt run catalog entry for ${taskId}`, {
          cause: error,
        });
      }
      throw error;
    } finally {
      await handle?.close();
    }
  }

  async list(): Promise<readonly RunCatalogRecord[]> {
    if (!(await this.#prepareDirectory(false))) {
      return Object.freeze([]);
    }

    const suffix = ".task.json";
    const taskIds = (await readdir(this.#directory))
      .filter((name) => name.endsWith(suffix))
      .map((name) => name.slice(0, -suffix.length))
      .sort();
    const records: RunCatalogRecord[] = [];
    for (const taskId of taskIds) {
      const record = await this.load(taskId);
      if (record === null) {
        throw new Error(`Run catalog entry disappeared for ${taskId}`);
      }
      records.push(record);
    }
    return Object.freeze(records);
  }

  async listPending(): Promise<readonly RunCatalogRecord[]> {
    if (!(await this.#prepareDirectory(false))) {
      return Object.freeze([]);
    }

    const prefix = ".";
    const suffix = ".pending-task.json";
    const taskIds = (await readdir(this.#directory))
      .filter((name) => name.startsWith(prefix) && name.endsWith(suffix))
      .map((name) => name.slice(prefix.length, -suffix.length))
      .sort();
    const records: RunCatalogRecord[] = [];
    for (const taskId of taskIds) {
      const record = await this.loadPending(taskId);
      if (record === null) {
        const committed = await this.load(taskId);
        if (committed === null) {
          throw new Error(`Pending run catalog entry disappeared for ${taskId}`);
        }
        continue;
      }
      records.push(record);
    }
    return Object.freeze(records);
  }

  async #prepareDirectory(create: boolean): Promise<boolean> {
    if (create) {
      await mkdir(this.#directory, { recursive: true, mode: 0o700 });
    }
    let metadata: Awaited<ReturnType<typeof lstat>>;
    try {
      metadata = await lstat(this.#directory);
    } catch (error) {
      if (!create && isMissing(error)) {
        return false;
      }
      throw error;
    }
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new TypeError("Invalid run catalog directory");
    }
    if (create && process.platform !== "win32") {
      await chmod(this.#directory, 0o700);
    } else if (
      !create &&
      process.platform !== "win32" &&
      (metadata.mode & 0o077) !== 0
    ) {
      throw new TypeError("Insecure run catalog directory");
    }
    return true;
  }

  #recordPath(taskId: string): string {
    return path.join(this.#directory, `${taskId}.task.json`);
  }

  #pendingPath(taskId: string): string {
    return path.join(this.#directory, `.${taskId}.pending-task.json`);
  }
}
