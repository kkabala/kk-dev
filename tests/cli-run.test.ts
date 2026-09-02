import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  link,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

import {
  FileRunStateStore,
  parseSha256Digest,
  RUN_STATES,
} from "../src/index.ts";
import { FileRunCatalog } from "../src/run-catalog.ts";

type CommandResult = Readonly<{
  exitCode: number;
  stderr: string;
  stdout: string;
}>;

type RunView = Readonly<{
  intent?: Readonly<{
    constraints: readonly string[];
    goals: readonly string[];
    intent_id: string;
    non_goals: readonly string[];
    schema_version: number;
    task_id: string;
    unresolved_decisions: readonly string[];
  }>;
  packet?: Readonly<{
    affected_behavior: string;
    packet_id: string;
    request: Readonly<{
      kind: string;
      related_questions: readonly Readonly<{
        alternatives: readonly string[];
        prompt: string;
        question_id: string;
        recommended_answer: string;
      }>[];
    }>;
    schema_version: number;
    subject: Readonly<{ kind: string }>;
    task_id: string;
  }>;
  run: Readonly<{
    revision: number;
    run_id: string;
    schema_version: number;
    state: string;
    task_id: string;
  }>;
  task: Readonly<{
    requested_outcome: string;
    schema_version: number;
    source: Readonly<{
      content_digest: string;
      kind: string;
    }>;
    task_id: string;
  }>;
}>;

const binPath = fileURLToPath(new URL("../src/bin.ts", import.meta.url));
const execFileAsync = promisify(execFile);

function invokeCliWithEnvironment(
  workingDirectory: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [binPath, ...args], {
      cwd: workingDirectory,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
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
    child.once("error", reject);
    child.once("close", (exitCode) => {
      if (exitCode === null) {
        reject(new Error("Exoframe CLI exited without a numeric status"));
        return;
      }
      resolve({ exitCode, stderr, stdout });
    });
  });
}

function invokeCli(
  stateRoot: string,
  workingDirectory: string,
  args: readonly string[],
): Promise<CommandResult> {
  return invokeCliWithEnvironment(workingDirectory, args, {
    ...process.env,
    EXOFRAME_STATE_ROOT: stateRoot,
  });
}

function invokeCliAtDefaultRoot(
  homeDirectory: string,
  workingDirectory: string,
  args: readonly string[],
): Promise<CommandResult> {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: homeDirectory,
    USERPROFILE: homeDirectory,
  };
  delete environment.EXOFRAME_STATE_ROOT;
  return invokeCliWithEnvironment(workingDirectory, args, environment);
}

function parseRunView(output: string): RunView {
  return JSON.parse(output) as RunView;
}

function parseStartedRun(result: CommandResult): RunView {
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  return parseRunView(result.stdout);
}

function expectedDigest(taskText: string): string {
  return `sha256:${createHash("sha256").update(taskText).digest("hex")}`;
}

function assertInitialRun(view: RunView, taskText: string): void {
  assert.ok(Object.hasOwn(view, "run"));
  assert.ok(Object.hasOwn(view, "task"));
  assert.equal(view.task.schema_version, 1);
  assert.notEqual(view.task.task_id, "");
  assert.equal(view.task.requested_outcome, taskText);
  assert.deepEqual(view.task.source, {
    kind: "direct_text",
    content_digest: expectedDigest(taskText),
  });
  assert.deepEqual(view.run, {
    schema_version: 1,
    run_id: view.run.run_id,
    task_id: view.task.task_id,
    state: "INTAKE",
    revision: 0,
  });
  assert.notEqual(view.run.run_id, "");
}

test("a direct task survives restart as a durable INTAKE run", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "exoframe-cli-run-"));
  t.after(async () => rm(sandbox, { recursive: true, force: true }));
  const stateRoot = join(sandbox, "state");
  const checkout = join(sandbox, "checkout");
  await mkdir(checkout);
  const taskText = "Add CSV export to the orders page";

  const started = await invokeCli(stateRoot, checkout, ["run", taskText]);

  assert.equal(started.exitCode, 0);
  assert.equal(started.stderr, "");
  const startedView = parseRunView(started.stdout);
  assertInitialRun(startedView, taskText);

  const restartedStatus = await invokeCli(stateRoot, checkout, [
    "status",
    startedView.task.task_id,
  ]);
  const repeatedStatus = await invokeCli(stateRoot, checkout, [
    "status",
    startedView.task.task_id,
  ]);
  assert.equal(restartedStatus.exitCode, 0);
  assert.equal(restartedStatus.stderr, "");
  assert.equal(restartedStatus.stdout, started.stdout);
  assert.equal(repeatedStatus.stdout, restartedStatus.stdout);
  assert.deepEqual(parseRunView(restartedStatus.stdout), startedView);
});

test("the default state root is external and isolated per Git worktree", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "exoframe-cli-default-root-"));
  t.after(async () => rm(sandbox, { recursive: true, force: true }));
  const homeDirectory = join(sandbox, "home");
  const firstCheckout = join(sandbox, "first-checkout");
  const secondCheckout = join(sandbox, "second-checkout");
  const aliasCheckout = join(sandbox, "first-checkout-alias");
  await Promise.all([
    mkdir(homeDirectory),
    mkdir(firstCheckout),
    mkdir(secondCheckout),
  ]);
  await Promise.all([
    execFileAsync("git", ["init", "--quiet"], { cwd: firstCheckout }),
    execFileAsync("git", ["init", "--quiet"], { cwd: secondCheckout }),
  ]);
  const nestedDirectory = join(firstCheckout, "src", "nested");
  await mkdir(nestedDirectory, { recursive: true });
  await symlink(
    firstCheckout,
    aliasCheckout,
    process.platform === "win32" ? "junction" : "dir",
  );

  const started = await invokeCliAtDefaultRoot(
    homeDirectory,
    firstCheckout,
    ["run", "Keep control-plane state outside the candidate checkout"],
  );

  const view = parseStartedRun(started);
  const firstStatus = await invokeCliAtDefaultRoot(
    homeDirectory,
    firstCheckout,
    ["status", view.task.task_id],
  );
  assert.equal(firstStatus.stdout, started.stdout);
  const nestedStatus = await invokeCliAtDefaultRoot(
    homeDirectory,
    nestedDirectory,
    ["status", view.task.task_id],
  );
  assert.equal(nestedStatus.stdout, started.stdout);
  const aliasStatus = await invokeCliAtDefaultRoot(
    homeDirectory,
    aliasCheckout,
    ["status", view.task.task_id],
  );
  assert.equal(aliasStatus.stdout, started.stdout);
  const firstGitStatus = await execFileAsync(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    { cwd: firstCheckout },
  );
  assert.equal(firstGitStatus.stdout, "");

  const workspaceParent = join(
    homeDirectory,
    ".exoframe",
    "state",
    "workspaces",
  );
  const workspaceKeys = await readdir(workspaceParent);
  assert.equal(workspaceKeys.length, 1);
  assert.match(workspaceKeys[0] ?? "", /^[a-f0-9]{64}$/u);
  const expectedRoot = join(workspaceParent, workspaceKeys[0] ?? "missing");
  assert.deepEqual(
    (await readdir(expectedRoot)).sort(),
    [`${view.run.run_id}.json`, `${view.task.task_id}.intent.json`, `${view.task.task_id}.task.json`].sort(),
  );

  const isolatedStatus = await invokeCliAtDefaultRoot(
    homeDirectory,
    secondCheckout,
    ["status"],
  );
  assert.equal(isolatedStatus.exitCode, 0);
  assert.deepEqual(JSON.parse(isolatedStatus.stdout), []);

  await rm(join(firstCheckout, ".git"), { recursive: true });
  await execFileAsync("git", ["init", "--quiet"], { cwd: firstCheckout });
  const replacementStatus = await invokeCliAtDefaultRoot(
    homeDirectory,
    firstCheckout,
    ["status"],
  );
  assert.equal(replacementStatus.exitCode, 0);
  assert.deepEqual(JSON.parse(replacementStatus.stdout), []);
});

test("workspace identity survives commits and isolates file-marker worktrees", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "exoframe-cli-linked-worktree-"));
  t.after(async () => rm(sandbox, { recursive: true, force: true }));
  const homeDirectory = join(sandbox, "home");
  const mainCheckout = join(sandbox, "main-checkout");
  const linkedCheckout = join(sandbox, "linked-checkout");
  await Promise.all([mkdir(homeDirectory), mkdir(mainCheckout)]);
  await execFileAsync("git", ["init", "--quiet"], { cwd: mainCheckout });
  await writeFile(join(mainCheckout, "initial.txt"), "initial\n", "utf8");
  await execFileAsync("git", ["add", "initial.txt"], { cwd: mainCheckout });
  await execFileAsync(
    "git",
    [
      "-c",
      "user.name=Exoframe Test",
      "-c",
      "user.email=exoframe@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "initial",
    ],
    { cwd: mainCheckout },
  );
  const started = await invokeCliAtDefaultRoot(
    homeDirectory,
    mainCheckout,
    ["run", "Preserve identity across ordinary Git changes"],
  );
  const view = parseStartedRun(started);

  await writeFile(join(mainCheckout, "later.txt"), "later\n", "utf8");
  await execFileAsync("git", ["add", "later.txt"], { cwd: mainCheckout });
  await execFileAsync(
    "git",
    [
      "-c",
      "user.name=Exoframe Test",
      "-c",
      "user.email=exoframe@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "later",
    ],
    { cwd: mainCheckout },
  );
  const afterCommit = await invokeCliAtDefaultRoot(
    homeDirectory,
    mainCheckout,
    ["status", view.task.task_id],
  );
  assert.equal(afterCommit.stdout, started.stdout);

  await execFileAsync(
    "git",
    ["worktree", "add", "--quiet", "--detach", linkedCheckout, "HEAD"],
    { cwd: mainCheckout },
  );
  assert.equal((await stat(join(linkedCheckout, ".git"))).isFile(), true);
  const linkedStatus = await invokeCliAtDefaultRoot(
    homeDirectory,
    linkedCheckout,
    ["status"],
  );
  assert.equal(linkedStatus.exitCode, 0);
  assert.deepEqual(JSON.parse(linkedStatus.stdout), []);

  const linkedRun = parseStartedRun(
    await invokeCliAtDefaultRoot(
      homeDirectory,
      linkedCheckout,
      ["run", "Keep a linked worktree isolated"],
    ),
  );
  const mainList = await invokeCliAtDefaultRoot(
    homeDirectory,
    mainCheckout,
    ["status"],
  );
  assert.deepEqual(
    (JSON.parse(mainList.stdout) as readonly RunView[])
      .map(({ task }) => task.task_id),
    [view.task.task_id],
  );
  assert.notEqual(linkedRun.task.task_id, view.task.task_id);
});

test("non-Git workspace identity uses canonical invocation directories", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "exoframe-cli-non-git-root-"));
  t.after(async () => rm(sandbox, { recursive: true, force: true }));
  const homeDirectory = join(sandbox, "home");
  const workingDirectory = join(sandbox, "workspace");
  const nestedDirectory = join(workingDirectory, "nested");
  const aliasDirectory = join(sandbox, "workspace-alias");
  await Promise.all([
    mkdir(homeDirectory),
    mkdir(nestedDirectory, { recursive: true }),
  ]);
  await symlink(
    workingDirectory,
    aliasDirectory,
    process.platform === "win32" ? "junction" : "dir",
  );

  const started = await invokeCliAtDefaultRoot(
    homeDirectory,
    workingDirectory,
    ["run", "Use the non-Git directory boundary"],
  );
  const view = parseStartedRun(started);
  const aliasStatus = await invokeCliAtDefaultRoot(
    homeDirectory,
    aliasDirectory,
    ["status", view.task.task_id],
  );
  assert.equal(aliasStatus.stdout, started.stdout);

  const nestedStatus = await invokeCliAtDefaultRoot(
    homeDirectory,
    nestedDirectory,
    ["status"],
  );
  assert.equal(nestedStatus.exitCode, 0);
  assert.deepEqual(JSON.parse(nestedStatus.stdout), []);
});

test("status without an ID lists durable runs deterministically", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "exoframe-cli-status-"));
  t.after(async () => rm(sandbox, { recursive: true, force: true }));
  const stateRoot = join(sandbox, "state");
  const checkout = join(sandbox, "checkout");
  await mkdir(checkout);

  const first = parseStartedRun(
    await invokeCli(stateRoot, checkout, ["run", "First direct task"]),
  );
  const second = parseStartedRun(
    await invokeCli(stateRoot, checkout, ["run", "Second direct task"]),
  );

  const listed = await invokeCli(stateRoot, checkout, ["status"]);
  const listedAgain = await invokeCli(stateRoot, checkout, ["status"]);
  assert.equal(listed.exitCode, 0);
  assert.equal(listed.stderr, "");
  assert.equal(listedAgain.stdout, listed.stdout);
  const expected = [first, second].sort((left, right) =>
    left.task.task_id.localeCompare(right.task.task_id)
  );
  assert.deepEqual(JSON.parse(listed.stdout), expected);
});

test("status ordering is locale-independent for valid punctuation IDs", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "exoframe-cli-ordering-"));
  t.after(async () => rm(sandbox, { recursive: true, force: true }));
  const stateRoot = join(sandbox, "state");
  const checkout = join(sandbox, "checkout");
  await mkdir(checkout);
  const catalog = new FileRunCatalog(stateRoot);
  const states = new FileRunStateStore(stateRoot);
  for (const [taskId, runId] of [
    ["task_a", "run-underscore"],
    ["task0", "run-zero"],
    ["task.a", "run-dot"],
    ["task-a", "run-hyphen"],
  ] as const) {
    const taskText = `Task for ${taskId}`;
    await catalog.create({
      schema_version: 1,
      run_id: runId,
      task: {
        schema_version: 1,
        task_id: taskId,
        requested_outcome: taskText,
        source: {
          kind: "direct_text",
          content_digest: parseSha256Digest(expectedDigest(taskText)),
        },
      },
    });
    await states.save({
      schema_version: 1,
      run_id: runId,
      task_id: taskId,
      state: RUN_STATES.INTAKE,
      revision: 0,
    });
  }

  const listed = await invokeCli(stateRoot, checkout, ["status"]);

  assert.equal(listed.exitCode, 0);
  assert.equal(listed.stderr, "");
  const views = JSON.parse(listed.stdout) as readonly RunView[];
  assert.deepEqual(
    views.map(({ task }) => task.task_id),
    ["task-a", "task.a", "task0", "task_a"],
  );
});

test("a crash during run publication is recovered from durable task intent", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "exoframe-cli-recovery-"));
  t.after(async () => rm(sandbox, { recursive: true, force: true }));
  const stateRoot = join(sandbox, "state");
  const checkout = join(sandbox, "checkout");
  await mkdir(checkout);
  const taskText = "Recover an interrupted run publication";
  const taskId = "task-interrupted";
  const runId = "run-interrupted";
  await new FileRunCatalog(stateRoot).stage({
    schema_version: 1,
    run_id: runId,
    task: {
      schema_version: 1,
      task_id: taskId,
      requested_outcome: taskText,
      source: {
        kind: "direct_text",
        content_digest: parseSha256Digest(expectedDigest(taskText)),
      },
    },
  });

  const recovered = await invokeCli(stateRoot, checkout, ["status", taskId]);

  assert.equal(recovered.exitCode, 0);
  assert.equal(recovered.stderr, "");
  const recoveredView = parseRunView(recovered.stdout);
  assertInitialRun(recoveredView, taskText);
  assert.equal(recoveredView.task.task_id, taskId);
  assert.equal(recoveredView.run.run_id, runId);
  assert.deepEqual(
    (await readdir(stateRoot)).sort(),
    [`${runId}.json`, `${taskId}.task.json`],
  );
});

test("pending recovery rejects an impossible pre-existing lifecycle state", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "exoframe-cli-hostile-recovery-"));
  t.after(async () => rm(sandbox, { recursive: true, force: true }));
  const stateRoot = join(sandbox, "state");
  const checkout = join(sandbox, "checkout");
  await mkdir(checkout);
  const taskText = "Reject fabricated progress before catalog publication";
  const taskId = "task-hostile-pending";
  const runId = "run-hostile-pending";
  await new FileRunCatalog(stateRoot).stage({
    schema_version: 1,
    run_id: runId,
    task: {
      schema_version: 1,
      task_id: taskId,
      requested_outcome: taskText,
      source: {
        kind: "direct_text",
        content_digest: parseSha256Digest(expectedDigest(taskText)),
      },
    },
  });
  await new FileRunStateStore(stateRoot).save({
    schema_version: 1,
    run_id: runId,
    task_id: taskId,
    state: RUN_STATES.DONE,
    revision: 7,
  });
  const pendingName = `.${taskId}.pending-task.json`;
  const stateName = `${runId}.json`;
  const pendingBefore = await readFile(join(stateRoot, pendingName), "utf8");
  const stateBefore = await readFile(join(stateRoot, stateName), "utf8");

  const rejected = await invokeCli(stateRoot, checkout, ["status", taskId]);

  assert.equal(rejected.exitCode, 1);
  assert.equal(rejected.stdout, "");
  assert.match(rejected.stderr, /pending|initial|INTAKE|revision/iu);
  assert.deepEqual((await readdir(stateRoot)).sort(), [pendingName, stateName]);
  assert.equal(await readFile(join(stateRoot, pendingName), "utf8"), pendingBefore);
  assert.equal(await readFile(join(stateRoot, stateName), "utf8"), stateBefore);
});

test("a residual post-commit journal preserves an advanced valid run", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "exoframe-cli-residual-journal-"));
  t.after(async () => rm(sandbox, { recursive: true, force: true }));
  const stateRoot = join(sandbox, "state");
  const checkout = join(sandbox, "checkout");
  await mkdir(checkout);
  const taskText = "Clean a journal left after catalog publication";
  const taskId = "task-residual-journal";
  const runId = "run-residual-journal";
  await new FileRunCatalog(stateRoot).stage({
    schema_version: 1,
    run_id: runId,
    task: {
      schema_version: 1,
      task_id: taskId,
      requested_outcome: taskText,
      source: {
        kind: "direct_text",
        content_digest: parseSha256Digest(expectedDigest(taskText)),
      },
    },
  });
  const states = new FileRunStateStore(stateRoot);
  await states.initialize({
    schema_version: 1,
    run_id: runId,
    task_id: taskId,
    state: RUN_STATES.INTAKE,
    revision: 0,
  });
  const pendingName = `.${taskId}.pending-task.json`;
  const committedName = `${taskId}.task.json`;
  await link(
    join(stateRoot, pendingName),
    join(stateRoot, committedName),
  );
  await states.save({
    schema_version: 1,
    run_id: runId,
    task_id: taskId,
    state: RUN_STATES.DONE,
    revision: 1,
  });

  const recovered = await invokeCli(stateRoot, checkout, ["status", taskId]);

  assert.equal(recovered.exitCode, 0, recovered.stderr);
  assert.equal(recovered.stderr, "");
  const view = parseRunView(recovered.stdout);
  assert.equal(view.run.state, RUN_STATES.DONE);
  assert.equal(view.run.revision, 1);
  assert.deepEqual(
    (await readdir(stateRoot)).sort(),
    [committedName, `${runId}.json`].sort(),
  );
});

test("a residual journal fails closed on conflicting or missing context", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "exoframe-cli-residual-conflict-"));
  t.after(async () => rm(sandbox, { recursive: true, force: true }));
  const stateRoot = join(sandbox, "state");
  const checkout = join(sandbox, "checkout");
  await mkdir(checkout);
  const taskText = "Preserve conflicting residual journal evidence";
  const taskId = "task-residual-conflict";
  const runId = "run-residual-conflict";
  await new FileRunCatalog(stateRoot).stage({
    schema_version: 1,
    run_id: runId,
    task: {
      schema_version: 1,
      task_id: taskId,
      requested_outcome: taskText,
      source: {
        kind: "direct_text",
        content_digest: parseSha256Digest(expectedDigest(taskText)),
      },
    },
  });
  const states = new FileRunStateStore(stateRoot);
  await states.initialize({
    schema_version: 1,
    run_id: runId,
    task_id: taskId,
    state: RUN_STATES.INTAKE,
    revision: 0,
  });
  const pendingName = `.${taskId}.pending-task.json`;
  const committedName = `${taskId}.task.json`;
  const stateName = `${runId}.json`;
  const pendingPath = join(stateRoot, pendingName);
  const committedPath = join(stateRoot, committedName);
  const pendingBytes = await readFile(pendingPath, "utf8");
  const conflictingOutcome = "Conflicting committed task context";
  const conflictingBytes = `${JSON.stringify({
    schema_version: 1,
    run_id: "run-conflicting-record",
    task: {
      schema_version: 1,
      task_id: taskId,
      requested_outcome: conflictingOutcome,
      source: {
        kind: "direct_text",
        content_digest: expectedDigest(conflictingOutcome),
      },
    },
  }, null, 2)}\n`;
  await writeFile(committedPath, conflictingBytes, "utf8");

  const conflict = await invokeCli(stateRoot, checkout, ["status", taskId]);

  assert.equal(conflict.exitCode, 1);
  assert.equal(conflict.stdout, "");
  assert.match(conflict.stderr, /conflicting/iu);
  assert.equal(await readFile(pendingPath, "utf8"), pendingBytes);
  assert.equal(await readFile(committedPath, "utf8"), conflictingBytes);

  await writeFile(committedPath, pendingBytes, "utf8");
  await rm(join(stateRoot, stateName));
  const missingState = await invokeCli(stateRoot, checkout, ["status", taskId]);

  assert.equal(missingState.exitCode, 1);
  assert.equal(missingState.stdout, "");
  assert.match(missingState.stderr, /corrupt durable run context/iu);
  assert.equal(await readFile(pendingPath, "utf8"), pendingBytes);
  assert.equal(await readFile(committedPath, "utf8"), pendingBytes);
  assert.deepEqual(
    (await readdir(stateRoot)).sort(),
    [committedName, pendingName].sort(),
  );
});

test("recoverers re-evaluate a concurrently committed catalog phase", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "exoframe-cli-phase-race-"));
  t.after(async () => rm(sandbox, { recursive: true, force: true }));
  const stateRoot = join(sandbox, "state");
  const checkout = join(sandbox, "checkout");
  await mkdir(checkout);
  const taskText = "Re-evaluate a concurrently published catalog";
  const taskId = "task-phase-race";
  const runId = "run-phase-race";
  await new FileRunCatalog(stateRoot).stage({
    schema_version: 1,
    run_id: runId,
    task: {
      schema_version: 1,
      task_id: taskId,
      requested_outcome: taskText,
      source: {
        kind: "direct_text",
        content_digest: parseSha256Digest(expectedDigest(taskText)),
      },
    },
  });
  await new FileRunStateStore(stateRoot).initialize({
    schema_version: 1,
    run_id: runId,
    task_id: taskId,
    state: RUN_STATES.INTAKE,
    revision: 0,
  });
  const pendingName = `.${taskId}.pending-task.json`;
  const committedName = `${taskId}.task.json`;
  const stateName = `${runId}.json`;
  const lockName = `.${runId}~lock`;
  await writeFile(join(stateRoot, lockName), `${process.pid}\n`, "utf8");
  const recoveries = Array.from({ length: 24 }, () =>
    invokeCli(stateRoot, checkout, ["status", taskId])
  );
  const candidatePrefix = `.${runId}~candidate~`;
  const readinessDeadline = Date.now() + 5_000;
  let initializerObserved = false;
  while (!initializerObserved && Date.now() < readinessDeadline) {
    initializerObserved = (await readdir(stateRoot)).some((name) =>
      name.startsWith(candidatePrefix)
    );
    if (!initializerObserved) {
      await delay(1);
    }
  }
  assert.equal(
    initializerObserved,
    true,
    "a recoverer must enter pending-only initialization before publication",
  );
  await writeFile(
    join(stateRoot, stateName),
    `${JSON.stringify({
      schema_version: 1,
      run_id: runId,
      task_id: taskId,
      state: RUN_STATES.DONE,
      revision: 1,
    }, null, 2)}\n`,
    "utf8",
  );
  await link(
    join(stateRoot, pendingName),
    join(stateRoot, committedName),
  );
  await unlink(join(stateRoot, lockName));

  const outcomes = await Promise.all(recoveries);

  for (const outcome of outcomes) {
    assert.equal(outcome.exitCode, 0, outcome.stderr);
    assert.equal(outcome.stderr, "");
  }
  assert.equal(new Set(outcomes.map(({ stdout }) => stdout)).size, 1);
  const view = parseRunView(outcomes[0]?.stdout ?? "");
  assert.equal(view.run.state, RUN_STATES.DONE);
  assert.equal(view.run.revision, 1);
  assert.deepEqual(
    (await readdir(stateRoot)).sort(),
    [committedName, stateName].sort(),
  );
});

test("pending recovery never masks an initializer lock failure", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "exoframe-cli-lock-failure-"));
  t.after(async () => rm(sandbox, { recursive: true, force: true }));
  const stateRoot = join(sandbox, "state");
  const checkout = join(sandbox, "checkout");
  await mkdir(checkout);
  const taskText = "Preserve a journal when initialization cannot lock";
  const taskId = "task-lock-failure";
  const runId = "run-lock-failure";
  await new FileRunCatalog(stateRoot).stage({
    schema_version: 1,
    run_id: runId,
    task: {
      schema_version: 1,
      task_id: taskId,
      requested_outcome: taskText,
      source: {
        kind: "direct_text",
        content_digest: parseSha256Digest(expectedDigest(taskText)),
      },
    },
  });
  await new FileRunStateStore(stateRoot).save({
    schema_version: 1,
    run_id: runId,
    task_id: taskId,
    state: RUN_STATES.INTAKE,
    revision: 0,
  });
  const pendingName = `.${taskId}.pending-task.json`;
  const stateName = `${runId}.json`;
  const lockName = `.${runId}~lock`;
  await mkdir(join(stateRoot, lockName));
  const pendingBefore = await readFile(join(stateRoot, pendingName), "utf8");
  const stateBefore = await readFile(join(stateRoot, stateName), "utf8");

  const rejected = await invokeCli(stateRoot, checkout, ["status", taskId]);

  assert.equal(rejected.exitCode, 1);
  assert.equal(rejected.stdout, "");
  assert.doesNotMatch(rejected.stderr.trimEnd(), /\n|\s+at\s/u);
  assert.deepEqual(
    (await readdir(stateRoot)).sort(),
    [lockName, pendingName, stateName].sort(),
  );
  assert.equal(await readFile(join(stateRoot, pendingName), "utf8"), pendingBefore);
  assert.equal(await readFile(join(stateRoot, stateName), "utf8"), stateBefore);
});

test("concurrent recovery is idempotent for every CLI process", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "exoframe-cli-concurrent-recovery-"));
  t.after(async () => rm(sandbox, { recursive: true, force: true }));
  const stateRoot = join(sandbox, "state");
  const checkout = join(sandbox, "checkout");
  await mkdir(checkout);
  const taskText = "Recover one publication from many processes";
  const taskId = "task-concurrent-recovery";
  const runId = "run-concurrent-recovery";
  await new FileRunCatalog(stateRoot).stage({
    schema_version: 1,
    run_id: runId,
    task: {
      schema_version: 1,
      task_id: taskId,
      requested_outcome: taskText,
      source: {
        kind: "direct_text",
        content_digest: parseSha256Digest(expectedDigest(taskText)),
      },
    },
  });

  const recoveries = await Promise.all(
    Array.from({ length: 12 }, () =>
      invokeCli(stateRoot, checkout, ["status", taskId])
    ),
  );

  for (const recovery of recoveries) {
    assert.equal(recovery.exitCode, 0, recovery.stderr);
    assert.equal(recovery.stderr, "");
    assertInitialRun(parseRunView(recovery.stdout), taskText);
  }
  assert.equal(new Set(recoveries.map(({ stdout }) => stdout)).size, 1);
  assert.deepEqual(
    (await readdir(stateRoot)).sort(),
    [`${runId}.json`, `${taskId}.task.json`],
  );
});

test("concurrent run creators all report their durable task identity", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "exoframe-cli-concurrent-run-"));
  t.after(async () => rm(sandbox, { recursive: true, force: true }));
  const stateRoot = join(sandbox, "state");
  const checkout = join(sandbox, "checkout");
  await mkdir(checkout);
  const outcomes = await Promise.all(
    Array.from({ length: 24 }, (_, index) =>
      invokeCli(stateRoot, checkout, ["run", `Concurrent task ${index}`])
    ),
  );
  const allViews: RunView[] = [];
  for (const outcome of outcomes) {
    assert.equal(outcome.exitCode, 0, outcome.stderr);
    assert.equal(outcome.stderr, "");
    allViews.push(parseRunView(outcome.stdout));
  }

  assert.equal(allViews.length, 24);
  assert.equal(new Set(allViews.map(({ task }) => task.task_id)).size, 24);
  assert.equal(new Set(allViews.map(({ run }) => run.run_id)).size, 24);
  const listed = await invokeCli(stateRoot, checkout, ["status"]);
  assert.equal(listed.exitCode, 0, listed.stderr);
  assert.equal((JSON.parse(listed.stdout) as readonly RunView[]).length, 24);
  assert.equal((await readdir(stateRoot)).length, 72);
  assert.equal(
    (await readdir(stateRoot)).some((name) =>
      name.startsWith(".") || name.includes("~")
    ),
    false,
  );
});

test("explain describes the current state and next action for a person", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "exoframe-cli-explain-"));
  t.after(async () => rm(sandbox, { recursive: true, force: true }));
  const stateRoot = join(sandbox, "state");
  const checkout = join(sandbox, "checkout");
  await mkdir(checkout);
  const taskText = "Make invoice totals understandable";
  const started = parseStartedRun(
    await invokeCli(stateRoot, checkout, ["run", taskText]),
  );

  const explained = await invokeCli(stateRoot, checkout, [
    "explain",
    started.task.task_id,
  ]);
  const explainedAgain = await invokeCli(stateRoot, checkout, [
    "explain",
    started.task.task_id,
  ]);

  assert.equal(explained.exitCode, 0);
  assert.equal(explained.stderr, "");
  assert.equal(explainedAgain.stdout, explained.stdout);
  assert.throws(() => JSON.parse(explained.stdout));
  assert.equal(explained.stdout.includes(started.task.task_id), true);
  assert.equal(explained.stdout.includes(taskText), true);
  assert.match(explained.stdout, /state:\s*INTAKE/iu);
  assert.match(explained.stdout, /next action:/iu);
  assert.match(explained.stdout, /intake/iu);
});

test("resume reloads INTAKE context without inventing a later stage", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "exoframe-cli-resume-"));
  t.after(async () => rm(sandbox, { recursive: true, force: true }));
  const stateRoot = join(sandbox, "state");
  const checkout = join(sandbox, "checkout");
  await mkdir(checkout);
  const taskText = "Retain the direct task after restart";
  const startedResult = await invokeCli(stateRoot, checkout, ["run", taskText]);
  const started = parseStartedRun(startedResult);

  const resumed = await invokeCli(stateRoot, checkout, [
    "resume",
    started.task.task_id,
  ]);
  const statusAfterResume = await invokeCli(stateRoot, checkout, [
    "status",
    started.task.task_id,
  ]);

  assert.equal(resumed.exitCode, 0);
  assert.equal(resumed.stderr, "");
  assert.equal(resumed.stdout.includes(started.task.task_id), true);
  assert.equal(resumed.stdout.includes(taskText), true);
  assert.match(resumed.stdout, /INTAKE/u);
  assert.doesNotMatch(
    resumed.stdout,
    /IMPLEMENTING|VERIFYING|ENGINEERING_READY|MERGING|MERGED|DONE/u,
  );
  assert.equal(statusAfterResume.stdout, startedResult.stdout);
});

test("command errors are actionable and never fabricate a run", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "exoframe-cli-errors-"));
  t.after(async () => rm(sandbox, { recursive: true, force: true }));
  const stateRoot = join(sandbox, "state");
  const checkout = join(sandbox, "checkout");
  await mkdir(checkout);

  const malformedCommands = [
    ["run"],
    ["run", ""],
    ["run", "   "],
    ["run", "one", "two"],
    ["status", "one", "two"],
    ["explain", "one", "two"],
    ["resume"],
    ["resume", "one", "two"],
    ["surfaces"],
    ["surfaces", "explain"],
    ["surfaces", "explain", "src/../secret.ts"],
    ["policy"],
    ["policy", "check", "extra"],
  ] as const;
  for (const args of malformedCommands) {
    const result = await invokeCli(stateRoot, checkout, args);
    assert.equal(result.exitCode, 2, args.join(" "));
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /usage:/iu);
  }

  for (const command of ["status", "explain", "resume"] as const) {
    const result = await invokeCli(stateRoot, checkout, [
      command,
      "missing-task",
    ]);
    assert.equal(result.exitCode, 1, command);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /missing-task/u);
    assert.match(result.stderr, /not found/iu);
  }

  const listed = await invokeCli(stateRoot, checkout, ["status"]);
  assert.equal(listed.exitCode, 0);
  assert.equal(listed.stderr, "");
  assert.deepEqual(JSON.parse(listed.stdout), []);

  const injected = await invokeCli(stateRoot, checkout, [
    "unknown\nforged\u001b[31m\u2028next\u2029last",
  ]);
  assert.equal(injected.exitCode, 2);
  assert.equal(injected.stderr.includes("\u001b"), false);
  assert.equal(injected.stderr.includes("\nforged"), false);
  assert.equal(injected.stderr.includes("\u2028"), false);
  assert.equal(injected.stderr.includes("\u2029"), false);
  assert.match(
    injected.stderr,
    /unknown\\u000aforged\\u001b\[31m\\u2028next\\u2029last/u,
  );

  const invalidRoot = await invokeCli("", checkout, ["status"]);
  assert.equal(invalidRoot.exitCode, 1);
  assert.equal(invalidRoot.stdout, "");
  const invalidRootError = invalidRoot.stderr.trimEnd();
  assert.doesNotMatch(invalidRootError, /\n|at FileRunCatalog|TypeError:/u);
  assert.match(invalidRootError, /invalid run catalog directory/iu);
});

test("malformed commands never inspect or recover durable state", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "exoframe-cli-usage-boundary-"));
  t.after(async () => rm(sandbox, { recursive: true, force: true }));
  const stateRoot = join(sandbox, "state");
  const checkout = join(sandbox, "checkout");
  await mkdir(checkout);
  const taskText = "Leave malformed-command state untouched";
  const taskId = "task-invalid-command";
  await new FileRunCatalog(stateRoot).stage({
    schema_version: 1,
    run_id: "run-invalid-command",
    task: {
      schema_version: 1,
      task_id: taskId,
      requested_outcome: taskText,
      source: {
        kind: "direct_text",
        content_digest: parseSha256Digest(expectedDigest(taskText)),
      },
    },
  });
  const pendingName = `.${taskId}.pending-task.json`;
  await writeFile(join(stateRoot, pendingName), "{not-json\n", "utf8");

  for (const args of [
    ["resume"],
    ["resume", " "],
    ["status", "../escape"],
    ["explain", "UPPER"],
    ["gate"],
    ["gate", "run"],
    ["evidence"],
    ["evidence", "show"],
  ] as const) {
    const malformed = await invokeCli(stateRoot, checkout, args);
    assert.equal(malformed.exitCode, 2, args.join(" "));
    assert.equal(malformed.stdout, "");
    assert.match(malformed.stderr, /usage:/iu);
    assert.deepEqual(await readdir(stateRoot), [pendingName]);
  }
});

test("machine and human output escape terminal-affecting Unicode", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "exoframe-cli-terminal-safe-"));
  t.after(async () => rm(sandbox, { recursive: true, force: true }));
  const stateRoot = join(sandbox, "state");
  const checkout = join(sandbox, "checkout");
  await mkdir(checkout);
  const taskText =
    "Show C1 \u009b, line \u2028, paragraph \u2029, and bidi \u202etxt.exe safely";

  const started = await invokeCli(stateRoot, checkout, ["run", taskText]);

  assert.equal(started.exitCode, 0);
  assert.equal(started.stderr, "");
  assert.equal(started.stdout.includes("\u009b"), false);
  assert.equal(started.stdout.includes("\u2028"), false);
  assert.equal(started.stdout.includes("\u2029"), false);
  assert.equal(started.stdout.includes("\u202e"), false);
  assert.match(started.stdout, /\\u009b/u);
  assert.match(started.stdout, /\\u2028/u);
  assert.match(started.stdout, /\\u2029/u);
  assert.match(started.stdout, /\\u202e/u);
  const view = parseRunView(started.stdout);
  assert.equal(view.task.requested_outcome, taskText);

  const explained = await invokeCli(stateRoot, checkout, [
    "explain",
    view.task.task_id,
  ]);
  assert.equal(explained.exitCode, 0);
  assert.equal(explained.stderr, "");
  assert.equal(explained.stdout.includes("\u009b"), false);
  assert.equal(explained.stdout.includes("\u2028"), false);
  assert.equal(explained.stdout.includes("\u2029"), false);
  assert.equal(explained.stdout.includes("\u202e"), false);
  assert.match(explained.stdout, /\\u009b/u);
  assert.match(explained.stdout, /\\u2028/u);
  assert.match(explained.stdout, /\\u2029/u);
  assert.match(explained.stdout, /\\u202e/u);
});

test("a completed run cannot be resumed", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "exoframe-cli-done-"));
  t.after(async () => rm(sandbox, { recursive: true, force: true }));
  const stateRoot = join(sandbox, "state");
  const checkout = join(sandbox, "checkout");
  await mkdir(checkout);
  const started = parseStartedRun(
    await invokeCli(stateRoot, checkout, ["run", "Already delivered task"]),
  );
  await new FileRunStateStore(stateRoot).save({
    schema_version: 1,
    run_id: started.run.run_id,
    task_id: started.task.task_id,
    state: RUN_STATES.DONE,
    revision: 1,
  });

  const resumed = await invokeCli(stateRoot, checkout, [
    "resume",
    started.task.task_id,
  ]);

  assert.equal(resumed.exitCode, 1);
  assert.equal(resumed.stdout, "");
  assert.match(resumed.stderr, /DONE/u);
  assert.match(resumed.stderr, /cannot resume|already complete/iu);
  assert.equal(resumed.stderr.includes(started.task.task_id), true);
  const status = parseRunView(
    (await invokeCli(stateRoot, checkout, ["status", started.task.task_id])).stdout,
  );
  assert.equal(status.run.state, "DONE");
  assert.equal(status.run.revision, 1);
});

test("a clear task proceeds through automatic intake without asking for repository facts", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "exoframe-cli-clear-intake-"));
  t.after(async () => rm(sandbox, { recursive: true, force: true }));
  const stateRoot = join(sandbox, "state");
  const checkout = join(sandbox, "checkout");
  await mkdir(checkout);
  await execFileAsync("git", ["init", "--quiet"], { cwd: checkout });
  await writeFile(
    join(checkout, "package.json"),
    `${JSON.stringify({ scripts: { test: "node --test" } }, null, 2)}\n`,
    "utf8",
  );
  const taskText = "Add CSV export to the orders page";

  const started = await invokeCli(stateRoot, checkout, ["run", taskText]);
  const view = parseStartedRun(started);

  assert.equal(view.run.state, RUN_STATES.INTAKE);
  assert.equal(view.run.revision, 0);
  assert.equal(view.packet, undefined);
  assert.ok(view.intent);
  assert.deepEqual(view.intent.goals, [taskText]);
  assert.deepEqual(view.intent.unresolved_decisions, []);
  assert.match(
    view.intent.constraints.join("\n"),
    /do not ask a human for discoverable repository facts/iu,
  );
  assert.match(view.intent.constraints.join("\n"), /node --test/u);
  assert.doesNotMatch(started.stderr, /base[_ ]ref|repository facts|which branch/iu);
  assert.doesNotMatch(started.stdout, /base[_ ]ref|which branch/iu);

  const explained = await invokeCli(stateRoot, checkout, [
    "explain",
    view.task.task_id,
  ]);
  assert.equal(explained.exitCode, 0, explained.stderr);
  assert.match(explained.stdout, /intent:/iu);
  assert.match(explained.stdout, /intake/iu);
});

test("an ambiguous product requirement emits one packet and does not start implementation", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "exoframe-cli-packet-intake-"));
  t.after(async () => rm(sandbox, { recursive: true, force: true }));
  const stateRoot = join(sandbox, "state");
  const checkout = join(sandbox, "checkout");
  await mkdir(checkout);
  const taskText = "Should the orders export be CSV or XLSX?";

  const started = await invokeCli(stateRoot, checkout, ["run", taskText]);
  const view = parseStartedRun(started);

  assert.equal(view.run.state, RUN_STATES.WAITING_FOR_INTAKE_DECISION);
  assert.equal(view.run.revision, 1);
  assert.equal(view.intent, undefined);
  assert.ok(view.packet);
  assert.equal(view.packet.request.kind, "product_decision");
  assert.equal(view.packet.request.related_questions.length, 1);
  assert.deepEqual(view.packet.request.related_questions[0]?.alternatives, [
    "CSV",
    "XLSX",
  ]);

  const resumed = await invokeCli(stateRoot, checkout, [
    "resume",
    view.task.task_id,
  ]);
  assert.equal(resumed.exitCode, 0, resumed.stderr);
  assert.match(resumed.stdout, /WAITING_FOR_INTAKE_DECISION/u);
  assert.doesNotMatch(resumed.stdout, /IMPLEMENTING|VERIFYING|DONE/u);

  const status = parseRunView(
    (await invokeCli(stateRoot, checkout, ["status", view.task.task_id])).stdout,
  );
  assert.equal(status.run.state, RUN_STATES.WAITING_FOR_INTAKE_DECISION);
  assert.equal(status.packet?.packet_id, view.packet.packet_id);
});
