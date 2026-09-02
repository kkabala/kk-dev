import { RISK_TIERS } from "./surfaces.ts";
import type { RiskTier } from "./surfaces.ts";

export type AgentIdentities = Readonly<{
  acceptance_author: string;
  independent_verifier: string;
  implementer: string;
}>;

export type HarnessProposal = Readonly<{
  source: "independent_verifier" | "implementer" | "acceptance_author";
  measured_by_protected_runner: boolean;
  harness_accepted: boolean;
}>;

export type VerificationBoundaries = Readonly<{
  schema_version: 1;
  acceptance_author: Readonly<{
    dispatched: boolean;
    identity: string | null;
    writable_paths: readonly string[];
  }>;
  independent_verifier: Readonly<{
    dispatched: boolean;
    identity: string | null;
    findings_authoritative: boolean;
  }>;
  implementer: Readonly<{
    identity: string;
    may_relock_oracle: boolean;
  }>;
}>;

const inputKeys = [
  "task_id",
  "g2_required",
  "independent_verifier_required",
  "behavior_preserving",
  "new_acceptance_claim",
  "overall",
  "identities",
  "author_writable_allowlist",
  "author_proposed_paths",
  "harness_proposal",
] as const;
const identityKeys = [
  "acceptance_author",
  "independent_verifier",
  "implementer",
] as const;
const proposalKeys = [
  "source",
  "measured_by_protected_runner",
  "harness_accepted",
] as const;
const knownProposalSources = new Set([
  "independent_verifier",
  "implementer",
  "acceptance_author",
]);
const knownRiskTiers = new Set<unknown>(Object.values(RISK_TIERS));
const riskRank: Readonly<Record<string, number>> = Object.freeze({
  [RISK_TIERS.R0]: 0,
  [RISK_TIERS.R1]: 1,
  [RISK_TIERS.R2]: 2,
  [RISK_TIERS.R3]: 3,
});
const idPattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u;

function invalidInput(): never {
  throw new TypeError("Invalid verification input");
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

function captureDenseList<Item>(
  value: unknown,
  readItem: (item: unknown) => Item,
): Item[] {
  if (!Array.isArray(value)) {
    invalidInput();
  }
  const length = getOwnDataProperty(value, "length");
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) {
    invalidInput();
  }
  const captured: Item[] = [];
  for (let index = 0; index < length; index += 1) {
    captured[index] = readItem(getOwnDataProperty(value, index));
  }
  return captured;
}

function parseRequiredString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    invalidInput();
  }
  return value;
}

function parseId(value: unknown): string {
  if (typeof value !== "string" || !idPattern.test(value)) {
    invalidInput();
  }
  return value;
}

function parseBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") {
    invalidInput();
  }
  return value;
}

function parseRiskTier(value: unknown): RiskTier {
  if (!knownRiskTiers.has(value)) {
    invalidInput();
  }
  return value as RiskTier;
}

function parseRelativePath(value: unknown): string {
  const token = parseRequiredString(value);
  if (token.startsWith("/") || token.includes("\\")) {
    invalidInput();
  }
  const segments = token.split("/");
  if (
    segments.length === 0 ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    invalidInput();
  }
  return token;
}

function parseGlobPattern(value: unknown): string {
  const token = parseRequiredString(value);
  if (token.startsWith("/") || token.includes("\\")) {
    invalidInput();
  }
  const segments = token.split("/");
  if (
    segments.length === 0 ||
    segments.some(
      (segment) =>
        segment === "" ||
        segment === "." ||
        segment === ".." ||
        (segment.includes("**") && segment !== "**"),
    )
  ) {
    invalidInput();
  }
  return token;
}

function globToRegExp(pattern: string): RegExp {
  const body = pattern
    .split("/")
    .map((segment) => {
      if (segment === "**") {
        return ".*";
      }
      return segment
        .replace(/[.+^${}()|[\]\\]/gu, "\\$&")
        .replace(/\*/gu, "[^/]*");
    })
    .join("/");
  return new RegExp(`^${body}$`, "u");
}

function matchesGlob(pattern: string, filePath: string): boolean {
  return globToRegExp(pattern).test(filePath);
}

function parseStringList(
  value: unknown,
  readItem: (item: unknown) => string,
): readonly string[] {
  const captured = captureDenseList(value, readItem);
  const seen = new Set<string>();
  for (let index = 0; index < captured.length; index += 1) {
    const item = captured[index];
    if (item === undefined || seen.has(item)) {
      invalidInput();
    }
    seen.add(item);
  }
  return Object.freeze(captured);
}

function parseIdentities(value: unknown): AgentIdentities {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, identityKeys);
  return Object.freeze({
    acceptance_author: parseId(getOwnDataProperty(value, "acceptance_author")),
    independent_verifier: parseId(getOwnDataProperty(value, "independent_verifier")),
    implementer: parseId(getOwnDataProperty(value, "implementer")),
  });
}

function parseHarnessProposal(value: unknown): HarnessProposal | null {
  if (value === null) {
    return null;
  }
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, proposalKeys);
  const source = getOwnDataProperty(value, "source");
  if (typeof source !== "string" || !knownProposalSources.has(source)) {
    invalidInput();
  }
  return Object.freeze({
    source: source as HarnessProposal["source"],
    measured_by_protected_runner: parseBoolean(
      getOwnDataProperty(value, "measured_by_protected_runner"),
    ),
    harness_accepted: parseBoolean(getOwnDataProperty(value, "harness_accepted")),
  });
}

function isElevated(tier: RiskTier): boolean {
  return (riskRank[tier] ?? 0) >= 2;
}

function pathAllowed(filePath: string, allowlist: readonly string[]): boolean {
  for (let index = 0; index < allowlist.length; index += 1) {
    const pattern = allowlist[index];
    if (pattern !== undefined && matchesGlob(pattern, filePath)) {
      return true;
    }
  }
  return false;
}

export function resolveVerificationBoundaries(value: unknown): VerificationBoundaries {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, inputKeys);
  parseRequiredString(getOwnDataProperty(value, "task_id"));
  const g2Required = parseBoolean(getOwnDataProperty(value, "g2_required"));
  const verifierRequired = parseBoolean(
    getOwnDataProperty(value, "independent_verifier_required"),
  );
  const behaviorPreserving = parseBoolean(
    getOwnDataProperty(value, "behavior_preserving"),
  );
  const newAcceptanceClaim = parseBoolean(
    getOwnDataProperty(value, "new_acceptance_claim"),
  );
  const overall = parseRiskTier(getOwnDataProperty(value, "overall"));
  const identities = parseIdentities(getOwnDataProperty(value, "identities"));
  const allowlist = parseStringList(
    getOwnDataProperty(value, "author_writable_allowlist"),
    parseGlobPattern,
  );
  const proposed = parseStringList(
    getOwnDataProperty(value, "author_proposed_paths"),
    parseRelativePath,
  );
  const proposal = parseHarnessProposal(getOwnDataProperty(value, "harness_proposal"));

  const skipAuthor =
    !newAcceptanceClaim && (overall === RISK_TIERS.R0 || behaviorPreserving);
  const dispatchAuthor = g2Required && !skipAuthor;
  const dispatchVerifier = isElevated(overall);
  if (verifierRequired !== dispatchVerifier) {
    invalidInput();
  }

  if (dispatchAuthor && identities.acceptance_author === identities.implementer) {
    invalidInput();
  }
  if (dispatchVerifier && identities.independent_verifier === identities.implementer) {
    invalidInput();
  }
  if (
    dispatchAuthor &&
    dispatchVerifier &&
    identities.acceptance_author === identities.independent_verifier
  ) {
    invalidInput();
  }
  if (!dispatchAuthor && proposed.length > 0) {
    invalidInput();
  }
  if (dispatchAuthor) {
    for (let index = 0; index < proposed.length; index += 1) {
      const filePath = proposed[index];
      if (filePath === undefined || !pathAllowed(filePath, allowlist)) {
        invalidInput();
      }
    }
  }
  if (!dispatchVerifier && proposal !== null) {
    invalidInput();
  }

  const findingsAuthoritative =
    dispatchVerifier &&
    proposal !== null &&
    proposal.source === "independent_verifier" &&
    proposal.measured_by_protected_runner &&
    proposal.harness_accepted;

  return Object.freeze({
    schema_version: 1,
    acceptance_author: Object.freeze({
      dispatched: dispatchAuthor,
      identity: dispatchAuthor ? identities.acceptance_author : null,
      writable_paths: dispatchAuthor ? allowlist : Object.freeze([]),
    }),
    independent_verifier: Object.freeze({
      dispatched: dispatchVerifier,
      identity: dispatchVerifier ? identities.independent_verifier : null,
      findings_authoritative: findingsAuthoritative,
    }),
    implementer: Object.freeze({
      identity: identities.implementer,
      may_relock_oracle: !isElevated(overall),
    }),
  });
}
