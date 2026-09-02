import { execFile } from "node:child_process";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type {
  Intent,
  NonEmptyReadonlyArray,
  Task,
  TaskProductDecisionPacket,
} from "./domain.ts";

const execFileAsync = promisify(execFile);
const instructionFileNames = Object.freeze([
  "AGENTS.md",
  "CONTRIBUTING.md",
  "README.md",
]);
const unversionedBaseRef = "unversioned-working-tree";
const choicePattern = /\b(?:or|vs\.?|versus)\b/iu;

export type RepositoryFacts = Readonly<{
  schema_version: 1;
  checkout_root: string;
  base_ref: string;
  instruction_paths: readonly string[];
  test_command: string | null;
  build_command: string | null;
}>;

export type IntakeDecision = Intent | TaskProductDecisionPacket;

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

function capturedTask(task: Task): Task {
  return Object.freeze({
    schema_version: 1 as const,
    task_id: task.task_id,
    requested_outcome: task.requested_outcome,
    source: Object.freeze({
      kind: "direct_text" as const,
      content_digest: task.source.content_digest,
    }),
  });
}

function capturedFacts(facts: RepositoryFacts): RepositoryFacts {
  return Object.freeze({
    schema_version: 1 as const,
    checkout_root: facts.checkout_root,
    base_ref: facts.base_ref,
    instruction_paths: Object.freeze([...facts.instruction_paths]),
    test_command: facts.test_command,
    build_command: facts.build_command,
  });
}

async function discoverBaseRef(checkoutRoot: string): Promise<string> {
  try {
    const originHead = await execFileAsync(
      "git",
      ["-C", checkoutRoot, "symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
      { encoding: "utf8" },
    );
    const named = originHead.stdout.trim().replace(/^origin\//u, "");
    if (named.length > 0) {
      return named;
    }
  } catch {
    // Fall through to the local HEAD name.
  }

  try {
    const localHead = await execFileAsync(
      "git",
      ["-C", checkoutRoot, "rev-parse", "--abbrev-ref", "HEAD"],
      { encoding: "utf8" },
    );
    const named = localHead.stdout.trim();
    if (named.length > 0 && named !== "HEAD") {
      return named;
    }
  } catch {
    // Unborn repositories still advertise the intended branch in .git/HEAD.
  }

  try {
    const headContents = await readFile(
      path.join(checkoutRoot, ".git", "HEAD"),
      "utf8",
    );
    const named = headContents.match(/^ref: refs\/heads\/(\S+)/u)?.[1];
    if (named !== undefined && named.length > 0) {
      return named;
    }
  } catch {
    // Non-Git checkouts use the unversioned sentinel.
  }

  return unversionedBaseRef;
}

async function readScriptCommand(
  checkoutRoot: string,
  scriptName: "test" | "build",
): Promise<string | null> {
  try {
    const packagePath = path.join(checkoutRoot, "package.json");
    const metadata = await lstat(packagePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      return null;
    }
    const resolved = await realpath(packagePath);
    if (
      resolved !== packagePath &&
      !resolved.startsWith(`${checkoutRoot}${path.sep}`)
    ) {
      return null;
    }
    const manifest = JSON.parse(await readFile(packagePath, "utf8")) as {
      scripts?: Record<string, unknown>;
    };
    const command = manifest.scripts?.[scriptName];
    return typeof command === "string" && command.trim().length > 0
      ? command
      : null;
  } catch (error) {
    if (isMissing(error) || error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
}

async function listInstructionPaths(
  checkoutRoot: string,
): Promise<readonly string[]> {
  const found: string[] = [];
  for (const name of instructionFileNames) {
    const candidate = path.join(checkoutRoot, name);
    try {
      const metadata = await lstat(candidate);
      if (!metadata.isFile() || metadata.isSymbolicLink()) {
        continue;
      }
      found.push(name);
    } catch (error) {
      if (!isMissing(error)) {
        throw error;
      }
    }
  }
  return Object.freeze(found);
}

export async function discoverRepositoryFacts(
  checkoutRoot: string,
): Promise<RepositoryFacts> {
  if (typeof checkoutRoot !== "string" || checkoutRoot.length === 0) {
    throw new TypeError("Invalid checkout root");
  }
  const resolvedRoot = await realpath(checkoutRoot);
  const rootMetadata = await lstat(resolvedRoot);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new TypeError("Invalid checkout root");
  }

  return Object.freeze({
    schema_version: 1,
    checkout_root: resolvedRoot,
    base_ref: await discoverBaseRef(resolvedRoot),
    instruction_paths: await listInstructionPaths(resolvedRoot),
    test_command: await readScriptCommand(resolvedRoot, "test"),
    build_command: await readScriptCommand(resolvedRoot, "build"),
  });
}

function isBlockingProductOutcome(requestedOutcome: string): boolean {
  const trimmed = requestedOutcome.trim();
  return trimmed.endsWith("?") || choicePattern.test(trimmed);
}

function intentConstraints(facts: RepositoryFacts): readonly string[] {
  const constraints: string[] = [];
  if (facts.base_ref !== unversionedBaseRef) {
    constraints.push(`Use the discovered base ${facts.base_ref}.`);
  }
  if (facts.test_command !== null) {
    constraints.push(`Use the existing test command ${facts.test_command}.`);
  }
  if (facts.build_command !== null) {
    constraints.push(`Use the existing build command ${facts.build_command}.`);
  }
  if (facts.instruction_paths.length > 0) {
    constraints.push(
      `Read repository instructions in ${facts.instruction_paths.join(", ")}.`,
    );
  }
  constraints.push(
    "Do not ask a human for discoverable repository facts.",
  );
  return Object.freeze(constraints);
}

function choiceAlternatives(
  requestedOutcome: string,
): NonEmptyReadonlyArray<string> {
  const match = requestedOutcome.match(
    /^(.*?)\b(?:or|vs\.?|versus)\b(.*)$/iu,
  );
  const left = match?.[1]?.replace(/[?:]/gu, " ").trim();
  const right = match?.[2]?.replace(/[?:]/gu, " ").trim();
  if (left && right) {
    const leftOption = left.split(/\s+/u).at(-1);
    const rightOption = right.split(/\s+/u)[0];
    if (leftOption && rightOption && leftOption !== rightOption) {
      return Object.freeze([leftOption, rightOption]);
    }
  }
  return Object.freeze([
    "Specify the intended user-visible behavior.",
    "Keep the task blocked until that behavior is named.",
  ]);
}

export function normalizeTask(
  task: Task,
  facts: RepositoryFacts,
  now: Date,
): IntakeDecision {
  const captured = capturedTask(task);
  const observed = capturedFacts(facts);
  if (typeof captured.requested_outcome !== "string") {
    throw new TypeError("Invalid task");
  }
  if (Number.isNaN(now.getTime())) {
    throw new TypeError("Invalid intake clock");
  }

  if (isBlockingProductOutcome(captured.requested_outcome)) {
    const alternatives = choiceAlternatives(captured.requested_outcome);
    return Object.freeze({
      schema_version: 1,
      packet_id: `packet-${captured.task_id}`,
      task_id: captured.task_id,
      subject: Object.freeze({ kind: "task" as const }),
      request: Object.freeze({
        kind: "product_decision" as const,
        related_questions: Object.freeze([
          Object.freeze({
            question_id: `question-${captured.task_id}-0`,
            prompt: captured.requested_outcome,
            recommended_answer: alternatives[0],
            alternatives,
          }),
        ]) as TaskProductDecisionPacket["request"]["related_questions"],
      }),
      why_automation_cannot_decide:
        "The requested outcome is a product choice rather than a concrete, implementable behavior, and the checkout has no recorded decision.",
      affected_behavior: captured.requested_outcome,
      risk_summary:
        "Guessing would change user-visible behavior without an explicit decision.",
      evidence_refs: Object.freeze([
        `evidence://${captured.task_id}/intake/repository-facts`,
      ]) as TaskProductDecisionPacket["evidence_refs"],
      expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      required_approver_identity: "user:task-author",
    });
  }

  return Object.freeze({
    schema_version: 1,
    intent_id: `intent-${captured.task_id}`,
    task_id: captured.task_id,
    goals: Object.freeze([captured.requested_outcome]) as Intent["goals"],
    non_goals: Object.freeze([]),
    constraints: intentConstraints(observed),
    unresolved_decisions: Object.freeze([]),
  });
}

export function isIntakePacket(
  decision: IntakeDecision,
): decision is TaskProductDecisionPacket {
  return "packet_id" in decision;
}
