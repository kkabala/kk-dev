import { RISK_TIERS } from "./surfaces.ts";
import type { RiskTier } from "./surfaces.ts";
import { MERGE_MODES } from "./run-state.ts";
import type { MergeMode } from "./run-state.ts";

export type AutoMergeAction = "enable_github_auto_merge" | "require_human_merge";

export type AutoMergeDecision = Readonly<{
  schema_version: 1;
  mode: MergeMode;
  action: AutoMergeAction;
  agent_direct_merge: false;
  run_complete: false;
}>;

const inputKeys = ["risk_tier", "has_live_exception", "history", "demotion"] as const;
const historyKeys = [
  "eligible_merge_count",
  "window_days",
  "severity_1_or_2_escape",
  "replayed_lower_escape_count",
  "p90_human_time_minutes",
  "flake_rate",
] as const;
const demotionKeys = [
  "trust_boundary_failure",
  "severity_1_or_2_escape",
  "unreplayed_escape_count_30d",
  "flake_rate_30d",
] as const;
const knownTiers = new Set<unknown>(Object.values(RISK_TIERS));

type History = Readonly<{
  eligible_merge_count: number;
  window_days: number;
  severity_1_or_2_escape: boolean;
  replayed_lower_escape_count: number;
  p90_human_time_minutes: number;
  flake_rate: number;
}>;

type Demotion = Readonly<{
  trust_boundary_failure: boolean;
  severity_1_or_2_escape: boolean;
  unreplayed_escape_count_30d: number;
  flake_rate_30d: number;
}>;

function invalidInput(): never {
  throw new TypeError("Invalid auto-merge input");
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

function parseHistory(value: unknown): History {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, historyKeys);
  return Object.freeze({
    eligible_merge_count: parseNonNegativeInteger(
      getOwnDataProperty(value, "eligible_merge_count"),
    ),
    window_days: parseNonNegativeInteger(getOwnDataProperty(value, "window_days")),
    severity_1_or_2_escape: parseBoolean(
      getOwnDataProperty(value, "severity_1_or_2_escape"),
    ),
    replayed_lower_escape_count: parseNonNegativeInteger(
      getOwnDataProperty(value, "replayed_lower_escape_count"),
    ),
    p90_human_time_minutes: parseNonNegativeInteger(
      getOwnDataProperty(value, "p90_human_time_minutes"),
    ),
    flake_rate: parseRate(getOwnDataProperty(value, "flake_rate")),
  });
}

function parseDemotion(value: unknown): Demotion {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, demotionKeys);
  return Object.freeze({
    trust_boundary_failure: parseBoolean(
      getOwnDataProperty(value, "trust_boundary_failure"),
    ),
    severity_1_or_2_escape: parseBoolean(
      getOwnDataProperty(value, "severity_1_or_2_escape"),
    ),
    unreplayed_escape_count_30d: parseNonNegativeInteger(
      getOwnDataProperty(value, "unreplayed_escape_count_30d"),
    ),
    flake_rate_30d: parseRate(getOwnDataProperty(value, "flake_rate_30d")),
  });
}

function demoted(demotion: Demotion): boolean {
  return (
    demotion.trust_boundary_failure ||
    demotion.severity_1_or_2_escape ||
    demotion.unreplayed_escape_count_30d >= 2 ||
    demotion.flake_rate_30d > 15
  );
}

function eligibleForTier(tier: RiskTier, history: History): boolean {
  if (history.severity_1_or_2_escape || history.flake_rate > 5) {
    return false;
  }
  if (tier === RISK_TIERS.R0) {
    return (
      history.eligible_merge_count >= 20 &&
      history.window_days >= 14 &&
      history.replayed_lower_escape_count === 0 &&
      history.p90_human_time_minutes <= 2
    );
  }
  if (tier === RISK_TIERS.R1) {
    return (
      history.eligible_merge_count >= 30 &&
      history.window_days >= 21 &&
      history.replayed_lower_escape_count <= 1 &&
      history.p90_human_time_minutes <= 5
    );
  }
  return false;
}

export function evaluateAutoMerge(value: unknown): AutoMergeDecision {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, inputKeys);
  const riskTier = getOwnDataProperty(value, "risk_tier");
  if (!knownTiers.has(riskTier)) {
    invalidInput();
  }
  const hasLiveException = parseBoolean(
    getOwnDataProperty(value, "has_live_exception"),
  );
  const history = parseHistory(getOwnDataProperty(value, "history"));
  const demotionSignals = parseDemotion(getOwnDataProperty(value, "demotion"));
  const promote =
    !hasLiveException &&
    !demoted(demotionSignals) &&
    eligibleForTier(riskTier as RiskTier, history);
  if (promote) {
    return Object.freeze({
      schema_version: 1,
      mode: MERGE_MODES.GITHUB_AUTO_MERGE,
      action: "enable_github_auto_merge",
      agent_direct_merge: false,
      run_complete: false,
    });
  }
  return Object.freeze({
    schema_version: 1,
    mode: MERGE_MODES.HUMAN_MERGE,
    action: "require_human_merge",
    agent_direct_merge: false,
    run_complete: false,
  });
}
