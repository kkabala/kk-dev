import type { NonEmptyReadonlyArray } from "./domain.ts";

declare const gateClassBrand: unique symbol;

type BrandedGateClass<Value extends string> = Value &
  Readonly<{
    [gateClassBrand]: "GateClass";
  }>;

const GATE_CLASS_VALUES = {
  G0: "G0",
  G1: "G1",
  G2: "G2",
  G3: "G3",
  G4: "G4",
  G5: "G5",
  G6: "G6",
  G7: "G7",
  G8: "G8",
  G9: "G9",
} as const;

type GateClassCatalog = {
  readonly [Name in keyof typeof GATE_CLASS_VALUES]: BrandedGateClass<
    (typeof GATE_CLASS_VALUES)[Name]
  >;
};

export const GATE_CLASSES = Object.freeze(GATE_CLASS_VALUES) as GateClassCatalog;

export type GateClass = (typeof GATE_CLASSES)[keyof typeof GATE_CLASSES];

const knownGateClasses = new Set<unknown>(Object.values(GATE_CLASSES));

export type GateCommand = Readonly<{
  argv: NonEmptyReadonlyArray<string>;
  authoritative?: never;
  cmd?: never;
  command?: never;
  command_text?: never;
  raw?: never;
  script?: never;
  shell?: never;
  stdin?: never;
}>;

export type GateTemplate = Readonly<{
  schema_version: 1;
  id: string;
  gate_class: GateClass;
  command: GateCommand;
  timeout_seconds: number;
  network: "none";
  writable_roots: readonly string[];
  result_schema: string;
  artifact_allowlist: readonly string[];
}>;

export type GateTemplateCatalog = Readonly<{
  schema_version: 1;
  templates: readonly GateTemplate[];
}>;

export type ProtectedTemplateRequest = Readonly<{
  gate_id: string;
  argv?: never;
  authoritative?: never;
  cmd?: never;
  command?: never;
  command_text?: never;
  raw?: never;
  script?: never;
  shell?: never;
}>;

export type ResolvedProtectedCommand = Readonly<{
  gate_id: string;
  template: GateTemplate;
  argv: NonEmptyReadonlyArray<string>;
}>;

const authenticCommands = new WeakSet<object>();

const templateKeys = [
  "schema_version",
  "id",
  "gate_class",
  "command",
  "timeout_seconds",
  "network",
  "writable_roots",
  "result_schema",
  "artifact_allowlist",
] as const;

const catalogKeys = ["schema_version", "templates"] as const;
const commandKeys = ["argv"] as const;
const requestKeys = ["gate_id"] as const;

const rawCommandKeys = new Set([
  "argv",
  "authoritative",
  "cmd",
  "command",
  "command_text",
  "raw",
  "script",
  "shell",
  "stdin",
]);

const rawCommandArrayKeys = new Set([
  "cmd",
  "command",
  "command_text",
  "raw",
  "script",
  "shell",
]);

const shellInterpreters = new Set([
  "bash",
  "bash.exe",
  "cmd",
  "cmd.exe",
  "csh",
  "dash",
  "fish",
  "ksh",
  "powershell",
  "powershell.exe",
  "pwsh",
  "pwsh.exe",
  "sh",
  "tcsh",
  "zsh",
]);

const templateIdPattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u;
const rawCommandTextPattern = /[$`\n\r;|&<>]|\$\(|\$\{/u;

function invalidTemplate(): never {
  throw new TypeError("Invalid gate template");
}

function invalidCatalog(): never {
  throw new TypeError("Invalid gate template catalog");
}

function invalidRequest(): never {
  throw new TypeError("Invalid gate template request");
}

function rawCommand(): never {
  throw new TypeError("Raw command is not allowed");
}

function getOwnDataProperty(
  object: object,
  key: PropertyKey,
  invalid: () => never = invalidTemplate,
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (descriptor === undefined || !("value" in descriptor)) {
    invalid();
  }
  return descriptor.value;
}

function ownKeyNames(value: object, invalid: () => never = invalidTemplate): string[] {
  return Reflect.ownKeys(value).map((key) => {
    if (typeof key !== "string") {
      invalid();
    }
    return key;
  });
}

function assertExactKeys(
  value: object,
  expected: readonly string[],
  invalid: () => never,
): void {
  const keys = ownKeyNames(value, invalid);
  const expectedKeys = new Set(expected);
  const extraKeys = keys.filter((key) => !expectedKeys.has(key));
  if (extraKeys.some((key) => rawCommandKeys.has(key))) {
    rawCommand();
  }
  if (
    extraKeys.length > 0 ||
    expected.some((key) => !keys.includes(key)) ||
    keys.length !== expected.length
  ) {
    invalid();
  }
}

function isPlainObject(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isGateClass(value: unknown): value is GateClass {
  return knownGateClasses.has(value);
}

function containsRawCommandText(value: string): boolean {
  return rawCommandTextPattern.test(value);
}

function commandBasename(value: string): string {
  const segments = value.split(/[/\\]/u);
  return (segments[segments.length - 1] ?? value).toLowerCase();
}

function assertSafeToken(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    invalidTemplate();
  }
  if (containsRawCommandText(value) || value === "--cmd") {
    rawCommand();
  }
}

function captureStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    if (typeof value === "string") {
      rawCommand();
    }
    invalidTemplate();
  }

  const keys = ownKeyNames(value);
  if (keys.some((key) => rawCommandArrayKeys.has(key))) {
    rawCommand();
  }

  const length = getOwnDataProperty(value, "length");
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) {
    invalidTemplate();
  }

  const captured: string[] = [];
  for (let index = 0; index < length; index += 1) {
    const token = getOwnDataProperty(value, index);
    assertSafeToken(token);
    captured[index] = token;
  }
  return captured;
}

function captureArgv(value: unknown): NonEmptyReadonlyArray<string> {
  const captured = captureStringArray(value);
  const interpreter = captured[0];
  if (interpreter === undefined) {
    invalidTemplate();
  }
  if (shellInterpreters.has(commandBasename(interpreter))) {
    rawCommand();
  }
  return Object.freeze(captured) as unknown as NonEmptyReadonlyArray<string>;
}

function parseCommand(value: unknown): GateCommand {
  if (typeof value === "string") {
    rawCommand();
  }
  if (!isPlainObject(value)) {
    invalidTemplate();
  }
  assertExactKeys(value, commandKeys, invalidTemplate);
  return Object.freeze({
    argv: captureArgv(getOwnDataProperty(value, "argv")),
  });
}

function parseTimeout(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    invalidTemplate();
  }
  return value;
}

function parseTemplateId(value: unknown): string {
  if (typeof value !== "string" || !templateIdPattern.test(value)) {
    invalidTemplate();
  }
  return value;
}

export function parseGateTemplate(value: unknown): GateTemplate {
  if (!isPlainObject(value)) {
    invalidTemplate();
  }
  assertExactKeys(value, templateKeys, invalidTemplate);

  const schemaVersion = getOwnDataProperty(value, "schema_version");
  const id = parseTemplateId(getOwnDataProperty(value, "id"));
  const gateClass = getOwnDataProperty(value, "gate_class");
  const timeoutSeconds = parseTimeout(getOwnDataProperty(value, "timeout_seconds"));
  const network = getOwnDataProperty(value, "network");
  const resultSchema = getOwnDataProperty(value, "result_schema");
  if (schemaVersion !== 1 || !isGateClass(gateClass) || network !== "none") {
    invalidTemplate();
  }
  assertSafeToken(resultSchema);

  return Object.freeze({
    schema_version: 1,
    id,
    gate_class: gateClass,
    command: parseCommand(getOwnDataProperty(value, "command")),
    timeout_seconds: timeoutSeconds,
    network: "none",
    writable_roots: Object.freeze(
      captureStringArray(getOwnDataProperty(value, "writable_roots")),
    ),
    result_schema: resultSchema,
    artifact_allowlist: Object.freeze(
      captureStringArray(getOwnDataProperty(value, "artifact_allowlist")),
    ),
  });
}

export function parseGateTemplateCatalog(value: unknown): GateTemplateCatalog {
  if (!isPlainObject(value)) {
    invalidCatalog();
  }
  assertExactKeys(value, catalogKeys, invalidCatalog);
  const schemaVersion = getOwnDataProperty(value, "schema_version", invalidCatalog);
  const templatesValue = getOwnDataProperty(value, "templates", invalidCatalog);
  if (schemaVersion !== 1 || !Array.isArray(templatesValue)) {
    invalidCatalog();
  }

  const length = getOwnDataProperty(templatesValue, "length", invalidCatalog);
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) {
    invalidCatalog();
  }
  if (ownKeyNames(templatesValue, invalidCatalog).some((key) => rawCommandArrayKeys.has(key))) {
    rawCommand();
  }

  const templates: GateTemplate[] = [];
  const seenIds = new Set<string>();
  for (let index = 0; index < length; index += 1) {
    const parsed = parseGateTemplate(
      getOwnDataProperty(templatesValue, index, invalidCatalog),
    );
    if (seenIds.has(parsed.id)) {
      throw new TypeError("Duplicate gate template");
    }
    seenIds.add(parsed.id);
    templates[index] = parsed;
  }

  return Object.freeze({
    schema_version: 1,
    templates: Object.freeze(templates),
  });
}

function parseRequest(value: unknown): ProtectedTemplateRequest {
  if (!isPlainObject(value)) {
    invalidRequest();
  }
  assertExactKeys(value, requestKeys, invalidRequest);
  const gateId = getOwnDataProperty(value, "gate_id", invalidRequest);
  if (typeof gateId !== "string" || !templateIdPattern.test(gateId)) {
    invalidRequest();
  }
  return Object.freeze({
    gate_id: gateId,
  });
}

export function resolveProtectedTemplate(
  catalog: unknown,
  request: unknown,
): ResolvedProtectedCommand {
  const parsedCatalog = parseGateTemplateCatalog(catalog);
  const parsedRequest = parseRequest(request);

  let template: GateTemplate | undefined;
  for (let index = 0; index < parsedCatalog.templates.length; index += 1) {
    const candidate = parsedCatalog.templates[index];
    if (candidate !== undefined && candidate.id === parsedRequest.gate_id) {
      template = candidate;
      break;
    }
  }
  if (template === undefined) {
    throw new TypeError("Unknown gate template");
  }

  const resolved = Object.freeze({
    gate_id: template.id,
    template,
    argv: template.command.argv,
  });
  authenticCommands.add(resolved);
  return resolved;
}

export function isResolvedProtectedCommand(
  value: unknown,
): value is ResolvedProtectedCommand {
  return typeof value === "object" && value !== null && authenticCommands.has(value);
}
