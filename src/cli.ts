import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants, lstat, open, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

import { parseSha256Digest, RUN_STATES } from "./domain.ts";
import type { Intent, Sha256Digest, Task, TaskProductDecisionPacket } from "./domain.ts";
import {
  computeEvidenceKey,
  isUncertainEvidenceKey,
  serializeCanonical,
} from "./evidence-key.ts";
import { FileEvidenceStore } from "./evidence-store.ts";
import { resolveProtectedTemplate } from "./gate-template.ts";
import type { ResolvedProtectedCommand } from "./gate-template.ts";
import {
  discoverRepositoryFacts,
  isIntakePacket,
  normalizeTask,
} from "./intake.ts";
import { FilePreparationStore } from "./preparation-store.ts";
import { productInfo } from "./product.ts";
import {
  DEFAULT_INFRASTRUCTURE_RETRIES,
  DEFAULT_MAX_ARTIFACT_BYTES,
  ProtectedRunner,
} from "./protected-runner.ts";
import {
  FileRunCatalog,
  isRunCatalogIdentifier,
} from "./run-catalog.ts";
import type { RunCatalogRecord } from "./run-catalog.ts";
import { RUN_EVENTS, transitionRunState } from "./run-state.ts";
import { FileRunStateStore } from "./run-state-store.ts";
import type { PersistedRunState } from "./run-state-store.ts";
import { matchSurfaces } from "./surfaces.ts";

const execFileAsync = promisify(execFile);

export type CliIo = Readonly<{
  error(message: string): void;
  log(message: string): void;
}>;

type RunView = Readonly<{
  task: Task;
  run: PersistedRunState;
  intent?: Intent;
  packet?: TaskProductDecisionPacket;
}>;

type CliServices = Readonly<{
  catalog: FileRunCatalog;
  checkoutRoot: string;
  evidence: FileEvidenceStore;
  preparation: FilePreparationStore;
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
  "  exoframe evidence show <gate-id>",
  "  exoframe gate run --task <task-id> --gate <gate-id>",
  "  exoframe surfaces explain <path>",
  "  exoframe policy check",
  "  exoframe --help",
  "  exoframe --version",
].join("\n");

const RAW_COMMAND = "RAW_COMMAND";
const unversionedSha = "unversioned-working-tree";
const gateIdPattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u;
const rawCliTokens = new Set([
  "--argv",
  "--authoritative",
  "--cmd",
  "--command",
  "--command-text",
  "--command_text",
  "--raw",
  "--shell",
  "--stdin",
  "argv",
  "cmd",
  "command",
  "command_text",
  "raw",
  "shell",
  "stdin",
]);
const rawCliPrefixes = [
  "--argv=",
  "--authoritative=",
  "--cmd=",
  "--command=",
  "--command-text=",
  "--command_text=",
  "--raw=",
  "--shell=",
  "--stdin=",
];

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
  const boundary = await findCheckoutRoot(process.cwd());
  const configuredRoot = process.env.EXOFRAME_STATE_ROOT;
  const stateRoot = configuredRoot === undefined
    ? await defaultStateRoot()
    : configuredRoot;
  return {
    catalog: new FileRunCatalog(stateRoot),
    checkoutRoot: boundary.root,
    evidence: new FileEvidenceStore(path.join(stateRoot, "evidence")),
    preparation: new FilePreparationStore(stateRoot),
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

function isRawCliToken(token: string): boolean {
  if (rawCliTokens.has(token)) {
    return true;
  }
  for (let index = 0; index < rawCliPrefixes.length; index += 1) {
    const prefix = rawCliPrefixes[index];
    if (prefix !== undefined && token.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}

function digestCanonical(value: unknown): Sha256Digest {
  return parseSha256Digest(
    `sha256:${createHash("sha256").update(serializeCanonical(value), "utf8").digest("hex")}`,
  );
}

async function readRegularFile(filePath: string): Promise<string> {
  const metadata = await lstat(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new TypeError("Invalid gate template catalog");
  }
  const handle = await open(
    filePath,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}

async function loadTemplateCatalog(checkoutRoot: string): Promise<unknown> {
  const catalogPath = path.join(checkoutRoot, ".exoframe", "templates.json");
  const contents = await readRegularFile(catalogPath);
  return JSON.parse(contents) as unknown;
}

async function loadSurfaceCatalog(checkoutRoot: string): Promise<unknown> {
  const catalogPath = path.join(checkoutRoot, ".exoframe", "surfaces.json");
  try {
    const contents = await readRegularFile(catalogPath);
    return JSON.parse(contents) as unknown;
  } catch {
    throw new TypeError("Invalid surface catalog");
  }
}

async function loadSurfaceProposal(checkoutRoot: string): Promise<unknown> {
  const proposalPath = path.join(
    checkoutRoot,
    ".exoframe",
    "proposals",
    "surfaces.json",
  );
  try {
    const contents = await readRegularFile(proposalPath);
    return JSON.parse(contents) as unknown;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }
    throw new TypeError("Invalid surface proposal");
  }
}

function isRelativeRepoPath(token: string): boolean {
  if (token.length === 0 || token.includes("\0") || token.startsWith("/") || token.includes("\\")) {
    return false;
  }
  const segments = token.split("/");
  return (
    segments.length > 0 &&
    segments.every((segment) => segment !== "" && segment !== "." && segment !== "..")
  );
}

function representativeDiffPaths(catalog: unknown): string[] {
  if (typeof catalog !== "object" || catalog === null || Array.isArray(catalog)) {
    return [];
  }
  const descriptor = Object.getOwnPropertyDescriptor(catalog, "surfaces");
  if (descriptor === undefined || !("value" in descriptor) || !Array.isArray(descriptor.value)) {
    return [];
  }
  const paths: string[] = [];
  const seen = new Set<string>();
  const surfaces = descriptor.value;
  const length = surfaces.length;
  for (let index = 0; index < length; index += 1) {
    const surfaceDescriptor = Object.getOwnPropertyDescriptor(surfaces, index);
    if (
      surfaceDescriptor === undefined ||
      !("value" in surfaceDescriptor) ||
      typeof surfaceDescriptor.value !== "object" ||
      surfaceDescriptor.value === null ||
      Array.isArray(surfaceDescriptor.value)
    ) {
      continue;
    }
    const pathDescriptor = Object.getOwnPropertyDescriptor(
      surfaceDescriptor.value,
      "paths",
    );
    if (
      pathDescriptor === undefined ||
      !("value" in pathDescriptor) ||
      !Array.isArray(pathDescriptor.value)
    ) {
      continue;
    }
    const patterns = pathDescriptor.value;
    const patternLength = patterns.length;
    for (let patternIndex = 0; patternIndex < patternLength; patternIndex += 1) {
      const patternDescriptor = Object.getOwnPropertyDescriptor(patterns, patternIndex);
      if (
        patternDescriptor === undefined ||
        !("value" in patternDescriptor) ||
        typeof patternDescriptor.value !== "string"
      ) {
        continue;
      }
      const token = patternDescriptor.value.replaceAll("**", "x").replaceAll("*", "x");
      if (!isRelativeRepoPath(token) || seen.has(token)) {
        continue;
      }
      seen.add(token);
      paths.push(token);
    }
  }
  return paths;
}

async function discoverMeasuredSha(checkoutRoot: string): Promise<string> {
  try {
    const revision = await execFileAsync(
      "git",
      ["-C", checkoutRoot, "rev-parse", "HEAD"],
      { encoding: "utf8" },
    );
    const sha = revision.stdout.trim();
    if (/^[0-9a-f]{40,64}$/u.test(sha)) {
      return sha;
    }
  } catch {
    // Non-Git checkouts use the unversioned sentinel.
  }
  return unversionedSha;
}

function executeProtectedCommand(
  command: ResolvedProtectedCommand,
  context: Readonly<{ sandbox_root: string }>,
): Promise<unknown> {
  const file = command.argv[0];
  const argv = command.argv.slice(1);
  if (file === undefined) {
    throw new TypeError("Raw command is not allowed");
  }
  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let stdout = "";
    let stderr = "";
    const child = spawn(file, argv, {
      cwd: context.sandbox_root,
      env: {
        LANG: "C",
        PATH: process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, command.template.timeout_seconds * 1000);

    function finish(observation: Readonly<{
      artifacts: readonly never[];
      exit_code: number | null;
      sandbox_error: string | null;
      stderr: string;
      stdout: string;
      timed_out: boolean;
    }>): void {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(Object.freeze(observation));
    }

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      finish({
        stdout,
        stderr: error.message,
        exit_code: null,
        timed_out: false,
        sandbox_error: error.message,
        artifacts: Object.freeze([]),
      });
    });
    child.on("close", (code) => {
      finish({
        stdout,
        stderr,
        exit_code: code,
        timed_out: timedOut,
        sandbox_error: null,
        artifacts: Object.freeze([]),
      });
    });
  });
}

function parseGateRunFlags(args: readonly string[]): {
  gateId: string;
  taskId: string;
} {
  let taskId: string | undefined;
  let gateId: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--task") {
      taskId = args[index + 1];
      index += 1;
      continue;
    }
    if (token === "--gate") {
      gateId = args[index + 1];
      index += 1;
    }
  }
  if (taskId === undefined || gateId === undefined) {
    throw new TypeError("Invalid gate run arguments");
  }
  return { taskId, gateId };
}

async function gateRunCommand(
  args: readonly string[],
  io: CliIo,
  services: CliServices,
): Promise<number> {
  const flags = parseGateRunFlags(args.slice(1));
  const view = await loadView(services, flags.taskId);
  if (view === null) {
    io.error(`Task ${flags.taskId} was not found.`);
    return 1;
  }
  const catalog = await loadTemplateCatalog(services.checkoutRoot);
  const command = resolveProtectedTemplate(catalog, {
    gate_id: flags.gateId,
  });
  const templateDigest = digestCanonical(command.template);
  const evidenceKey = computeEvidenceKey(
    {
      gate_id: command.gate_id,
      template_digest: templateDigest,
      oracle_digest: null,
    },
    [],
    [],
    {
      capability_profile: "local",
      runner_image: "exoframe-local-protected",
      toolchain: "node-22.18",
    },
  );
  if (isUncertainEvidenceKey(evidenceKey)) {
    throw new TypeError("Invalid evidence key input");
  }
  const measuredSha = await discoverMeasuredSha(services.checkoutRoot);
  const session = await new ProtectedRunner().run(command, {
    task_id: view.task.task_id,
    measured_sha: measuredSha,
    base_sha: measuredSha,
    policy_digest: digestCanonical(catalog),
    runner_digest: digestCanonical({
      kind: "exoframe-local-protected",
      version: productInfo().version,
    }),
    template_digest: templateDigest,
    input_digest: evidenceKey.input_digest,
    environment_digest: evidenceKey.environment_digest,
    oracle_digest: evidenceKey.oracle_digest,
    sandbox_root: services.checkoutRoot,
    evidence_store: services.evidence,
    execute: executeProtectedCommand,
    secrets: [],
    infrastructure_retries: DEFAULT_INFRASTRUCTURE_RETRIES,
    max_artifact_bytes: DEFAULT_MAX_ARTIFACT_BYTES,
    runner_identity: "exoframe-local-protected",
  });
  printJson(io, session);
  return 0;
}

async function evidenceShowCommand(
  args: readonly string[],
  io: CliIo,
  services: CliServices,
): Promise<number> {
  const gateId = args[1] ?? "";
  const measurements = (await services.evidence.list()).filter(
    (measurement) => measurement.gate_id === gateId,
  );
  printJson(
    io,
    Object.freeze({
      schema_version: 1,
      advisory: true,
      gate_id: gateId,
      measurements: Object.freeze(measurements),
    }),
  );
  return 0;
}

async function surfacesExplainCommand(
  args: readonly string[],
  io: CliIo,
  services: CliServices,
): Promise<number> {
  const filePath = args[1] ?? "";
  const catalog = await loadSurfaceCatalog(services.checkoutRoot);
  const decision = matchSurfaces({
    base_policy: catalog,
    diff: { paths: [filePath] },
    proposal: null,
  });
  const classification = decision.classifications[0];
  if (classification === undefined) {
    throw new TypeError("Invalid surface catalog");
  }
  printJson(
    io,
    Object.freeze({
      schema_version: 1,
      path: classification.path,
      category: classification.category,
      surfaces: decision.surfaces,
      policy_weakening: decision.policy_weakening,
    }),
  );
  return 0;
}

async function policyCheckCommand(
  io: CliIo,
  services: CliServices,
): Promise<number> {
  const catalog = await loadSurfaceCatalog(services.checkoutRoot);
  const proposal = await loadSurfaceProposal(services.checkoutRoot);
  const decision = matchSurfaces({
    base_policy: catalog,
    diff: { paths: representativeDiffPaths(catalog) },
    proposal,
  });
  printJson(
    io,
    Object.freeze({
      schema_version: 1,
      policy_weakening: decision.policy_weakening,
      surfaces: decision.surfaces,
    }),
  );
  return decision.policy_weakening ? 1 : 0;
}

function toView(
  record: RunCatalogRecord,
  run: PersistedRunState,
  extras: Readonly<{
    intent?: Intent;
    packet?: TaskProductDecisionPacket;
  }> = {},
): RunView {
  return Object.freeze({
    task: record.task,
    run,
    ...(extras.intent === undefined ? {} : { intent: extras.intent }),
    ...(extras.packet === undefined ? {} : { packet: extras.packet }),
  });
}

async function loadPreparation(
  services: CliServices,
  taskId: string,
): Promise<Readonly<{ intent?: Intent; packet?: TaskProductDecisionPacket }>> {
  const [intent, packet] = await Promise.all([
    services.preparation.loadIntent(taskId),
    services.preparation.loadPacket(taskId),
  ]);
  return {
    ...(intent === null ? {} : { intent }),
    ...(packet === null ? {} : { packet }),
  };
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
  return toView(record, run, await loadPreparation(services, taskId));
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
    views.push(
      toView(record, run, await loadPreparation(services, record.task.task_id)),
    );
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
  return prepareRun(services, record, run);
}

async function prepareRun(
  services: CliServices,
  record: RunCatalogRecord,
  run: PersistedRunState,
): Promise<RunView> {
  const existing = await loadPreparation(services, record.task.task_id);
  if (existing.intent !== undefined) {
    return toView(record, run, existing);
  }
  if (existing.packet !== undefined) {
    if (run.state !== RUN_STATES.INTAKE) {
      return toView(record, run, existing);
    }
    const advanced = Object.freeze({
      ...run,
      state: transitionRunState(
        run.state,
        RUN_EVENTS.BLOCKING_PRODUCT_DECISION,
      ),
      revision: run.revision + 1,
    });
    await services.states.save(advanced);
    return toView(record, advanced, existing);
  }

  const decision = normalizeTask(
    record.task,
    await discoverRepositoryFacts(services.checkoutRoot),
    new Date(),
  );
  if (isIntakePacket(decision)) {
    await services.preparation.savePacket(decision);
    if (run.state === RUN_STATES.INTAKE) {
      const advanced = Object.freeze({
        ...run,
        state: transitionRunState(
          run.state,
          RUN_EVENTS.BLOCKING_PRODUCT_DECISION,
        ),
        revision: run.revision + 1,
      });
      await services.states.save(advanced);
      return toView(record, advanced, { packet: decision });
    }
    return toView(record, run, { packet: decision });
  }

  await services.preparation.saveIntent(decision);
  return toView(record, run, { intent: decision });
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
  const lines = [
    `Task: ${view.task.task_id}`,
    `Requested outcome: ${quotedTaskText(view.task.requested_outcome)}`,
    `Run: ${view.run.run_id}`,
    `State: ${view.run.state}`,
  ];
  if (view.intent !== undefined) {
    lines.push(`Intent: ${quotedTaskText(view.intent.goals[0] ?? "")}`);
  }
  if (view.packet !== undefined) {
    const question = view.packet.request.related_questions[0];
    lines.push(
      `Decision packet: ${quotedTaskText(question?.prompt ?? view.packet.affected_behavior)}`,
    );
  }
  lines.push(`Next action: ${nextAction}.`);
  return lines.join("\n");
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
  const current = await loadView(services, taskId);
  if (current === null) {
    io.error(`Task ${taskId} was not found.`);
    return 1;
  }
  if (current.run.state === RUN_STATES.DONE) {
    io.error(`Task ${taskId} is already complete (DONE) and cannot resume.`);
    return 1;
  }
  const record = await services.catalog.load(taskId);
  if (record === null) {
    io.error(`Task ${taskId} was not found.`);
    return 1;
  }
  const view = await prepareRun(services, record, current.run);
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
    case "gate": {
      if (args.some(isRawCliToken)) {
        return RAW_COMMAND;
      }
      if ((args[0] ?? "") !== "run") {
        return "gate requires the run subcommand.";
      }
      const flags = args.slice(1);
      let taskId: string | undefined;
      let gateId: string | undefined;
      for (let index = 0; index < flags.length; index += 1) {
        const token = flags[index];
        if (token === "--task") {
          const value = flags[index + 1];
          if (
            taskId !== undefined ||
            value === undefined ||
            !isRunCatalogIdentifier(value)
          ) {
            return "gate run requires --task <task-id> and --gate <gate-id>.";
          }
          taskId = value;
          index += 1;
          continue;
        }
        if (token === "--gate") {
          const value = flags[index + 1];
          if (
            gateId !== undefined ||
            value === undefined ||
            !gateIdPattern.test(value)
          ) {
            return "gate run requires --task <task-id> and --gate <gate-id>.";
          }
          gateId = value;
          index += 1;
          continue;
        }
        return RAW_COMMAND;
      }
      return taskId !== undefined && gateId !== undefined
        ? null
        : "gate run requires --task <task-id> and --gate <gate-id>.";
    }
    case "evidence":
      if (args.some(isRawCliToken)) {
        return RAW_COMMAND;
      }
      if ((args[0] ?? "") !== "show") {
        return "evidence requires the show subcommand.";
      }
      return args.length === 2 && gateIdPattern.test(args[1] ?? "")
        ? null
        : "evidence show requires exactly one gate ID.";
    case "surfaces":
      if (args.some(isRawCliToken)) {
        return RAW_COMMAND;
      }
      if ((args[0] ?? "") !== "explain") {
        return "surfaces requires the explain subcommand.";
      }
      return args.length === 2 && isRelativeRepoPath(args[1] ?? "")
        ? null
        : "surfaces explain requires exactly one repository-relative path.";
    case "policy":
      if (args.some(isRawCliToken)) {
        return RAW_COMMAND;
      }
      return args.length === 1 && args[0] === "check"
        ? null
        : "policy requires the check subcommand.";
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
  if (
    !["run", "status", "explain", "resume", "gate", "evidence", "surfaces", "policy"].includes(
      command ?? "",
    )
  ) {
    io.error(
      `Unknown argument: ${terminalSafe(command ?? "")}\n` +
        "Run exoframe --help for usage.",
    );
    return 2;
  }
  const argumentError = validateCommandArguments(command ?? "", commandArgs);
  if (argumentError === RAW_COMMAND) {
    io.error("Raw command is not allowed");
    return 2;
  }
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
      case "gate":
        return await gateRunCommand(commandArgs, io, services);
      case "evidence":
        return await evidenceShowCommand(commandArgs, io, services);
      case "surfaces":
        return await surfacesExplainCommand(commandArgs, io, services);
      case "policy":
        return await policyCheckCommand(io, services);
      default:
        throw new TypeError("Unsupported CLI command");
    }
  } catch (error) {
    return operationalError(io, error);
  }
}
