import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

import { FileRunStateStore, RUN_STATES } from "../src/index.ts";
import type { PersistedRunState, RunState } from "../src/index.ts";

const runId = "run-review-25";
const execFileAsync = promisify(execFile);

function snapshot(
  revision: number,
  state: RunState = RUN_STATES.WAITING_FOR_REVIEW,
  taskId = "TASK-25",
): PersistedRunState {
  return {
    schema_version: 1,
    run_id: runId,
    task_id: taskId,
    state,
    revision,
  };
}

function canonicalJson(value: PersistedRunState): string {
  return `${JSON.stringify({
    schema_version: value.schema_version,
    run_id: value.run_id,
    task_id: value.task_id,
    state: value.state,
    revision: value.revision,
  }, null, 2)}\n`;
}

function isCorruptionFor(expectedRunId: string) {
  return (error: unknown): boolean =>
    error instanceof Error &&
    /corrupt/i.test(error.message) &&
    error.message.includes(expectedRunId);
}

if (false) {
  const persisted: PersistedRunState = snapshot(0);

  // @ts-expect-error persisted snapshots are immutable values
  persisted.revision = 1;

  const rawState: PersistedRunState = {
    ...persisted,
    // @ts-expect-error persisted states must use the branded run-state catalog
    state: "WAITING_FOR_REVIEW",
  };
  void rawState;
}

test("a waiting run survives process restart with deterministic JSON", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "exoframe-run-store-"));
  t.after(async () => rm(sandbox, { recursive: true, force: true }));
  const directory = join(sandbox, "state");
  const store = new FileRunStateStore(directory);

  const source = Object.freeze({
    task_id: "TASK-25",
    revision: 0,
    state: RUN_STATES.WAITING_FOR_REVIEW,
    run_id: runId,
    schema_version: 1,
  }) satisfies PersistedRunState;
  const sourceBeforeSave = JSON.stringify(source);

  await store.save(source);

  const committedPath = join(directory, `${runId}.json`);
  assert.equal(await readFile(committedPath, "utf8"), canonicalJson(source));
  assert.equal(JSON.stringify(source), sourceBeforeSave);

  const restartedStore = new FileRunStateStore(directory);
  const loaded = await restartedStore.load(runId);
  assert.deepEqual(loaded, source);
  assert.equal(Object.isFrozen(loaded), true);
  assert.deepEqual(JSON.parse(JSON.stringify(loaded)), source);
  assert.throws(() => Object.assign(loaded as object, { revision: 99 }), {
    name: "TypeError",
  });
});

test("replacement is atomic and readers observe only complete snapshots", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "exoframe-run-store-"));
  t.after(async () => rm(sandbox, { recursive: true, force: true }));
  const directory = join(sandbox, "state");
  const store = new FileRunStateStore(directory);
  const largeTaskSuffix = "a".repeat(4 * 1024 * 1024);
  const current = snapshot(0, RUN_STATES.WAITING_FOR_REVIEW, `TASK-${largeTaskSuffix}`);
  const replacement = snapshot(
    1,
    RUN_STATES.IMPLEMENTING,
    current.task_id,
  );

  await store.save(current);
  const committedPath = join(directory, `${runId}.json`);
  const currentJson = canonicalJson(current);
  const replacementJson = canonicalJson(replacement);
  const inodeBefore = (await stat(committedPath)).ino;

  let settled = false;
  const replacementSave = store.save(replacement).finally(() => {
    settled = true;
  });

  do {
    const observed = await readFile(committedPath, "utf8");
    assert.equal(
      observed === currentJson || observed === replacementJson,
      true,
      "a concurrent reader must see one complete committed revision",
    );
    assert.doesNotThrow(() => JSON.parse(observed));
  } while (!settled);

  await replacementSave;
  assert.equal(await readFile(committedPath, "utf8"), replacementJson);
  assert.notEqual(
    (await stat(committedPath)).ino,
    inodeBefore,
    "replacement must install a new file rather than truncate the committed one",
  );
  assert.deepEqual(await readdir(directory), [`${runId}.json`]);
});

test("failed, invalid, and stale saves preserve the committed revision", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "exoframe-run-store-"));
  t.after(async () => rm(sandbox, { recursive: true, force: true }));
  const directory = join(sandbox, "state");
  const store = new FileRunStateStore(directory);
  const committed = snapshot(2, RUN_STATES.WAITING_FOR_REVIEW);
  await store.save(committed);
  const committedPath = join(directory, `${runId}.json`);
  const committedBytes = await readFile(committedPath, "utf8");

  const invalidSnapshots = [
    { ...committed, schema_version: 2 },
    { ...committed, run_id: "" },
    { ...committed, task_id: "" },
    { ...committed, state: "UNKNOWN" },
    { ...committed, revision: -1 },
    { ...committed, revision: 1.5 },
    { ...committed, revision: 1 },
    { ...committed, task_id: "DIFFERENT-TASK", revision: 3 },
  ];

  for (const invalidSnapshot of invalidSnapshots) {
    await assert.rejects(
      store.save(invalidSnapshot as unknown as PersistedRunState),
    );
    assert.equal(await readFile(committedPath, "utf8"), committedBytes);
    assert.deepEqual(await store.load(runId), committed);
  }
});

test("competing store instances cannot roll a run back", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "exoframe-run-store-"));
  t.after(async () => rm(sandbox, { recursive: true, force: true }));
  const directory = join(sandbox, "state");
  const firstStore = new FileRunStateStore(directory);
  const secondStore = new FileRunStateStore(directory);
  await firstStore.save(snapshot(0));

  const slowRevision = snapshot(1, RUN_STATES.IMPLEMENTING);
  const latestRevision = snapshot(2, RUN_STATES.VERIFYING);
  const saves = await Promise.allSettled([
    firstStore.save(slowRevision),
    secondStore.save(latestRevision),
  ]);

  assert.equal(saves[1]?.status, "fulfilled");
  assert.deepEqual(await new FileRunStateStore(directory).load(runId), latestRevision);
});

test("a cross-process writer burst eventually commits its highest revision", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "exoframe-run-store-"));
  t.after(async () => rm(sandbox, { recursive: true, force: true }));
  const directory = join(sandbox, "state");
  await new FileRunStateStore(directory).save(snapshot(0));

  const moduleUrl = new URL("../src/index.ts", import.meta.url).href;
  const releaseAt = Date.now() + 1_500;
  const writerScript = `
    import { setTimeout as delay } from "node:timers/promises";
    const [moduleUrl, directory, revisionText, releaseText] = process.argv.slice(1);
    const { FileRunStateStore, RUN_STATES } = await import(moduleUrl);
    await delay(Math.max(0, Number(releaseText) - Date.now()));
    await new FileRunStateStore(directory).save({
      schema_version: 1,
      run_id: "${runId}",
      task_id: "TASK-25",
      state: RUN_STATES.IMPLEMENTING,
      revision: Number(revisionText),
    });
  `;
  const writers = Array.from({ length: 24 }, (_, index) =>
    execFileAsync(process.execPath, [
      "--input-type=module",
      "--eval",
      writerScript,
      moduleUrl,
      directory,
      String(index + 1),
      String(releaseAt),
    ]),
  );
  const outcomes = await Promise.allSettled(writers);

  assert.equal(
    outcomes[23]?.status,
    "fulfilled",
    "the highest revision must not time out under writer contention",
  );
  assert.deepEqual(
    await new FileRunStateStore(directory).load(runId),
    snapshot(24, RUN_STATES.IMPLEMENTING),
  );
  assert.deepEqual(await readdir(directory), [`${runId}.json`]);
});

test("a dead process lock is recovered without a long wait", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "exoframe-run-store-"));
  t.after(async () => rm(sandbox, { recursive: true, force: true }));
  const directory = join(sandbox, "state");
  await mkdir(directory, { mode: 0o700 });
  const lockPath = join(directory, `.${runId}~lock`);
  await writeFile(lockPath, "999999999\n", { mode: 0o600 });

  const startedAt = Date.now();
  await new FileRunStateStore(directory).save(snapshot(0));
  assert.equal(Date.now() - startedAt < 2_000, true);
  assert.deepEqual(await readdir(directory), [`${runId}.json`]);

  await writeFile(lockPath, "", { mode: 0o600 });
  const emptyLockStartedAt = Date.now();
  await new FileRunStateStore(directory).save(
    snapshot(1, RUN_STATES.IMPLEMENTING),
  );
  assert.equal(Date.now() - emptyLockStartedAt < 2_000, true);
  assert.deepEqual(await readdir(directory), [`${runId}.json`]);

  await writeFile(lockPath, "999999999\n", { mode: 0o600 });
  const liveRecoveryPath = join(
    directory,
    `.${runId}~recovery~${process.pid}.00000000-0000-4000-8000-000000000001`,
  );
  await link(lockPath, liveRecoveryPath);
  let recoveryBlockedSaveSettled = false;
  const recoveryBlockedSave = new FileRunStateStore(directory)
    .save(snapshot(2, RUN_STATES.VERIFYING))
    .finally(() => {
      recoveryBlockedSaveSettled = true;
    });
  await delay(30);
  assert.equal(
    recoveryBlockedSaveSettled,
    false,
    "a live recovery participant must block publication of a replacement lock",
  );
  await unlink(liveRecoveryPath);
  await recoveryBlockedSave;

  await writeFile(lockPath, "999999999\n", { mode: 0o600 });
  await link(
    lockPath,
    join(
      directory,
      `.${runId}~recovery~999999999.00000000-0000-4000-8000-000000000002`,
    ),
  );
  const orphanRecoveryStartedAt = Date.now();
  await new FileRunStateStore(directory).save(
    snapshot(3, RUN_STATES.WAITING_FOR_REVIEW),
  );
  assert.equal(Date.now() - orphanRecoveryStartedAt < 2_000, true);
  assert.deepEqual(await readdir(directory), [`${runId}.json`]);

  await writeFile(
    join(
      directory,
      `.${runId}~candidate~999999999.00000000-0000-4000-8000-000000000003`,
    ),
    "999999999\n",
    { mode: 0o600 },
  );
  await new FileRunStateStore(directory).save(
    snapshot(4, RUN_STATES.IMPLEMENTING),
  );
  assert.deepEqual(await readdir(directory), [`${runId}.json`]);

  const overlappingRunId =
    `${runId}.recovering.999999999.00000000-0000-4000-8000-000000000004`;
  const foreignLockPaths = [
    join(directory, `.${overlappingRunId}~lock`),
    join(directory, `.${overlappingRunId}.lock`),
  ];
  for (const foreignLockPath of foreignLockPaths) {
    await writeFile(foreignLockPath, "999999999\n", { mode: 0o600 });
  }
  const isolatedSave = new FileRunStateStore(directory).save(
    snapshot(5, RUN_STATES.VERIFYING),
  );
  const isolationOutcome = await Promise.race([
    isolatedSave.then(() => "saved" as const),
    delay(100, "blocked" as const),
  ]);
  if (isolationOutcome === "blocked") {
    await Promise.all(foreignLockPaths.map((foreignLockPath) =>
      unlink(foreignLockPath)
    ));
    await isolatedSave;
  }
  assert.equal(
    isolationOutcome,
    "saved",
    "another valid run's lock must not share this run's artifact namespace",
  );
  await Promise.all(foreignLockPaths.map((foreignLockPath) =>
    unlink(foreignLockPath).catch(() => undefined)
  ));
});

test("snapshot accessors are rejected without changing committed bytes", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "exoframe-run-store-"));
  t.after(async () => rm(sandbox, { recursive: true, force: true }));
  const directory = join(sandbox, "state");
  const store = new FileRunStateStore(directory);
  const committed = snapshot(0);
  await store.save(committed);
  const committedPath = join(directory, `${runId}.json`);
  const committedBytes = await readFile(committedPath, "utf8");

  let revisionReads = 0;
  const unstable = {
    ...snapshot(1, RUN_STATES.IMPLEMENTING),
    get revision() {
      revisionReads += 1;
      return revisionReads < 3 ? 1 : -1;
    },
  };

  await assert.rejects(
    store.save(unstable),
    {
      name: "TypeError",
    },
  );
  assert.equal(revisionReads, 0);
  assert.equal(await readFile(committedPath, "utf8"), committedBytes);
  assert.deepEqual(await store.load(runId), committed);
});

test("save captures the snapshot at its call boundary", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "exoframe-run-store-"));
  t.after(async () => rm(sandbox, { recursive: true, force: true }));
  const directory = join(sandbox, "state");
  const store = new FileRunStateStore(directory);
  const expected = snapshot(0);
  const mutable = { ...expected };

  const saving = store.save(mutable);
  mutable.task_id = "MUTATED-TASK";
  mutable.revision = 99;
  mutable.state = RUN_STATES.DONE;
  await saving;

  assert.deepEqual(await store.load(runId), expected);
  assert.equal(
    await readFile(join(directory, `${runId}.json`), "utf8"),
    canonicalJson(expected),
  );
});

test("missing runs return null and stale temporary files are ignored", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "exoframe-run-store-"));
  t.after(async () => rm(sandbox, { recursive: true, force: true }));
  const directory = join(sandbox, "state");
  const store = new FileRunStateStore(directory);

  assert.equal(await store.load("missing-run"), null);

  const committed = snapshot(0);
  await store.save(committed);
  await writeFile(
    join(directory, `${runId}.json.stale.tmp`),
    '{"schema_version":1',
    "utf8",
  );
  await writeFile(
    join(directory, "missing-run.json.stale.tmp"),
    '{"state":"DONE"}',
    "utf8",
  );

  const restartedStore = new FileRunStateStore(directory);
  assert.deepEqual(await restartedStore.load(runId), committed);
  assert.equal(await restartedStore.load("missing-run"), null);
});

test("corrupt committed files fail closed with the affected run identity", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "exoframe-run-store-"));
  t.after(async () => rm(sandbox, { recursive: true, force: true }));
  const directory = join(sandbox, "state");
  const store = new FileRunStateStore(directory);
  const committed = snapshot(0);
  await store.save(committed);
  const committedPath = join(directory, `${runId}.json`);

  const corruptions = [
    '{"schema_version":1',
    JSON.stringify({ ...committed, schema_version: 2 }),
    JSON.stringify({ ...committed, state: "UNKNOWN" }),
    JSON.stringify({ ...committed, run_id: "different-run" }),
    JSON.stringify({ ...committed, run_id: "" }),
    JSON.stringify({ ...committed, task_id: "" }),
    JSON.stringify({ ...committed, revision: -1 }),
    JSON.stringify({ ...committed, revision: 0.5 }),
  ];

  for (const corruptContents of corruptions) {
    await writeFile(committedPath, corruptContents, "utf8");
    await assert.rejects(store.load(runId), isCorruptionFor(runId));
  }
});

test("committed symlinks are corruption and never supply run state", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "exoframe-run-store-"));
  t.after(async () => rm(sandbox, { recursive: true, force: true }));
  const directory = join(sandbox, "state");
  const externalPath = join(sandbox, "external.json");
  const external = snapshot(9, RUN_STATES.DONE, "EXTERNAL");
  await writeFile(externalPath, canonicalJson(external), "utf8");
  await new FileRunStateStore(directory).save(snapshot(0));
  const committedPath = join(directory, `${runId}.json`);
  await rm(committedPath);
  await symlink(externalPath, committedPath);

  await assert.rejects(
    new FileRunStateStore(directory).load(runId),
    isCorruptionFor(runId),
  );
  assert.equal(await readFile(externalPath, "utf8"), canonicalJson(external));
});

test("the store rejects directory symlinks and repairs unsafe permissions", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "exoframe-run-store-"));
  t.after(async () => rm(sandbox, { recursive: true, force: true }));
  const externalDirectory = join(sandbox, "external");
  const linkedDirectory = join(sandbox, "linked-state");
  await mkdir(externalDirectory, { mode: 0o700 });
  await symlink(externalDirectory, linkedDirectory, "dir");
  const linkedStore = new FileRunStateStore(linkedDirectory);

  await assert.rejects(linkedStore.load(runId), { name: "TypeError" });
  await assert.rejects(linkedStore.save(snapshot(0)), { name: "TypeError" });
  assert.deepEqual(await readdir(externalDirectory), []);

  const insecureDirectory = join(sandbox, "insecure-state");
  await mkdir(insecureDirectory, { mode: 0o700 });
  await chmod(insecureDirectory, 0o777);
  await new FileRunStateStore(insecureDirectory).save(snapshot(0));
  assert.equal((await stat(insecureDirectory)).mode & 0o777, 0o700);
});

test("the Windows path omits unsupported POSIX-only directory guarantees", async (t) => {
  if (process.platform === "win32") {
    const sandbox = await mkdtemp(join(tmpdir(), "exoframe-run-store-"));
    t.after(async () => rm(sandbox, { recursive: true, force: true }));
    const store = new FileRunStateStore(join(sandbox, "state"));
    await store.save(snapshot(0));
    assert.deepEqual(await store.load(runId), snapshot(0));
    return;
  }

  const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
  assert.ok(platformDescriptor);
  const sandbox = await mkdtemp(join(tmpdir(), "exoframe-run-store-"));
  t.after(async () => rm(sandbox, { recursive: true, force: true }));
  const directory = join(sandbox, "state");
  await mkdir(directory, { mode: 0o700 });
  await chmod(directory, 0o777);

  Object.defineProperty(process, "platform", {
    ...platformDescriptor,
    value: "win32",
  });
  try {
    const store = new FileRunStateStore(directory);
    await store.save(snapshot(0));
    assert.deepEqual(await store.load(runId), snapshot(0));
    assert.equal(
      (await stat(directory)).mode & 0o777,
      0o777,
      "the Windows path must not claim or enforce POSIX permission bits",
    );
  } finally {
    Object.defineProperty(process, "platform", platformDescriptor);
  }
});

test("a nonregular committed path fails without blocking load", async (t) => {
  if (process.platform === "win32") {
    t.skip("named FIFO probe is POSIX-only");
    return;
  }

  const sandbox = await mkdtemp(join(tmpdir(), "exoframe-run-store-"));
  t.after(async () => rm(sandbox, { recursive: true, force: true }));
  const directory = join(sandbox, "state");
  await mkdir(directory, { mode: 0o700 });
  const committedPath = join(directory, `${runId}.json`);
  await execFileAsync("mkfifo", [committedPath]);
  const store = new FileRunStateStore(directory);
  const load = store.load(runId);
  const outcome = await Promise.race([
    load.then(
      () => "loaded" as const,
      (error: unknown) =>
        isCorruptionFor(runId)(error) ? "corrupt" as const : "other" as const,
    ),
    delay(250, "timeout" as const),
  ]);

  if (outcome === "timeout") {
    await writeFile(committedPath, "unblock", "utf8");
    await load.catch(() => undefined);
  }
  assert.equal(outcome, "corrupt");
});

test("run identifiers cannot escape the configured store directory", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "exoframe-run-store-"));
  t.after(async () => rm(sandbox, { recursive: true, force: true }));
  const directory = join(sandbox, "state");
  const store = new FileRunStateStore(directory);
  const outsidePath = join(sandbox, "outside.json");
  await writeFile(outsidePath, "outside sentinel", "utf8");

  const invalidRunIds = [
    "",
    ".",
    "..",
    "../outside",
    "nested/run",
    "nested\\run",
    join(sandbox, "absolute-run"),
    "C:\\absolute-run",
    "Run-With-Case",
    "con",
    "run.",
    "run\u0000suffix",
  ];

  for (const invalidRunId of invalidRunIds) {
    await assert.rejects(store.load(invalidRunId), { name: "TypeError" });
    await assert.rejects(
      store.save({
        ...snapshot(0),
        run_id: invalidRunId,
      }),
      { name: "TypeError" },
    );
  }

  assert.equal(await readFile(outsidePath, "utf8"), "outside sentinel");
});
