import { randomUUID } from "node:crypto";
import {
  chmod,
  constants,
  link,
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { RUN_STATES } from "./domain.ts";
import type { RunState } from "./domain.ts";

export type PersistedRunState = Readonly<{
  schema_version: 1;
  run_id: string;
  task_id: string;
  state: RunState;
  revision: number;
}>;

const runIdPattern = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const windowsReservedName = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/u;
const knownRunStates = new Set<unknown>(Object.values(RUN_STATES));
const persistedKeys = [
  "schema_version",
  "run_id",
  "task_id",
  "state",
  "revision",
] as const;

function assertRunId(runId: unknown): asserts runId is string {
  if (
    typeof runId !== "string" ||
    !runIdPattern.test(runId) ||
    runId.endsWith(".") ||
    windowsReservedName.test(runId)
  ) {
    throw new TypeError("Invalid run identifier");
  }
}

function isRunState(value: unknown): value is RunState {
  return knownRunStates.has(value);
}

function getOwnDataProperty(object: object, key: PropertyKey): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (descriptor === undefined || !("value" in descriptor)) {
    throw new TypeError("Invalid persisted run state");
  }

  return descriptor.value;
}

function normalizeSnapshot(value: unknown): PersistedRunState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Invalid persisted run state");
  }

  const keys = Reflect.ownKeys(value).sort((left, right) =>
    String(left).localeCompare(String(right)),
  );
  const expectedKeys = [...persistedKeys].sort();
  if (
    keys.length !== expectedKeys.length ||
    keys.some(
      (key, index) => typeof key !== "string" || key !== expectedKeys[index],
    )
  ) {
    throw new TypeError("Invalid persisted run state");
  }

  const schemaVersion = getOwnDataProperty(value, "schema_version");
  const runId = getOwnDataProperty(value, "run_id");
  const taskId = getOwnDataProperty(value, "task_id");
  const state = getOwnDataProperty(value, "state");
  const revision = getOwnDataProperty(value, "revision");

  assertRunId(runId);
  if (
    schemaVersion !== 1 ||
    typeof taskId !== "string" ||
    taskId.length === 0 ||
    !isRunState(state) ||
    typeof revision !== "number" ||
    !Number.isSafeInteger(revision) ||
    revision < 0
  ) {
    throw new TypeError("Invalid persisted run state");
  }

  return Object.freeze({
    schema_version: 1,
    run_id: runId,
    task_id: taskId,
    state,
    revision,
  });
}

function serializeSnapshot(snapshot: PersistedRunState): string {
  return `${JSON.stringify({
    schema_version: snapshot.schema_version,
    run_id: snapshot.run_id,
    task_id: snapshot.task_id,
    state: snapshot.state,
    revision: snapshot.revision,
  }, null, 2)}\n`;
}

function isFileMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
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

export class FileRunStateStore {
  readonly #directory: string;
  #pendingSave: Promise<void> = Promise.resolve();

  constructor(directory: string) {
    if (typeof directory !== "string" || directory.length === 0) {
      throw new TypeError("Invalid run-state store directory");
    }

    this.#directory = path.resolve(directory);
  }

  async load(runId: string): Promise<PersistedRunState | null> {
    assertRunId(runId);
    if (!(await this.#prepareDirectory(false))) {
      return null;
    }
    return this.#loadValidated(runId);
  }

  save(snapshot: PersistedRunState): Promise<void> {
    let normalized: PersistedRunState;
    try {
      normalized = normalizeSnapshot(snapshot);
    } catch (error) {
      return Promise.reject(error);
    }

    const operation = this.#pendingSave.then(() =>
      this.#saveNow(normalized, false)
    );
    this.#pendingSave = operation.catch(() => undefined);
    return operation;
  }

  initialize(snapshot: PersistedRunState): Promise<void> {
    let normalized: PersistedRunState;
    try {
      normalized = normalizeSnapshot(snapshot);
      if (
        normalized.state !== RUN_STATES.INTAKE ||
        normalized.revision !== 0
      ) {
        throw new TypeError("Invalid initial run state");
      }
    } catch (error) {
      return Promise.reject(error);
    }

    const operation = this.#pendingSave.then(() =>
      this.#saveNow(normalized, true)
    );
    this.#pendingSave = operation.catch(() => undefined);
    return operation;
  }

  async #loadValidated(runId: string): Promise<PersistedRunState | null> {
    let contents: string;
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      const pathMetadata = await lstat(this.#committedPath(runId));
      if (!pathMetadata.isFile()) {
        throw new TypeError("Committed run state is not a regular file");
      }
      handle = await open(
        this.#committedPath(runId),
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      const metadata = await handle.stat();
      if (!metadata.isFile()) {
        throw new TypeError("Committed run state is not a regular file");
      }
      contents = await handle.readFile("utf8");
    } catch (error) {
      if (isFileMissing(error)) {
        return null;
      }
      if (
        error instanceof TypeError ||
        hasErrorCode(error, "ELOOP") ||
        hasErrorCode(error, "EISDIR") ||
        hasErrorCode(error, "ENXIO")
      ) {
        throw new Error(`Corrupt persisted run state for ${runId}`, {
          cause: error,
        });
      }
      throw error;
    } finally {
      await handle?.close();
    }

    try {
      const snapshot = normalizeSnapshot(JSON.parse(contents) as unknown);
      if (snapshot.run_id !== runId) {
        throw new TypeError("Persisted run identifier does not match its file");
      }
      return snapshot;
    } catch (error) {
      throw new Error(`Corrupt persisted run state for ${runId}`, {
        cause: error,
      });
    }
  }

  async #saveNow(
    normalized: PersistedRunState,
    acceptIdentical: boolean,
  ): Promise<void> {
    await this.#prepareDirectory(true);
    const lockHandle = await this.#acquireLock(normalized.run_id);
    let operationError: unknown;
    try {
      await this.#commitLocked(normalized, acceptIdentical);
    } catch (error) {
      operationError = error;
    }

    const releaseError = await this.#releaseLock(
      normalized.run_id,
      lockHandle,
    ).catch((error: unknown) => error);
    if (operationError !== undefined) {
      throw operationError;
    }
    if (releaseError !== undefined) {
      throw releaseError;
    }
  }

  async #commitLocked(
    normalized: PersistedRunState,
    acceptIdentical: boolean,
  ): Promise<void> {
    const current = await this.#loadValidated(normalized.run_id);
    if (current !== null) {
      if (normalized.task_id !== current.task_id) {
        throw new Error(
          `Run ${normalized.run_id} belongs to task ${current.task_id}, ` +
          `not ${normalized.task_id}`,
        );
      }
      if (
        acceptIdentical &&
        serializeSnapshot(normalized) === serializeSnapshot(current)
      ) {
        return;
      }
      if (normalized.revision <= current.revision) {
        throw new Error(
          `Stale run-state revision for ${normalized.run_id}: ` +
            `${normalized.revision} <= ${current.revision}`,
        );
      }
    }

    const temporaryPath = path.join(
      this.#directory,
      `.${normalized.run_id}.${randomUUID()}.tmp`,
    );
    const committedPath = this.#committedPath(normalized.run_id);
    let handle: Awaited<ReturnType<typeof open>> | undefined;

    try {
      handle = await open(temporaryPath, "wx", 0o600);
      await handle.writeFile(serializeSnapshot(normalized), "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporaryPath, committedPath);
      await syncDirectory(this.#directory);
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await unlink(temporaryPath).catch((unlinkError: unknown) => {
        if (!isFileMissing(unlinkError)) {
          throw unlinkError;
        }
      });
      throw error;
    }
  }

  async #acquireLock(
    runId: string,
  ): Promise<Awaited<ReturnType<typeof open>>> {
    const lockPath = this.#lockPath(runId);
    const deadline = Date.now() + 10_000;
    await this.#cleanupDeadCandidates(runId);

    while (true) {
      if (await this.#hasRecoveryParticipants(runId)) {
        this.#assertLockDeadline(runId, deadline);
        await delay(5);
        continue;
      }

      const candidatePath = path.join(
        this.#directory,
        `.${runId}~candidate~${process.pid}.${randomUUID()}`,
      );
      const handle = await open(candidatePath, "wx", 0o600);
      try {
        await handle.writeFile(`${process.pid}\n`, "utf8");
        await handle.sync();
      } catch (error) {
        await handle.close().catch(() => undefined);
        await unlink(candidatePath).catch(() => undefined);
        throw error;
      }

      try {
        if (await this.#hasRecoveryParticipants(runId)) {
          await handle.close();
          await unlink(candidatePath);
          this.#assertLockDeadline(runId, deadline);
          await delay(5);
          continue;
        }
        await link(candidatePath, lockPath);
      } catch (error) {
        await handle.close().catch(() => undefined);
        await unlink(candidatePath).catch(() => undefined);
        if (hasErrorCode(error, "EEXIST")) {
          await this.#recoverDeadLock(runId);
          this.#assertLockDeadline(runId, deadline);
          await delay(5);
          continue;
        }
        throw error;
      }

      try {
        await unlink(candidatePath);
        await syncDirectory(this.#directory);
        if (
          !(await this.#hasRecoveryParticipants(runId)) &&
          (await this.#lockIsOwnedBy(runId, handle))
        ) {
          return handle;
        }

        await this.#releaseLock(runId, handle);
        this.#assertLockDeadline(runId, deadline);
        await delay(5);
        continue;
      } catch (error) {
        await this.#releaseLock(runId, handle).catch(() => undefined);
        await unlink(candidatePath).catch(() => undefined);
        throw error;
      }
    }
  }

  async #recoverDeadLock(runId: string): Promise<boolean> {
    const lockPath = this.#lockPath(runId);
    try {
      const observedOwnerPid = await this.#readLockOwnerPid(lockPath);
      if (
        observedOwnerPid !== undefined &&
        this.#isProcessAlive(observedOwnerPid)
      ) {
        return false;
      }
    } catch (error) {
      if (isFileMissing(error)) {
        return true;
      }
      if (!hasErrorCode(error, "ELOOP")) {
        throw error;
      }
    }

    const recoveryPath = path.join(
      this.#directory,
      `.${runId}~recovery~${process.pid}.${randomUUID()}`,
    );
    try {
      await link(lockPath, recoveryPath);
    } catch (error) {
      if (isFileMissing(error)) {
        return true;
      }
      throw error;
    }

    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      const recoveryMetadata = await lstat(recoveryPath);
      let ownerPid: number | undefined;
      if (recoveryMetadata.isFile() && recoveryMetadata.size <= 32) {
        handle = await open(
          recoveryPath,
          constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        );
        const openedMetadata = await handle.stat();
        if (!this.#sameFile(recoveryMetadata, openedMetadata)) {
          return false;
        }
        const owner = (await handle.readFile("utf8")).trim();
        const parsedOwnerPid = Number(owner);
        if (Number.isSafeInteger(parsedOwnerPid) && parsedOwnerPid > 0) {
          ownerPid = parsedOwnerPid;
        }
      }

      if (ownerPid !== undefined && this.#isProcessAlive(ownerPid)) {
        return false;
      }

      try {
        const lockMetadata = await lstat(lockPath);
        if (this.#sameFile(lockMetadata, recoveryMetadata)) {
          await unlink(lockPath);
          return true;
        }
        return false;
      } catch (error) {
        if (isFileMissing(error)) {
          return true;
        }
        throw error;
      }
    } finally {
      await handle?.close();
      await unlink(recoveryPath).catch((error: unknown) => {
        if (!isFileMissing(error)) {
          throw error;
        }
      });
      await syncDirectory(this.#directory);
    }
  }

  async #readLockOwnerPid(lockPath: string): Promise<number | undefined> {
    const pathMetadata = await lstat(lockPath);
    if (!pathMetadata.isFile() || pathMetadata.size > 32) {
      return undefined;
    }

    const handle = await open(
      lockPath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const openedMetadata = await handle.stat();
      if (!this.#sameFile(pathMetadata, openedMetadata)) {
        return undefined;
      }
      const ownerPid = Number((await handle.readFile("utf8")).trim());
      return Number.isSafeInteger(ownerPid) && ownerPid > 0
        ? ownerPid
        : undefined;
    } finally {
      await handle.close();
    }
  }

  #assertLockDeadline(runId: string, deadline: number): void {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out acquiring run-state lock for ${runId}`);
    }
  }

  #isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return !hasErrorCode(error, "ESRCH");
    }
  }

  async #releaseLock(
    runId: string,
    handle: Awaited<ReturnType<typeof open>>,
  ): Promise<void> {
    let firstError: unknown;
    try {
      const ownedMetadata = await handle.stat();
      const pathMetadata = await lstat(this.#lockPath(runId));
      if (this.#sameFile(ownedMetadata, pathMetadata)) {
        await unlink(this.#lockPath(runId));
      }
    } catch (error) {
      if (!isFileMissing(error)) {
        firstError = error;
      }
    }

    try {
      await handle.close();
    } catch (error) {
      if (firstError === undefined) {
        firstError = error;
      }
    }

    try {
      await syncDirectory(this.#directory);
    } catch (error) {
      if (firstError === undefined) {
        firstError = error;
      }
    }

    if (firstError !== undefined) {
      throw firstError;
    }
  }

  async #lockIsOwnedBy(
    runId: string,
    handle: Awaited<ReturnType<typeof open>>,
  ): Promise<boolean> {
    try {
      const ownedMetadata = await handle.stat();
      const pathMetadata = await lstat(this.#lockPath(runId));
      return this.#sameFile(ownedMetadata, pathMetadata);
    } catch (error) {
      if (isFileMissing(error)) {
        return false;
      }
      throw error;
    }
  }

  async #cleanupDeadCandidates(runId: string): Promise<void> {
    const prefix = `.${runId}~candidate~`;
    const suffix = "";
    const names = await readdir(this.#directory);
    let changed = false;

    for (const name of names) {
      if (!name.startsWith(prefix) || !name.endsWith(suffix)) {
        continue;
      }

      const candidatePath = path.join(this.#directory, name);
      try {
        const metadata = await lstat(candidatePath);
        const ownerPid = this.#artifactOwnerPid(name, prefix, suffix);
        const isDeadOwner =
          ownerPid !== undefined && !this.#isProcessAlive(ownerPid);
        const isOldMalformedCandidate =
          ownerPid === undefined && Date.now() - metadata.mtimeMs >= 60_000;
        if (!isDeadOwner && !isOldMalformedCandidate) {
          continue;
        }

        const pathMetadata = await lstat(candidatePath);
        if (this.#sameFile(metadata, pathMetadata)) {
          await unlink(candidatePath);
          changed = true;
        }
      } catch (error) {
        if (!isFileMissing(error)) {
          throw error;
        }
      }
    }

    if (changed) {
      await syncDirectory(this.#directory);
    }
  }

  async #hasRecoveryParticipants(runId: string): Promise<boolean> {
    const prefix = `.${runId}~recovery~`;
    const names = await readdir(this.#directory);
    let changed = false;
    let active = false;

    for (const name of names) {
      if (!name.startsWith(prefix)) {
        continue;
      }

      const ownerPid = this.#artifactOwnerPid(name, prefix, "");
      if (ownerPid === undefined || this.#isProcessAlive(ownerPid)) {
        active = true;
        continue;
      }

      const recoveryPath = path.join(this.#directory, name);
      try {
        const metadata = await lstat(recoveryPath);
        const pathMetadata = await lstat(recoveryPath);
        if (this.#sameFile(metadata, pathMetadata)) {
          await unlink(recoveryPath);
          changed = true;
        }
      } catch (error) {
        if (!isFileMissing(error)) {
          throw error;
        }
      }
    }

    if (changed) {
      await syncDirectory(this.#directory);
    }
    return active;
  }

  #artifactOwnerPid(
    name: string,
    prefix: string,
    suffix: string,
  ): number | undefined {
    if (!name.startsWith(prefix) || !name.endsWith(suffix)) {
      return undefined;
    }
    const artifactIdentity = name.slice(
      prefix.length,
      suffix.length === 0 ? undefined : -suffix.length,
    );
    const separator = artifactIdentity.indexOf(".");
    if (separator < 1) {
      return undefined;
    }
    const ownerPid = Number(artifactIdentity.slice(0, separator));
    const artifactId = artifactIdentity.slice(separator + 1);
    if (
      !Number.isSafeInteger(ownerPid) ||
      ownerPid <= 0 ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
        artifactId,
      )
    ) {
      return undefined;
    }
    return ownerPid;
  }

  #sameFile(
    left: Awaited<ReturnType<typeof lstat>>,
    right: Awaited<ReturnType<typeof lstat>>,
  ): boolean {
    return left.dev === right.dev && left.ino === right.ino;
  }

  async #prepareDirectory(create: boolean): Promise<boolean> {
    if (create) {
      await mkdir(this.#directory, { recursive: true, mode: 0o700 });
    }

    let metadata: Awaited<ReturnType<typeof lstat>>;
    try {
      metadata = await lstat(this.#directory);
    } catch (error) {
      if (!create && isFileMissing(error)) {
        return false;
      }
      throw error;
    }

    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new TypeError("Invalid run-state store directory");
    }

    if (create && process.platform !== "win32") {
      await chmod(this.#directory, 0o700);
    } else if (
      !create &&
      process.platform !== "win32" &&
      (metadata.mode & 0o077) !== 0
    ) {
      throw new TypeError("Insecure run-state store directory");
    }
    return true;
  }

  #committedPath(runId: string): string {
    return path.join(this.#directory, `${runId}.json`);
  }

  #lockPath(runId: string): string {
    return path.join(this.#directory, `.${runId}~lock`);
  }

}
