import { randomUUID } from "node:crypto";
import {
  chmod,
  constants,
  link,
  lstat,
  mkdir,
  open,
  unlink,
} from "node:fs/promises";
import path from "node:path";

import type { Intent, TaskProductDecisionPacket } from "./domain.ts";
import { isRunCatalogIdentifier } from "./run-catalog.ts";

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

function assertTaskId(value: unknown): asserts value is string {
  if (!isRunCatalogIdentifier(value)) {
    throw new TypeError("Invalid task or run identifier");
  }
}

function getOwnDataProperty(object: object, key: PropertyKey): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (descriptor === undefined || !("value" in descriptor)) {
    throw new TypeError("Invalid preparation record");
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
    throw new TypeError("Invalid preparation record");
  }
}

function assertStringArray(value: unknown): asserts value is readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new TypeError("Invalid preparation record");
  }
}

function assertNonEmptyStringArray(
  value: unknown,
): asserts value is readonly [string, ...string[]] {
  assertStringArray(value);
  if (value.length === 0) {
    throw new TypeError("Invalid preparation record");
  }
}

const intentKeys = [
  "schema_version",
  "intent_id",
  "task_id",
  "goals",
  "non_goals",
  "constraints",
  "unresolved_decisions",
] as const;

const packetKeys = [
  "schema_version",
  "packet_id",
  "task_id",
  "subject",
  "request",
  "why_automation_cannot_decide",
  "affected_behavior",
  "risk_summary",
  "evidence_refs",
  "expires_at",
  "required_approver_identity",
] as const;

export function normalizeIntent(value: unknown): Intent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Invalid preparation record");
  }
  assertExactKeys(value, intentKeys);
  const schemaVersion = getOwnDataProperty(value, "schema_version");
  const intentId = getOwnDataProperty(value, "intent_id");
  const taskId = getOwnDataProperty(value, "task_id");
  const goals = getOwnDataProperty(value, "goals");
  const nonGoals = getOwnDataProperty(value, "non_goals");
  const constraints = getOwnDataProperty(value, "constraints");
  const unresolved = getOwnDataProperty(value, "unresolved_decisions");
  assertTaskId(taskId);
  if (
    schemaVersion !== 1 ||
    typeof intentId !== "string" ||
    intentId.length === 0
  ) {
    throw new TypeError("Invalid preparation record");
  }
  assertNonEmptyStringArray(goals);
  assertStringArray(nonGoals);
  assertStringArray(constraints);
  assertStringArray(unresolved);
  return Object.freeze({
    schema_version: 1,
    intent_id: intentId,
    task_id: taskId,
    goals: Object.freeze([...goals]) as Intent["goals"],
    non_goals: Object.freeze([...nonGoals]),
    constraints: Object.freeze([...constraints]),
    unresolved_decisions: Object.freeze([...unresolved]),
  });
}

export function normalizePacket(value: unknown): TaskProductDecisionPacket {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Invalid preparation record");
  }
  assertExactKeys(value, packetKeys);
  const schemaVersion = getOwnDataProperty(value, "schema_version");
  const packetId = getOwnDataProperty(value, "packet_id");
  const taskId = getOwnDataProperty(value, "task_id");
  const subjectValue = getOwnDataProperty(value, "subject");
  const requestValue = getOwnDataProperty(value, "request");
  const why = getOwnDataProperty(value, "why_automation_cannot_decide");
  const affected = getOwnDataProperty(value, "affected_behavior");
  const risk = getOwnDataProperty(value, "risk_summary");
  const evidence = getOwnDataProperty(value, "evidence_refs");
  const expiresAt = getOwnDataProperty(value, "expires_at");
  const approver = getOwnDataProperty(value, "required_approver_identity");
  assertTaskId(taskId);
  if (
    schemaVersion !== 1 ||
    typeof packetId !== "string" ||
    packetId.length === 0 ||
    typeof why !== "string" ||
    why.length === 0 ||
    typeof affected !== "string" ||
    affected.length === 0 ||
    typeof risk !== "string" ||
    risk.length === 0 ||
    typeof expiresAt !== "string" ||
    expiresAt.length === 0 ||
    typeof approver !== "string" ||
    approver.length === 0 ||
    typeof subjectValue !== "object" ||
    subjectValue === null ||
    Array.isArray(subjectValue) ||
    typeof requestValue !== "object" ||
    requestValue === null ||
    Array.isArray(requestValue)
  ) {
    throw new TypeError("Invalid preparation record");
  }
  assertExactKeys(subjectValue, ["kind"]);
  assertExactKeys(requestValue, ["kind", "related_questions"]);
  const subjectKind = getOwnDataProperty(subjectValue, "kind");
  const requestKind = getOwnDataProperty(requestValue, "kind");
  const questionsValue = getOwnDataProperty(requestValue, "related_questions");
  if (
    subjectKind !== "task" ||
    requestKind !== "product_decision" ||
    !Array.isArray(questionsValue) ||
    questionsValue.length === 0
  ) {
    throw new TypeError("Invalid preparation record");
  }
  assertNonEmptyStringArray(evidence);
  const questions = questionsValue.map((question) => {
    if (typeof question !== "object" || question === null || Array.isArray(question)) {
      throw new TypeError("Invalid preparation record");
    }
    assertExactKeys(question, [
      "question_id",
      "prompt",
      "recommended_answer",
      "alternatives",
    ]);
    const questionId = getOwnDataProperty(question, "question_id");
    const prompt = getOwnDataProperty(question, "prompt");
    const recommended = getOwnDataProperty(question, "recommended_answer");
    const alternatives = getOwnDataProperty(question, "alternatives");
    if (
      typeof questionId !== "string" ||
      questionId.length === 0 ||
      typeof prompt !== "string" ||
      prompt.length === 0 ||
      typeof recommended !== "string" ||
      recommended.length === 0
    ) {
      throw new TypeError("Invalid preparation record");
    }
    assertNonEmptyStringArray(alternatives);
    return Object.freeze({
      question_id: questionId,
      prompt,
      recommended_answer: recommended,
      alternatives: Object.freeze([...alternatives]) as
        TaskProductDecisionPacket["request"]["related_questions"][number]["alternatives"],
    });
  });
  return Object.freeze({
    schema_version: 1,
    packet_id: packetId,
    task_id: taskId,
    subject: Object.freeze({ kind: "task" as const }),
    request: Object.freeze({
      kind: "product_decision" as const,
      related_questions: Object.freeze(questions) as
        TaskProductDecisionPacket["request"]["related_questions"],
    }),
    why_automation_cannot_decide: why,
    affected_behavior: affected,
    risk_summary: risk,
    evidence_refs: Object.freeze([...evidence]) as
      TaskProductDecisionPacket["evidence_refs"],
    expires_at: expiresAt,
    required_approver_identity: approver,
  });
}

function serialize(value: object): string {
  return `${JSON.stringify(value, null, 2)}\n`;
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

export class FilePreparationStore {
  readonly #directory: string;

  constructor(directory: string) {
    if (typeof directory !== "string" || directory.length === 0) {
      throw new TypeError("Invalid preparation directory");
    }
    this.#directory = path.resolve(directory);
  }

  async saveIntent(value: Intent): Promise<Intent> {
    const intent = normalizeIntent(value);
    await this.#publishExclusive(
      this.#intentPath(intent.task_id),
      serialize(intent),
    );
    return intent;
  }

  async savePacket(value: TaskProductDecisionPacket): Promise<TaskProductDecisionPacket> {
    const packet = normalizePacket(value);
    await this.#publishExclusive(
      this.#packetPath(packet.task_id),
      serialize(packet),
    );
    return packet;
  }

  async loadIntent(taskId: string): Promise<Intent | null> {
    assertTaskId(taskId);
    return this.#loadJson(this.#intentPath(taskId), normalizeIntent);
  }

  async loadPacket(taskId: string): Promise<TaskProductDecisionPacket | null> {
    assertTaskId(taskId);
    return this.#loadJson(this.#packetPath(taskId), normalizePacket);
  }

  async #publishExclusive(targetPath: string, contents: string): Promise<void> {
    await this.#prepareDirectory();
    const existing = await this.#readFile(targetPath);
    if (existing !== null) {
      if (existing === contents) {
        return;
      }
      throw new Error(`Conflicting preparation record for ${path.basename(targetPath)}`);
    }
    const temporaryPath = path.join(
      this.#directory,
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
      await syncDirectory(this.#directory);
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
          `Conflicting preparation record for ${path.basename(targetPath)}`,
        );
      }
      throw error;
    }
  }

  async #loadJson<Value>(
    recordPath: string,
    normalize: (value: unknown) => Value,
  ): Promise<Value | null> {
    const contents = await this.#readFile(recordPath);
    if (contents === null) {
      return null;
    }
    try {
      return normalize(JSON.parse(contents) as unknown);
    } catch (error) {
      throw new Error(`Corrupt preparation record ${path.basename(recordPath)}`, {
        cause: error,
      });
    }
  }

  async #readFile(recordPath: string): Promise<string | null> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      const pathMetadata = await lstat(recordPath);
      if (!pathMetadata.isFile()) {
        throw new TypeError("Preparation record is not a regular file");
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

  async #prepareDirectory(): Promise<void> {
    await mkdir(this.#directory, { recursive: true, mode: 0o700 });
    const metadata = await lstat(this.#directory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new TypeError("Invalid preparation directory");
    }
    if (process.platform !== "win32") {
      await chmod(this.#directory, 0o700);
    }
  }

  #intentPath(taskId: string): string {
    return path.join(this.#directory, `${taskId}.intent.json`);
  }

  #packetPath(taskId: string): string {
    return path.join(this.#directory, `${taskId}.packet.json`);
  }
}
