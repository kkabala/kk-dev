export type RecordedMetric =
  | Readonly<{ status: "recorded"; value: number }>
  | Readonly<{ status: "unknown" }>;

export type OperationsDecision = Readonly<{
  schema_version: 1;
  retention_keep: boolean;
  audit_accepted: boolean;
  metrics: Readonly<{
    active_human_minutes: RecordedMetric;
    cycle_time_minutes: RecordedMetric;
    flake_rate: RecordedMetric;
    escape_count: RecordedMetric;
    autonomy_rate: RecordedMetric;
  }>;
  kill_switch_engaged: boolean;
  auto_merge_disabled: boolean;
  affected_scope: string;
  agent_direct_merge: false;
  run_complete: false;
}>;

const inputKeys = [
  "retention",
  "audit",
  "metrics",
  "kill_switch",
  "incident",
] as const;
const retentionKeys = ["now", "recorded_at", "retention_days", "body"] as const;
const auditKeys = ["authenticated", "actor", "action"] as const;
const actorKeys = ["kind", "identity"] as const;
const metricsKeys = [
  "active_human_minutes",
  "cycle_time_minutes",
  "flake_rate",
  "escape_count",
  "autonomy_rate",
] as const;
const killSwitchKeys = ["engaged", "actor_kind"] as const;
const incidentKeys = [
  "trust_boundary_failure",
  "severity_1_or_2_escape",
  "affected_scope",
] as const;
const auditActorKinds = new Set<unknown>(["control_plane", "operator"]);
const instantPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const msPerDay = 86_400_000;

function invalidInput(): never {
  throw new TypeError("Invalid operations input");
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

function parseNonNegativeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    invalidInput();
  }
  return value;
}

function parseRate(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
    invalidInput();
  }
  return value;
}

function parseInstant(value: unknown): number {
  const text = parseRequiredString(value);
  if (!instantPattern.test(text)) {
    invalidInput();
  }
  const ms = Date.parse(text);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== text) {
    invalidInput();
  }
  return ms;
}

function parseOptionalCount(value: unknown): number | null {
  if (value === null) {
    return null;
  }
  return parseNonNegativeInteger(value);
}

function parseOptionalRate(value: unknown): number | null {
  if (value === null) {
    return null;
  }
  return parseRate(value);
}

function recorded(value: number | null): RecordedMetric {
  if (value === null) {
    return Object.freeze({ status: "unknown" });
  }
  return Object.freeze({ status: "recorded", value });
}

function parseRetention(value: unknown): { keep: boolean } {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, retentionKeys);
  parseRequiredString(getOwnDataProperty(value, "body"));
  const now = parseInstant(getOwnDataProperty(value, "now"));
  const recordedAt = parseInstant(getOwnDataProperty(value, "recorded_at"));
  const retentionDays = parseNonNegativeInteger(
    getOwnDataProperty(value, "retention_days"),
  );
  if (now < recordedAt) {
    invalidInput();
  }
  return Object.freeze({
    keep: now - recordedAt <= retentionDays * msPerDay,
  });
}

function parseAudit(value: unknown): { accepted: boolean } {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, auditKeys);
  if (getOwnDataProperty(value, "authenticated") !== true) {
    invalidInput();
  }
  const actor = getOwnDataProperty(value, "actor");
  if (!isPlainObject(actor)) {
    invalidInput();
  }
  assertExactKeys(actor, actorKeys);
  const kind = getOwnDataProperty(actor, "kind");
  if (!auditActorKinds.has(kind)) {
    invalidInput();
  }
  parseRequiredString(getOwnDataProperty(actor, "identity"));
  const action = getOwnDataProperty(value, "action");
  if (action !== "append" && action !== "rewrite") {
    invalidInput();
  }
  return Object.freeze({ accepted: action === "append" });
}

function parseMetrics(value: unknown): OperationsDecision["metrics"] {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, metricsKeys);
  return Object.freeze({
    active_human_minutes: recorded(
      parseOptionalCount(getOwnDataProperty(value, "active_human_minutes")),
    ),
    cycle_time_minutes: recorded(
      parseOptionalCount(getOwnDataProperty(value, "cycle_time_minutes")),
    ),
    flake_rate: recorded(parseOptionalRate(getOwnDataProperty(value, "flake_rate"))),
    escape_count: recorded(
      parseOptionalCount(getOwnDataProperty(value, "escape_count")),
    ),
    autonomy_rate: recorded(
      parseOptionalRate(getOwnDataProperty(value, "autonomy_rate")),
    ),
  });
}

function parseKillSwitch(value: unknown): boolean {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, killSwitchKeys);
  const engaged = parseBoolean(getOwnDataProperty(value, "engaged"));
  const actorKind = getOwnDataProperty(value, "actor_kind");
  if (actorKind !== "operator" && actorKind !== "agent") {
    invalidInput();
  }
  if (engaged && actorKind !== "operator") {
    invalidInput();
  }
  return engaged;
}

function parseIncident(value: unknown): {
  trust_boundary_failure: boolean;
  severity_1_or_2_escape: boolean;
  affected_scope: string;
} {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, incidentKeys);
  return Object.freeze({
    trust_boundary_failure: parseBoolean(
      getOwnDataProperty(value, "trust_boundary_failure"),
    ),
    severity_1_or_2_escape: parseBoolean(
      getOwnDataProperty(value, "severity_1_or_2_escape"),
    ),
    affected_scope: parseRequiredString(getOwnDataProperty(value, "affected_scope")),
  });
}

export function evaluateOperations(value: unknown): OperationsDecision {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, inputKeys);
  const retention = parseRetention(getOwnDataProperty(value, "retention"));
  const audit = parseAudit(getOwnDataProperty(value, "audit"));
  const metrics = parseMetrics(getOwnDataProperty(value, "metrics"));
  const killSwitchEngaged = parseKillSwitch(getOwnDataProperty(value, "kill_switch"));
  const incident = parseIncident(getOwnDataProperty(value, "incident"));
  return Object.freeze({
    schema_version: 1,
    retention_keep: retention.keep,
    audit_accepted: audit.accepted,
    metrics,
    kill_switch_engaged: killSwitchEngaged,
    auto_merge_disabled:
      killSwitchEngaged ||
      incident.trust_boundary_failure ||
      incident.severity_1_or_2_escape,
    affected_scope: incident.affected_scope,
    agent_direct_merge: false,
    run_complete: false,
  });
}
