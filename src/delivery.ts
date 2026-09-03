import { GATE_RESULTS } from "./run-state.ts";

export type DeliveryActor = Readonly<{
  kind: "release_observer";
  identity: string;
}>;

export type DeliveryTarget = Readonly<{
  environment: string;
  route: string;
  deployed_sha: string;
  healthy: boolean;
}>;

export type DeliveryObservation = Readonly<{
  schema_version: 1;
  authenticated: true;
  actor: DeliveryActor;
  expected_sha: string;
  expected_environment: string | null;
  expected_route: string | null;
  target: DeliveryTarget | null;
  deployed_sha: string | null;
  g8_result:
    | typeof GATE_RESULTS.PASS
    | typeof GATE_RESULTS.FAIL
    | typeof GATE_RESULTS.NOT_APPLICABLE;
  run_complete: false;
}>;

const inputKeys = [
  "authenticated",
  "actor",
  "expected_sha",
  "expected_environment",
  "expected_route",
  "target",
] as const;
const actorKeys = ["kind", "identity"] as const;
const targetKeys = ["environment", "route", "deployed_sha", "healthy"] as const;

function invalidInput(): never {
  throw new TypeError("Invalid delivery observation input");
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

function parseActor(value: unknown): DeliveryActor {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, actorKeys);
  if (getOwnDataProperty(value, "kind") !== "release_observer") {
    invalidInput();
  }
  return Object.freeze({
    kind: "release_observer",
    identity: parseRequiredString(getOwnDataProperty(value, "identity")),
  });
}

function parseTarget(value: unknown): DeliveryTarget | null {
  if (value === null) {
    return null;
  }
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, targetKeys);
  return Object.freeze({
    environment: parseRequiredString(getOwnDataProperty(value, "environment")),
    route: parseRequiredString(getOwnDataProperty(value, "route")),
    deployed_sha: parseRequiredString(getOwnDataProperty(value, "deployed_sha")),
    healthy: parseBoolean(getOwnDataProperty(value, "healthy")),
  });
}

function g8Result(
  expectedSha: string,
  expectedEnvironment: string | null,
  expectedRoute: string | null,
  target: DeliveryTarget | null,
): DeliveryObservation["g8_result"] {
  if (target === null) {
    if (expectedEnvironment !== null || expectedRoute !== null) {
      invalidInput();
    }
    return GATE_RESULTS.NOT_APPLICABLE;
  }
  if (expectedEnvironment === null || expectedRoute === null) {
    invalidInput();
  }
  if (
    target.deployed_sha !== expectedSha ||
    target.environment !== expectedEnvironment ||
    target.route !== expectedRoute ||
    !target.healthy
  ) {
    return GATE_RESULTS.FAIL;
  }
  return GATE_RESULTS.PASS;
}

export function observeDelivery(value: unknown): DeliveryObservation {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, inputKeys);
  if (getOwnDataProperty(value, "authenticated") !== true) {
    invalidInput();
  }
  const expectedSha = parseRequiredString(getOwnDataProperty(value, "expected_sha"));
  const expectedEnvironment = parseOptionalString(
    getOwnDataProperty(value, "expected_environment"),
  );
  const expectedRoute = parseOptionalString(getOwnDataProperty(value, "expected_route"));
  const target = parseTarget(getOwnDataProperty(value, "target"));
  const result = g8Result(expectedSha, expectedEnvironment, expectedRoute, target);
  return Object.freeze({
    schema_version: 1,
    authenticated: true,
    actor: parseActor(getOwnDataProperty(value, "actor")),
    expected_sha: expectedSha,
    expected_environment: expectedEnvironment,
    expected_route: expectedRoute,
    target,
    deployed_sha: target === null ? null : target.deployed_sha,
    g8_result: result,
    run_complete: false,
  });
}
