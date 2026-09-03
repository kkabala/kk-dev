export const DOCUMENTED_COMMANDS: readonly string[] = Object.freeze([
  "exoframe run <task text>",
  "exoframe status [task-id]",
  "exoframe explain [task-id]",
  "exoframe resume <task-id>",
  "exoframe evidence show <gate-id>",
  "exoframe gate run --task <task-id> --gate <gate-id>",
  "exoframe surfaces explain <path>",
  "exoframe policy check",
]);

export type AuditDecision = Readonly<{
  schema_version: 1;
  documentation_ok: boolean;
  pstack_unmodified: boolean;
  adapter_only: boolean;
  agent_cannot_pass_or_merge: boolean;
  recovery_ok: boolean;
  audit_complete: boolean;
  run_complete: false;
}>;

const inputKeys = ["documentation", "security", "recovery"] as const;
const documentationKeys = ["readme", "help_text"] as const;
const securityKeys = [
  "pstack_modified",
  "adapter_only",
  "candidate_authoritative",
  "agent_direct_merge",
] as const;
const recoveryKeys = ["restart_preserves_run", "dead_lock_recovered"] as const;

function invalidInput(): never {
  throw new TypeError("Invalid audit input");
}

function getOwnDataProperty(object: object, key: PropertyKey): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (descriptor === undefined || !("value" in descriptor)) {
    invalidInput();
  }
  return descriptor.value;
}

function ownKeyNames(value: object): string[] {
  return Reflect.ownKeys(value).map((key) => {
    if (typeof key !== "string") {
      invalidInput();
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
    invalidInput();
  }
}

function parseBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") {
    invalidInput();
  }
  return value;
}

function parseRequiredString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    invalidInput();
  }
  return value;
}

function documentsCommands(text: string): boolean {
  for (let index = 0; index < DOCUMENTED_COMMANDS.length; index += 1) {
    const command = DOCUMENTED_COMMANDS[index];
    if (command === undefined || !text.includes(command)) {
      return false;
    }
  }
  return true;
}

function parseDocumentation(value: unknown): boolean {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, documentationKeys);
  const readme = parseRequiredString(getOwnDataProperty(value, "readme"));
  const helpText = parseRequiredString(getOwnDataProperty(value, "help_text"));
  return documentsCommands(readme) && documentsCommands(helpText);
}

function parseSecurity(value: unknown): {
  pstack_unmodified: boolean;
  adapter_only: boolean;
  agent_cannot_pass_or_merge: boolean;
} {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, securityKeys);
  const pstackModified = parseBoolean(getOwnDataProperty(value, "pstack_modified"));
  const adapterOnly = parseBoolean(getOwnDataProperty(value, "adapter_only"));
  const candidateAuthoritative = parseBoolean(
    getOwnDataProperty(value, "candidate_authoritative"),
  );
  const agentDirectMerge = parseBoolean(
    getOwnDataProperty(value, "agent_direct_merge"),
  );
  return Object.freeze({
    pstack_unmodified: !pstackModified,
    adapter_only: adapterOnly,
    agent_cannot_pass_or_merge: !candidateAuthoritative && !agentDirectMerge,
  });
}

function parseRecovery(value: unknown): boolean {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, recoveryKeys);
  return (
    parseBoolean(getOwnDataProperty(value, "restart_preserves_run")) &&
    parseBoolean(getOwnDataProperty(value, "dead_lock_recovered"))
  );
}

export function evaluateAudit(value: unknown): AuditDecision {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, inputKeys);
  const documentationOk = parseDocumentation(
    getOwnDataProperty(value, "documentation"),
  );
  const security = parseSecurity(getOwnDataProperty(value, "security"));
  const recoveryOk = parseRecovery(getOwnDataProperty(value, "recovery"));
  const auditComplete =
    documentationOk &&
    security.pstack_unmodified &&
    security.adapter_only &&
    security.agent_cannot_pass_or_merge &&
    recoveryOk;
  return Object.freeze({
    schema_version: 1,
    documentation_ok: documentationOk,
    pstack_unmodified: security.pstack_unmodified,
    adapter_only: security.adapter_only,
    agent_cannot_pass_or_merge: security.agent_cannot_pass_or_merge,
    recovery_ok: recoveryOk,
    audit_complete: auditComplete,
    run_complete: false,
  });
}
