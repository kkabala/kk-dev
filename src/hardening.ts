import path from "node:path";

import { parseSha256Digest } from "./domain.ts";
import type { Sha256Digest } from "./domain.ts";
import { redactText } from "./protected-runner.ts";
import { PATH_CATEGORIES, RISK_TIERS } from "./surfaces.ts";
import type { PathCategory, RiskTier } from "./surfaces.ts";

export type ScopeDecision =
  | "automatic"
  | "rederive"
  | "provisional_r2"
  | "needs_approval";

export type HardeningDecision = Readonly<{
  schema_version: 1;
  base_judges_candidate: boolean;
  accepted: boolean;
  scope_decision: ScopeDecision;
  scope_tier: RiskTier | null;
  material: Readonly<{
    parameters: string;
    output: string;
    observation: string;
  }>;
  artifact_accepted: boolean;
  artifact_stored: Readonly<{ path: string }> | null;
  run_complete: false;
}>;

const inputKeys = [
  "trust",
  "scope",
  "secrets",
  "material",
  "artifact",
  "artifact_policy",
] as const;
const trustKeys = [
  "base_digest",
  "judging_digest",
  "candidate_digest",
  "changed_trust_boundary",
] as const;
const scopeKeys = [
  "requested_path",
  "affected_surface_paths",
  "known_surface_paths",
  "category",
  "trust_boundary",
] as const;
const materialKeys = ["parameters", "output", "observation"] as const;
const artifactKeys = ["relative_path", "bytes", "symlink_target"] as const;
const policyKeys = ["allowlist", "max_artifact_bytes", "sandbox_root"] as const;
const knownCategories = new Set<unknown>(Object.values(PATH_CATEGORIES));

function invalidInput(): never {
  throw new TypeError("Invalid hardening input");
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

function parseOptionalString(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  return parseRequiredString(value);
}

function parseDigest(value: unknown): Sha256Digest {
  if (typeof value !== "string") {
    invalidInput();
  }
  try {
    return parseSha256Digest(value);
  } catch {
    invalidInput();
  }
}

function parseStringList(value: unknown): readonly string[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    invalidInput();
  }
  const captured: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      invalidInput();
    }
    captured.push(parseRequiredString(value[index]));
  }
  return Object.freeze(captured);
}

function parseNonNegativeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    invalidInput();
  }
  return value;
}

function posixPath(value: string): string {
  return value.replaceAll("\\", "/");
}

function isInsideRoot(root: string, candidate: string): boolean {
  const resolvedRoot = path.posix.resolve(posixPath(root));
  const resolvedCandidate = path.posix.resolve(posixPath(candidate));
  return (
    resolvedCandidate === resolvedRoot ||
    resolvedCandidate.startsWith(`${resolvedRoot}/`)
  );
}

function symlinkEscapesRoot(
  sandboxRoot: string,
  relativePath: string,
  symlinkTarget: string,
): boolean {
  const resolved = path.posix.resolve(
    posixPath(sandboxRoot),
    path.posix.dirname(relativePath),
    posixPath(symlinkTarget),
  );
  return !isInsideRoot(sandboxRoot, resolved);
}

function matchesGlob(pattern: string, relativePath: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/gu, "\\$&");
  const regexSource = escaped
    .replaceAll("**", "\0")
    .replaceAll("*", "[^/]*")
    .replaceAll("\0", ".*");
  return new RegExp(`^${regexSource}$`, "u").test(relativePath);
}

function matchesAny(patterns: readonly string[], relativePath: string): boolean {
  for (let index = 0; index < patterns.length; index += 1) {
    const pattern = patterns[index];
    if (pattern !== undefined && matchesGlob(pattern, relativePath)) {
      return true;
    }
  }
  return false;
}

function pathEscapes(relativePath: string): boolean {
  if (
    relativePath.startsWith("/") ||
    relativePath.includes("\\") ||
    relativePath.includes("\0")
  ) {
    return true;
  }
  const segments = relativePath.split("/");
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment === undefined || segment.length === 0 || segment === "..") {
      return true;
    }
  }
  return false;
}

function parseTrust(value: unknown): {
  base_digest: Sha256Digest;
  judging_digest: Sha256Digest;
  candidate_digest: Sha256Digest;
  changed_trust_boundary: boolean;
} {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, trustKeys);
  return Object.freeze({
    base_digest: parseDigest(getOwnDataProperty(value, "base_digest")),
    judging_digest: parseDigest(getOwnDataProperty(value, "judging_digest")),
    candidate_digest: parseDigest(getOwnDataProperty(value, "candidate_digest")),
    changed_trust_boundary: parseBoolean(
      getOwnDataProperty(value, "changed_trust_boundary"),
    ),
  });
}

function parseScope(value: unknown): {
  requested_path: string;
  affected_surface_paths: readonly string[];
  known_surface_paths: readonly string[];
  category: PathCategory;
  trust_boundary: boolean;
} {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, scopeKeys);
  const category = getOwnDataProperty(value, "category");
  if (!knownCategories.has(category)) {
    invalidInput();
  }
  return Object.freeze({
    requested_path: parseRequiredString(getOwnDataProperty(value, "requested_path")),
    affected_surface_paths: parseStringList(
      getOwnDataProperty(value, "affected_surface_paths"),
    ),
    known_surface_paths: parseStringList(
      getOwnDataProperty(value, "known_surface_paths"),
    ),
    category: category as PathCategory,
    trust_boundary: parseBoolean(getOwnDataProperty(value, "trust_boundary")),
  });
}

function parseMaterial(value: unknown): {
  parameters: string;
  output: string;
  observation: string;
} {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, materialKeys);
  return Object.freeze({
    parameters: parseRequiredString(getOwnDataProperty(value, "parameters")),
    output: parseRequiredString(getOwnDataProperty(value, "output")),
    observation: parseRequiredString(getOwnDataProperty(value, "observation")),
  });
}

function parseArtifact(value: unknown): {
  relative_path: string;
  bytes: string;
  symlink_target: string | null;
} | null {
  if (value === null) {
    return null;
  }
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, artifactKeys);
  return Object.freeze({
    relative_path: parseRequiredString(getOwnDataProperty(value, "relative_path")),
    bytes: parseRequiredString(getOwnDataProperty(value, "bytes")),
    symlink_target: parseOptionalString(getOwnDataProperty(value, "symlink_target")),
  });
}

function parsePolicy(value: unknown): {
  allowlist: readonly string[];
  max_artifact_bytes: number;
  sandbox_root: string;
} {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, policyKeys);
  return Object.freeze({
    allowlist: parseStringList(getOwnDataProperty(value, "allowlist")),
    max_artifact_bytes: parseNonNegativeInteger(
      getOwnDataProperty(value, "max_artifact_bytes"),
    ),
    sandbox_root: parseRequiredString(getOwnDataProperty(value, "sandbox_root")),
  });
}

function decideScope(scope: {
  requested_path: string;
  affected_surface_paths: readonly string[];
  known_surface_paths: readonly string[];
  category: PathCategory;
  trust_boundary: boolean;
}): { decision: ScopeDecision; tier: RiskTier | null } {
  if (scope.trust_boundary) {
    return { decision: "needs_approval", tier: RISK_TIERS.R3 };
  }
  if (matchesAny(scope.affected_surface_paths, scope.requested_path)) {
    return { decision: "automatic", tier: null };
  }
  if (matchesAny(scope.known_surface_paths, scope.requested_path)) {
    return { decision: "rederive", tier: null };
  }
  if (scope.category === PATH_CATEGORIES.PRODUCTION) {
    return { decision: "provisional_r2", tier: RISK_TIERS.R2 };
  }
  invalidInput();
}

export function evaluateHardening(value: unknown): HardeningDecision {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, inputKeys);
  const trust = parseTrust(getOwnDataProperty(value, "trust"));
  const scope = parseScope(getOwnDataProperty(value, "scope"));
  const secrets = parseStringList(getOwnDataProperty(value, "secrets"));
  const material = parseMaterial(getOwnDataProperty(value, "material"));
  const artifact = parseArtifact(getOwnDataProperty(value, "artifact"));
  const policy = parsePolicy(getOwnDataProperty(value, "artifact_policy"));
  const baseJudges =
    !trust.changed_trust_boundary || trust.judging_digest === trust.base_digest;
  const selfApproving =
    trust.changed_trust_boundary &&
    trust.judging_digest === trust.candidate_digest &&
    trust.candidate_digest !== trust.base_digest;
  const scoped = decideScope(scope);
  const redacted = Object.freeze({
    parameters: redactText(material.parameters, secrets),
    output: redactText(material.output, secrets),
    observation: redactText(material.observation, secrets),
  });
  let artifactAccepted = true;
  let artifactStored: HardeningDecision["artifact_stored"] = null;
  if (artifact !== null) {
    const size = Buffer.byteLength(artifact.bytes, "utf8");
    const rejected =
      pathEscapes(artifact.relative_path) ||
      size > policy.max_artifact_bytes ||
      !matchesAny(policy.allowlist, artifact.relative_path) ||
      (artifact.symlink_target !== null &&
        symlinkEscapesRoot(
          policy.sandbox_root,
          artifact.relative_path,
          artifact.symlink_target,
        ));
    if (rejected) {
      artifactAccepted = false;
    } else {
      artifactStored = Object.freeze({ path: artifact.relative_path });
    }
  }
  return Object.freeze({
    schema_version: 1,
    base_judges_candidate: baseJudges && !selfApproving,
    accepted: baseJudges && !selfApproving,
    scope_decision: scoped.decision,
    scope_tier: scoped.tier,
    material: redacted,
    artifact_accepted: artifactAccepted,
    artifact_stored: artifactStored,
    run_complete: false,
  });
}
