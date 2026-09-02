import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
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

import {
  FileRunCatalog,
  isRunCatalogIdentifier,
} from "../src/run-catalog.ts";
import type { RunCatalogRecord } from "../src/run-catalog.ts";
import { parseSha256Digest } from "../src/domain.ts";
import type { Sha256Digest } from "../src/domain.ts";

const execFileAsync = promisify(execFile);
const taskId = "task-catalog-review";
const runId = "run-catalog-review";
const requestedOutcome = "Keep the task context durable";

function digest(value: string): Sha256Digest {
  return parseSha256Digest(
    `sha256:${createHash("sha256").update(value).digest("hex")}`,
  );
}

function record(
  selectedTaskId = taskId,
  selectedRunId = runId,
  outcome = requestedOutcome,
): RunCatalogRecord {
  return {
    schema_version: 1,
    run_id: selectedRunId,
    task: {
      schema_version: 1,
      task_id: selectedTaskId,
      requested_outcome: outcome,
      source: {
        kind: "direct_text",
        content_digest: digest(outcome),
      },
    },
  };
}

function canonicalJson(value: RunCatalogRecord): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function isCorruptionFor(expectedTaskId: string) {
  return (error: unknown): boolean =>
    error instanceof Error &&
    /corrupt/i.test(error.message) &&
    error.message.includes(expectedTaskId);
}

test("catalog publication captures immutable data at the call boundary", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "exoframe-run-catalog-"));
  t.after(async () => rm(sandbox, { recursive: true, force: true }));
  const directory = join(sandbox, "state");
  const catalog = new FileRunCatalog(directory);

  let accessorReads = 0;
  const accessorBacked = {
    ...record(),
    task: {
      ...record().task,
      get requested_outcome() {
        accessorReads += 1;
        return requestedOutcome;
      },
    },
  };
  await assert.rejects(
    catalog.stage(accessorBacked as RunCatalogRecord),
    { name: "TypeError" },
  );
  assert.equal(accessorReads, 0);

  const expected = record();
  const mutable = structuredClone(expected) as {
    schema_version: 1;
    run_id: string;
    task: {
      schema_version: 1;
      task_id: string;
      requested_outcome: string;
      source: {
        kind: "direct_text";
        content_digest: Sha256Digest;
      };
    };
  };
  const staging = catalog.stage(mutable);
  mutable.run_id = "run-mutated";
  mutable.task.requested_outcome = "Mutated after stage was called";
  mutable.task.source.content_digest = digest(mutable.task.requested_outcome);
  await staging;

  const pending = await catalog.loadPending(taskId);
  assert.deepEqual(pending, expected);
  assert.equal(Object.isFrozen(pending), true);
  assert.equal(Object.isFrozen(pending?.task), true);
  assert.equal(Object.isFrozen(pending?.task.source), true);
  assert.equal(
    await readFile(join(directory, `.${taskId}.pending-task.json`), "utf8"),
    canonicalJson(expected),
  );
  if (process.platform !== "win32") {
    assert.equal(
      (await stat(join(directory, `.${taskId}.pending-task.json`))).mode & 0o777,
      0o600,
    );
  }

  await catalog.commit(taskId);
  assert.deepEqual(await catalog.load(taskId), expected);
  assert.deepEqual(await readdir(directory), [`${taskId}.task.json`]);
});

test("staging cannot publish a new reservation across a concurrent commit", {
  skip: process.platform === "win32" ? "POSIX process suspension is required" : false,
}, async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "exoframe-run-catalog-race-"));
  t.after(async () => rm(sandbox, { recursive: true, force: true }));
  const directory = join(sandbox, "state");
  const catalog = new FileRunCatalog(directory);
  const first = record(taskId, "run-first-reservation", "First reservation");
  await catalog.stage(first);

  const moduleUrl = new URL("../src/run-catalog.ts", import.meta.url).href;
  const childSource = `
    import { createHash } from "node:crypto";
    import { FileRunCatalog } from ${JSON.stringify(moduleUrl)};
    const requestedOutcome = "x".repeat(64 * 1024 * 1024);
    const contentDigest = "sha256:" + createHash("sha256")
      .update(requestedOutcome)
      .digest("hex");
    try {
      await new FileRunCatalog(process.env.EXOFRAME_TEST_CATALOG).stage({
        schema_version: 1,
        run_id: "run-second-reservation",
        task: {
          schema_version: 1,
          task_id: ${JSON.stringify(taskId)},
          requested_outcome: requestedOutcome,
          source: { kind: "direct_text", content_digest: contentDigest },
        },
      });
      process.stdout.write("STAGED\\n");
    } catch (error) {
      process.stderr.write((error instanceof Error ? error.message : String(error)) + "\\n");
      process.exitCode = 3;
    }
  `;
  const child = spawn(
    process.execPath,
    ["--input-type=module", "--eval", childSource],
    {
      env: { ...process.env, EXOFRAME_TEST_CATALOG: directory },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let childClosed = false;
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const childOutcome = new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (exitCode) => {
      childClosed = true;
      resolve(exitCode ?? -1);
    });
  });
  t.after(() => {
    if (!childClosed) {
      child.kill("SIGCONT");
      child.kill("SIGKILL");
    }
  });

  const candidatePrefix = `.${taskId}.`;
  const candidateSuffix = ".task.tmp";
  const readinessDeadline = Date.now() + 5_000;
  let candidateObserved = false;
  while (!candidateObserved && Date.now() < readinessDeadline) {
    candidateObserved = (await readdir(directory)).some((name) =>
      name.startsWith(candidatePrefix) && name.endsWith(candidateSuffix)
    );
    if (!candidateObserved) {
      await delay(1);
    }
  }
  assert.equal(candidateObserved, true, "second stage must reach publication");
  assert.equal(child.kill("SIGSTOP"), true);
  await delay(25);
  assert.equal(childClosed, false, stderr);
  assert.equal((await catalog.loadPending(taskId))?.run_id, first.run_id);

  await catalog.commit(taskId);
  assert.equal(child.kill("SIGCONT"), true);
  const exitCode = await childOutcome;

  assert.equal(exitCode, 3, stdout);
  assert.equal(stdout, "");
  assert.match(stderr, /already exists/iu);
  assert.equal(await catalog.loadPending(taskId), null);
  assert.deepEqual(await catalog.load(taskId), first);
  assert.deepEqual(await readdir(directory), [`${taskId}.task.json`]);
});

test("catalog identifiers cannot escape or alias the configured directory", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "exoframe-run-catalog-"));
  t.after(async () => rm(sandbox, { recursive: true, force: true }));
  const directory = join(sandbox, "state");
  const catalog = new FileRunCatalog(directory);
  const sentinel = join(sandbox, "outside.task.json");
  await writeFile(sentinel, "outside sentinel", "utf8");
  const invalidIds = [
    "",
    ".",
    "..",
    "../outside",
    "nested/task",
    "nested\\task",
    join(sandbox, "absolute-task"),
    "C:\\absolute-task",
    "Task-With-Case",
    "con",
    "task.",
    "task\u0000suffix",
  ];

  for (const invalidId of invalidIds) {
    assert.equal(isRunCatalogIdentifier(invalidId), false);
    await assert.rejects(catalog.load(invalidId), { name: "TypeError" });
    await assert.rejects(
      catalog.stage(record(invalidId)),
      { name: "TypeError" },
    );
    await assert.rejects(
      catalog.stage(record(taskId, invalidId)),
      { name: "TypeError" },
    );
  }
  assert.equal(await readFile(sentinel, "utf8"), "outside sentinel");
});

test("tampered catalog bytes fail closed with the task identity", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "exoframe-run-catalog-"));
  t.after(async () => rm(sandbox, { recursive: true, force: true }));
  const directory = join(sandbox, "state");
  const catalog = new FileRunCatalog(directory);
  const expected = record();
  await catalog.stage(expected);
  await catalog.commit(taskId);
  const committedPath = join(directory, `${taskId}.task.json`);
  const corruptions = [
    "{not-json\n",
    JSON.stringify({ ...expected, schema_version: 2 }),
    JSON.stringify({ ...expected, unexpected: true }),
    JSON.stringify({
      ...expected,
      task: { ...expected.task, task_id: "task-other" },
    }),
    JSON.stringify({
      ...expected,
      task: {
        ...expected.task,
        source: {
          ...expected.task.source,
          content_digest: `sha256:${"0".repeat(64)}`,
        },
      },
    }),
    '{"schema_version":1,"run_id":"run-catalog-review","task":' +
    '{"schema_version":1,"task_id":"task-catalog-review",' +
    '"requested_outcome":"Keep the task context durable",' +
    '"source":{"kind":"direct_text","content_digest":' +
    `"${digest(requestedOutcome)}"},"__proto__":{}}}`,
  ];

  for (const corruption of corruptions) {
    await writeFile(committedPath, corruption, "utf8");
    await assert.rejects(catalog.load(taskId), isCorruptionFor(taskId));
  }
});

test("catalog symlinks and nonregular entries never supply records", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "exoframe-run-catalog-"));
  t.after(async () => rm(sandbox, { recursive: true, force: true }));
  const directory = join(sandbox, "state");
  const externalPath = join(sandbox, "external.json");
  await mkdir(directory, { mode: 0o700 });
  await writeFile(externalPath, canonicalJson(record()), "utf8");
  const committedPath = join(directory, `${taskId}.task.json`);
  await symlink(externalPath, committedPath);

  await assert.rejects(
    new FileRunCatalog(directory).load(taskId),
    isCorruptionFor(taskId),
  );
  assert.equal(await readFile(externalPath, "utf8"), canonicalJson(record()));
  await unlink(committedPath);

  if (process.platform === "win32") {
    return;
  }
  await execFileAsync("mkfifo", [committedPath]);
  const loading = new FileRunCatalog(directory).load(taskId);
  const outcome = await Promise.race([
    loading.then(
      () => "loaded" as const,
      (error: unknown) =>
        isCorruptionFor(taskId)(error) ? "corrupt" as const : "other" as const,
    ),
    delay(250, "timeout" as const),
  ]);
  if (outcome === "timeout") {
    await writeFile(committedPath, "unblock", "utf8");
    await loading.catch(() => undefined);
  }
  assert.equal(outcome, "corrupt");
});

test("catalog directories reject symlinks and enforce private permissions", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "exoframe-run-catalog-"));
  t.after(async () => rm(sandbox, { recursive: true, force: true }));
  const externalDirectory = join(sandbox, "external");
  const linkedDirectory = join(sandbox, "linked-state");
  await mkdir(externalDirectory, { mode: 0o700 });
  await symlink(externalDirectory, linkedDirectory, "dir");
  const linkedCatalog = new FileRunCatalog(linkedDirectory);
  await assert.rejects(linkedCatalog.load(taskId), { name: "TypeError" });
  await assert.rejects(linkedCatalog.stage(record()), { name: "TypeError" });
  assert.deepEqual(await readdir(externalDirectory), []);

  if (process.platform === "win32") {
    return;
  }
  const insecureDirectory = join(sandbox, "insecure-state");
  await mkdir(insecureDirectory, { mode: 0o700 });
  await chmod(insecureDirectory, 0o777);
  const insecureCatalog = new FileRunCatalog(insecureDirectory);
  await assert.rejects(insecureCatalog.load(taskId), { name: "TypeError" });
  await insecureCatalog.stage(record());
  assert.equal((await stat(insecureDirectory)).mode & 0o777, 0o700);
});

test("the Windows catalog path omits POSIX-only permission guarantees", async (t) => {
  if (process.platform === "win32") {
    const sandbox = await mkdtemp(join(tmpdir(), "exoframe-run-catalog-"));
    t.after(async () => rm(sandbox, { recursive: true, force: true }));
    const catalog = new FileRunCatalog(join(sandbox, "state"));
    await catalog.stage(record());
    assert.deepEqual(await catalog.loadPending(taskId), record());
    return;
  }

  const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
  assert.ok(platformDescriptor);
  const sandbox = await mkdtemp(join(tmpdir(), "exoframe-run-catalog-"));
  t.after(async () => rm(sandbox, { recursive: true, force: true }));
  const directory = join(sandbox, "state");
  await mkdir(directory, { mode: 0o700 });
  await chmod(directory, 0o777);

  Object.defineProperty(process, "platform", {
    ...platformDescriptor,
    value: "win32",
  });
  try {
    const catalog = new FileRunCatalog(directory);
    await catalog.stage(record());
    assert.deepEqual(await catalog.loadPending(taskId), record());
    assert.equal((await stat(directory)).mode & 0o777, 0o777);
  } finally {
    Object.defineProperty(process, "platform", platformDescriptor);
  }
});
