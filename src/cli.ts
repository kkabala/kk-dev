import { createHash, randomUUID } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";

import { parseSha256Digest, RUN_STATES } from "./domain.ts";
import type { Task } from "./domain.ts";
import { productInfo } from "./product.ts";
import {
  FileRunCatalog,
  isRunCatalogIdentifier,
} from "./run-catalog.ts";
import type { RunCatalogRecord } from "./run-catalog.ts";
import { FileRunStateStore } from "./run-state-store.ts";
import type { PersistedRunState } from "./run-state-store.ts";

export type CliIo = Readonly<{
  error(message: string): void;
  log(message: string): void;
}>;

type RunView = Readonly<{
  task: Task;
  run: PersistedRunState;
}>;

type CliServices = Readonly<{
  catalog: FileRunCatalog;
  states: FileRunStateStore;
}>;

type WorkspaceBoundary = Readonly<{
  markerIdentity: string;
  root: string;
}>;

const HELP = [
  "Exoframe — autonomous delivery around pstack",
  "",
  "Usage:",
  "  exoframe run <task text>",
  "  exoframe status [task-id]",
  "  exoframe explain [task-id]",
  "  exoframe resume <task-id>",
  "  exoframe --help",
  "  exoframe --version",
].join("\n");

const nextActionByState: Readonly<Record<string, string>> = Object.freeze({
  [RUN_STATES.INTAKE]: "continue automatic intake from the durable task context",
  [RUN_STATES.WAITING_FOR_INTAKE_DECISION]: "wait for the requested intake decision",
  [RUN_STATES.INTAKE_BLOCKED]: "restore the blocked intake prerequisite",
  [RUN_STATES.IMPLEMENTING]: "continue the bounded pstack assignment",
  [RUN_STATES.WAITING_FOR_IMPLEMENTATION_DECISION]:
    "wait for the requested implementation decision",
  [RUN_STATES.VERIFYING]: "continue protected verification",
  [RUN_STATES.VERIFYING_BLOCKED]: "restore the blocked verification prerequisite",
  [RUN_STATES.WAITING_FOR_EXCEPTION]: "wait for the exception decision",
  [RUN_STATES.ENGINEERING_READY_WITH_EXCEPTION]:
    "continue through mandatory human governance",
  [RUN_STATES.ENGINEERING_READY]: "evaluate review and merge governance",
  [RUN_STATES.WAITING_FOR_REVIEW]: "wait for required review without an active agent",
  [RUN_STATES.MERGE_READY]: "prepare the protected merge path",
  [RUN_STATES.WAITING_FOR_MERGE]: "wait for human merge authorization",
  [RUN_STATES.MERGING]: "verify and land the exact merge candidate",
  [RUN_STATES.MERGED]: "observe the release path",
  [RUN_STATES.RELEASE_PENDING]: "wait for the declared release action",
  [RUN_STATES.DELIVERY_VERIFYING]: "verify delivered identity and health",
  [RUN_STATES.DONE]: "no action; the run is complete",
  [RUN_STATES.WAITING_FOR_REPAIR]: "wait for the linked repair delivery",
});

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code;
}

async function findCheckoutRoot(
  startDirectory: string,
): Promise<WorkspaceBoundary> {
  let candidate = await realpath(startDirectory);
  const fallback = candidate;
  while (true) {
    try {
      const marker = await lstat(path.join(candidate, ".git"), {
        bigint: true,
      });
      if (marker.isDirectory() || marker.isFile()) {
        return Object.freeze({
          root: candidate,
          markerIdentity: [
            marker.dev,
            marker.ino,
            marker.birthtimeNs,
          ].join(":"),
        });
      }
    } catch (error) {
      if (!hasErrorCode(error, "ENOENT")) {
        throw error;
      }
    }
    const parent = path.dirname(candidate);
    if (parent === candidate) {
      const fallbackIdentity = await lstat(fallback, { bigint: true });
      return Object.freeze({
        root: fallback,
        markerIdentity: [
          "non-git",
          fallbackIdentity.dev,
          fallbackIdentity.ino,
          fallbackIdentity.birthtimeNs,
        ].join(":"),
      });
    }
    candidate = parent;
  }
}

async function defaultStateRoot(): Promise<string> {
  const boundary = await findCheckoutRoot(process.cwd());
  const identity = await lstat(boundary.root, { bigint: true });
  const workspaceKey = createHash("sha256")
    .update(boundary.root)
    .update("\0")
    .update(identity.dev.toString())
    .update("\0")
    .update(identity.ino.toString())
    .update("\0")
    .update(identity.birthtimeNs.toString())
    .update("\0")
    .update(boundary.markerIdentity)
    .digest("hex");
  return path.join(
    homedir(),
    ".exoframe",
    "state",
    "workspaces",
    workspaceKey,
  );
}

async function createServices(): Promise<CliServices> {
  const configuredRoot = process.env.EXOFRAME_STATE_ROOT;
  const stateRoot = configuredRoot === undefined
    ? await defaultStateRoot()
    : configuredRoot;
  return {
    catalog: new FileRunCatalog(stateRoot),
    states: new FileRunStateStore(stateRoot),
  };
}

function usageError(io: CliIo, message: string): number {
  io.error(`${message}\n\n${HELP}`);
  return 2;
}

function terminalSafe(value: string): string {
  return value.replace(
    /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/gu,
    (character) =>
      `\\u${character.codePointAt(0)?.toString(16).padStart(4, "0") ?? "fffd"}`,
  );
}

function terminalSafeJson(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(
    /[\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/gu,
    (character) =>
      `\\u${character.codePointAt(0)?.toString(16).padStart(4, "0") ?? "fffd"}`,
  );
}

function quotedTaskText(value: string): string {
  return terminalSafeJson(value);
}

function operationalError(io: CliIo, error: unknown): number {
  const detail = error instanceof Error ? error.message : "Unknown failure";
  io.error(`Exoframe failed: ${terminalSafe(detail)}`);
  return 1;
}

function printJson(io: CliIo, value: unknown): void {
  io.log(terminalSafeJson(value));
}

function toView(
  record: RunCatalogRecord,
  run: PersistedRunState,
): RunView {
  return Object.freeze({ task: record.task, run });
}

async function loadView(
  services: CliServices,
  taskId: string,
): Promise<RunView | null> {
  const record = await services.catalog.load(taskId);
  if (record === null) {
    return null;
  }
  const run = await services.states.load(record.run_id);
  if (run === null || run.task_id !== record.task.task_id) {
    throw new Error(`Corrupt durable run context for task ${taskId}`);
  }
  return toView(record, run);
}

async function listViews(services: CliServices): Promise<readonly RunView[]> {
  const views: RunView[] = [];
  for (const record of await services.catalog.list()) {
    const run = await services.states.load(record.run_id);
    if (run === null || run.task_id !== record.task.task_id) {
      throw new Error(
        `Corrupt durable run context for task ${record.task.task_id}`,
      );
    }
    views.push(toView(record, run));
  }
  return Object.freeze(views);
}

function createTask(taskId: string, requestedOutcome: string): Task {
  const contentDigest = parseSha256Digest(
    `sha256:${createHash("sha256").update(requestedOutcome).digest("hex")}`,
  );
  return Object.freeze({
    schema_version: 1,
    task_id: taskId,
    requested_outcome: requestedOutcome,
    source: Object.freeze({
      kind: "direct_text",
      content_digest: contentDigest,
    }),
  });
}

async function startRun(
  services: CliServices,
  requestedOutcome: string,
): Promise<RunView> {
  const identity = randomUUID();
  const task = createTask(`task-${identity}`, requestedOutcome);
  const run: PersistedRunState = Object.freeze({
    schema_version: 1 as const,
    run_id: `run-${identity}`,
    task_id: task.task_id,
    state: RUN_STATES.INTAKE,
    revision: 0,
  });
  await services.catalog.stage({
    schema_version: 1,
    run_id: run.run_id,
    task,
  });
  await ensureInitialRun(services.states, run);
  const record = await services.catalog.commit(task.task_id);
  return toView(record, run);
}

function initialRunFor(record: RunCatalogRecord): PersistedRunState {
  return Object.freeze({
    schema_version: 1,
    run_id: record.run_id,
    task_id: record.task.task_id,
    state: RUN_STATES.INTAKE,
    revision: 0,
  });
}

function isExactSnapshot(
  actual: PersistedRunState | null,
  expected: PersistedRunState,
): actual is PersistedRunState {
  return actual !== null &&
    actual.schema_version === expected.schema_version &&
    actual.run_id === expected.run_id &&
    actual.task_id === expected.task_id &&
    actual.state === expected.state &&
    actual.revision === expected.revision;
}

function isSameCatalogRecord(
  left: RunCatalogRecord,
  right: RunCatalogRecord,
): boolean {
  return left.schema_version === right.schema_version &&
    left.run_id === right.run_id &&
    left.task.schema_version === right.task.schema_version &&
    left.task.task_id === right.task.task_id &&
    left.task.requested_outcome === right.task.requested_outcome &&
    left.task.source.kind === right.task.source.kind &&
    left.task.source.content_digest === right.task.source.content_digest;
}

async function ensureInitialRun(
  states: FileRunStateStore,
  intended: PersistedRunState,
): Promise<void> {
  await states.initialize(intended);
  const published = await states.load(intended.run_id);
  if (!isExactSnapshot(published, intended)) {
    throw new Error(
      `Run ${intended.run_id} requires its initial INTAKE revision 0 snapshot`,
    );
  }
}

async function reconcileCommittedRun(
  services: CliServices,
  record: RunCatalogRecord,
): Promise<boolean> {
  const committed = await services.catalog.load(record.task.task_id);
  if (committed === null) {
    return false;
  }
  if (!isSameCatalogRecord(record, committed)) {
    throw new Error(
      `Conflicting committed catalog entry for task ${record.task.task_id}`,
    );
  }
  const publishedRun = await services.states.load(committed.run_id);
  if (
    publishedRun === null ||
    publishedRun.task_id !== committed.task.task_id
  ) {
    throw new Error(
      `Corrupt durable run context for task ${record.task.task_id}`,
    );
  }
  await services.catalog.commit(record.task.task_id);
  return true;
}

async function recoverPendingRuns(services: CliServices): Promise<void> {
  for (const record of await services.catalog.listPending()) {
    if (await reconcileCommittedRun(services, record)) {
      continue;
    }
    const intendedRun = initialRunFor(record);
    try {
      await ensureInitialRun(services.states, intendedRun);
    } catch (error) {
      if (await reconcileCommittedRun(services, record)) {
        continue;
      }
      throw error;
    }
    await services.catalog.commit(record.task.task_id);
  }
}

function explainView(view: RunView): string {
  const nextAction = nextActionByState[view.run.state] ??
    "continue from the durable lifecycle state";
  return [
    `Task: ${view.task.task_id}`,
    `Requested outcome: ${quotedTaskText(view.task.requested_outcome)}`,
    `Run: ${view.run.run_id}`,
    `State: ${view.run.state}`,
    `Next action: ${nextAction}.`,
  ].join("\n");
}

function resumeView(view: RunView): string {
  return [
    `Resume point loaded for task ${view.task.task_id}.`,
    `Requested outcome: ${quotedTaskText(view.task.requested_outcome)}`,
    `State remains ${view.run.state}.`,
    `Next action: ${nextActionByState[view.run.state] ?? "continue the run"}.`,
  ].join("\n");
}

async function runCommand(
  args: readonly string[],
  io: CliIo,
  services: CliServices,
): Promise<number> {
  printJson(io, await startRun(services, args[0] ?? ""));
  return 0;
}

async function statusCommand(
  args: readonly string[],
  io: CliIo,
  services: CliServices,
): Promise<number> {
  if (args.length === 0) {
    printJson(io, await listViews(services));
    return 0;
  }
  const taskId = args[0] ?? "";
  const view = await loadView(services, taskId);
  if (view === null) {
    io.error(`Task ${taskId} was not found.`);
    return 1;
  }
  printJson(io, view);
  return 0;
}

async function explainCommand(
  args: readonly string[],
  io: CliIo,
  services: CliServices,
): Promise<number> {
  if (args.length === 0) {
    const views = await listViews(services);
    io.log(
      views.length === 0
        ? "No durable runs were found."
        : views.map(explainView).join("\n\n"),
    );
    return 0;
  }
  const taskId = args[0] ?? "";
  const view = await loadView(services, taskId);
  if (view === null) {
    io.error(`Task ${taskId} was not found.`);
    return 1;
  }
  io.log(explainView(view));
  return 0;
}

async function resumeCommand(
  args: readonly string[],
  io: CliIo,
  services: CliServices,
): Promise<number> {
  const taskId = args[0] ?? "";
  const view = await loadView(services, taskId);
  if (view === null) {
    io.error(`Task ${taskId} was not found.`);
    return 1;
  }
  if (view.run.state === RUN_STATES.DONE) {
    io.error(`Task ${taskId} is already complete (DONE) and cannot resume.`);
    return 1;
  }
  io.log(resumeView(view));
  return 0;
}

function validateCommandArguments(
  command: string,
  args: readonly string[],
): string | null {
  switch (command) {
    case "run":
      return args.length === 1 && (args[0] ?? "").trim().length > 0
        ? null
        : "run requires exactly one non-empty task text argument.";
    case "status":
      return args.length <= 1 &&
          (args.length === 0 || isRunCatalogIdentifier(args[0]))
        ? null
        : "status accepts at most one valid task ID.";
    case "explain":
      return args.length <= 1 &&
          (args.length === 0 || isRunCatalogIdentifier(args[0]))
        ? null
        : "explain accepts at most one valid task ID.";
    case "resume":
      return args.length === 1 && isRunCatalogIdentifier(args[0])
        ? null
        : "resume requires exactly one valid task ID.";
    default:
      throw new TypeError("Unsupported CLI command");
  }
}

export async function runCli(
  args: readonly string[],
  io: CliIo,
): Promise<number> {
  if (
    args.length === 0 ||
    (args.length === 1 && ["--help", "-h"].includes(args[0] ?? ""))
  ) {
    io.log(HELP);
    return 0;
  }

  if (args.length === 1 && ["--version", "-v"].includes(args[0] ?? "")) {
    io.log(productInfo().version);
    return 0;
  }

  const [command, ...commandArgs] = args;
  if (!["run", "status", "explain", "resume"].includes(command ?? "")) {
    io.error(
      `Unknown argument: ${terminalSafe(command ?? "")}\n` +
        "Run exoframe --help for usage.",
    );
    return 2;
  }
  const argumentError = validateCommandArguments(command ?? "", commandArgs);
  if (argumentError !== null) {
    return usageError(io, argumentError);
  }

  try {
    const services = await createServices();
    await recoverPendingRuns(services);
    switch (command) {
      case "run":
        return await runCommand(commandArgs, io, services);
      case "status":
        return await statusCommand(commandArgs, io, services);
      case "explain":
        return await explainCommand(commandArgs, io, services);
      case "resume":
        return await resumeCommand(commandArgs, io, services);
      default:
        throw new TypeError("Unsupported CLI command");
    }
  } catch (error) {
    return operationalError(io, error);
  }
}
