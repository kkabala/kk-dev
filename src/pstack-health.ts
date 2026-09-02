import { lstat, open, readdir, realpath, stat } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

export type PstackEngine = Readonly<{
  name: string;
  version: string;
}>;

export type PstackHealth = Readonly<{
  schema_version: 1;
  engine: PstackEngine;
  supported_capability_ids: readonly string[];
}>;

const inputKeys = ["contract", "plugin_root"] as const;
const contractKeys = [
  "schema_version",
  "implementation_engine",
  "reference",
  "accepted_manifest_paths",
  "required_capability_ids",
] as const;
const referenceKeys = ["name", "version"] as const;
const idPattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u;

function invalidInput(): never {
  throw new TypeError("Invalid pstack health input");
}

function missingCapability(ids: readonly string[]): never {
  throw new TypeError(`Missing required pstack capability: ${ids.join(", ")}`);
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

function compareUtf8(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
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

function parseRelativeManifestPath(value: unknown): string {
  let token = parseRequiredString(value);
  if (path.isAbsolute(token) || token.includes("\\")) {
    invalidInput();
  }
  while (token.endsWith("/")) {
    token = token.slice(0, -1);
  }
  if (token.startsWith("./")) {
    token = token.slice(2);
  }
  if (token.length === 0) {
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

function parseContract(value: unknown): {
  implementation_engine: string;
  reference: { name: string; version: string };
  accepted_manifest_paths: readonly string[];
  required_capability_ids: readonly string[];
} {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, contractKeys);
  if (getOwnDataProperty(value, "schema_version") !== 1) {
    invalidInput();
  }
  const engine = parseRequiredString(
    getOwnDataProperty(value, "implementation_engine"),
  );
  if (engine !== "pstack") {
    invalidInput();
  }
  const referenceValue = getOwnDataProperty(value, "reference");
  if (!isPlainObject(referenceValue)) {
    invalidInput();
  }
  assertExactKeys(referenceValue, referenceKeys);
  const accepted = parseStringList(
    getOwnDataProperty(value, "accepted_manifest_paths"),
    parseRelativeManifestPath,
  );
  if (accepted.length === 0) {
    invalidInput();
  }
  const required = parseStringList(
    getOwnDataProperty(value, "required_capability_ids"),
    parseId,
  );
  if (required.length === 0) {
    invalidInput();
  }
  return {
    implementation_engine: engine,
    reference: {
      name: parseRequiredString(getOwnDataProperty(referenceValue, "name")),
      version: parseRequiredString(getOwnDataProperty(referenceValue, "version")),
    },
    accepted_manifest_paths: accepted,
    required_capability_ids: required,
  };
}

function isWithinRoot(canonicalRoot: string, canonicalPath: string): boolean {
  const relativePath = path.relative(canonicalRoot, canonicalPath);
  return (
    relativePath === "" ||
    (!path.isAbsolute(relativePath) &&
      relativePath !== ".." &&
      !relativePath.startsWith(`..${path.sep}`))
  );
}

async function readRegularFile(filePath: string): Promise<string> {
  const metadata = await lstat(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    invalidInput();
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

async function canonicalizePluginRoot(pluginRoot: string): Promise<string> {
  let canonicalRoot: string;
  try {
    canonicalRoot = await realpath(pluginRoot);
  } catch {
    invalidInput();
  }
  const rootStat = await stat(canonicalRoot).catch(() => undefined);
  if (rootStat === undefined || !rootStat.isDirectory()) {
    invalidInput();
  }
  return canonicalRoot;
}

function resolveDeclaredPath(canonicalRoot: string, relativePath: string): string {
  const resolvedRoot = path.resolve(canonicalRoot);
  const resolvedPath = path.resolve(resolvedRoot, relativePath);
  const rootPrefix = `${resolvedRoot}${path.sep}`;
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(rootPrefix)) {
    invalidInput();
  }
  return resolvedPath;
}

async function findManifest(
  canonicalRoot: string,
  acceptedManifestPaths: readonly string[],
): Promise<{ bytes: string; relativePath: string }> {
  const matches: { bytes: string; relativePath: string }[] = [];
  for (let index = 0; index < acceptedManifestPaths.length; index += 1) {
    const relativePath = acceptedManifestPaths[index];
    if (relativePath === undefined) {
      invalidInput();
    }
    const declaredPath = resolveDeclaredPath(canonicalRoot, relativePath);
    let canonicalManifestPath: string;
    try {
      canonicalManifestPath = await realpath(declaredPath);
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        continue;
      }
      invalidInput();
    }
    if (!isWithinRoot(canonicalRoot, canonicalManifestPath)) {
      invalidInput();
    }
    const manifestStat = await stat(canonicalManifestPath).catch(() => undefined);
    if (manifestStat === undefined || !manifestStat.isFile()) {
      invalidInput();
    }
    matches.push({
      bytes: await readRegularFile(canonicalManifestPath),
      relativePath,
    });
  }
  if (matches.length !== 1) {
    invalidInput();
  }
  const match = matches[0];
  if (match === undefined) {
    invalidInput();
  }
  return match;
}

function parseManifestIdentity(bytes: string): {
  name: string;
  version: string;
  skills: string | null;
  agents: string | null;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes) as unknown;
  } catch {
    invalidInput();
  }
  if (!isPlainObject(parsed)) {
    invalidInput();
  }
  const name = getOwnDataProperty(parsed, "name");
  const version = getOwnDataProperty(parsed, "version");
  const skills = Object.getOwnPropertyDescriptor(parsed, "skills");
  const agents = Object.getOwnPropertyDescriptor(parsed, "agents");
  return {
    name: parseRequiredString(name),
    version: parseRequiredString(version),
    skills:
      skills === undefined || !("value" in skills) || skills.value === undefined
        ? null
        : parseRelativeManifestPath(skills.value),
    agents:
      agents === undefined || !("value" in agents) || agents.value === undefined
        ? null
        : parseRelativeManifestPath(agents.value),
  };
}

async function listSkillIds(
  canonicalRoot: string,
  relativeDirectory: string,
): Promise<string[]> {
  const declared = resolveDeclaredPath(canonicalRoot, relativeDirectory);
  let declaredRoot: string;
  try {
    declaredRoot = await realpath(declared);
  } catch {
    invalidInput();
  }
  if (!isWithinRoot(canonicalRoot, declaredRoot)) {
    invalidInput();
  }
  const directoryStat = await stat(declaredRoot).catch(() => undefined);
  if (directoryStat === undefined || !directoryStat.isDirectory()) {
    invalidInput();
  }
  const entries = await readdir(declaredRoot, { withFileTypes: true });
  const ids: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") || !entry.isDirectory()) {
      continue;
    }
    const skillRoot = path.join(declaredRoot, entry.name);
    const [skillRootStat, skillFileStat] = await Promise.all([
      lstat(skillRoot).catch(() => undefined),
      lstat(path.join(skillRoot, "SKILL.md")).catch(() => undefined),
    ]);
    if (
      skillRootStat !== undefined &&
      skillRootStat.isDirectory() &&
      skillFileStat !== undefined &&
      skillFileStat.isFile() &&
      !skillFileStat.isSymbolicLink()
    ) {
      ids.push(entry.name);
    }
  }
  ids.sort(compareUtf8);
  return ids;
}

async function listAgentIds(
  canonicalRoot: string,
  relativeDirectory: string,
): Promise<string[]> {
  const declared = resolveDeclaredPath(canonicalRoot, relativeDirectory);
  let declaredRoot: string;
  try {
    declaredRoot = await realpath(declared);
  } catch {
    invalidInput();
  }
  if (!isWithinRoot(canonicalRoot, declaredRoot)) {
    invalidInput();
  }
  const directoryStat = await stat(declaredRoot).catch(() => undefined);
  if (directoryStat === undefined || !directoryStat.isDirectory()) {
    invalidInput();
  }
  const entries = await readdir(declaredRoot, { withFileTypes: true });
  const ids: string[] = [];
  for (const entry of entries) {
    if (
      entry.name.startsWith(".") ||
      !entry.isFile() ||
      path.extname(entry.name) !== ".md"
    ) {
      continue;
    }
    ids.push(entry.name.slice(0, -".md".length));
  }
  ids.sort(compareUtf8);
  return ids;
}

export async function checkPstackHealth(value: unknown): Promise<PstackHealth> {
  if (!isPlainObject(value)) {
    invalidInput();
  }
  assertExactKeys(value, inputKeys);
  const contract = parseContract(getOwnDataProperty(value, "contract"));
  const pluginRoot = parseRequiredString(getOwnDataProperty(value, "plugin_root"));
  const canonicalRoot = await canonicalizePluginRoot(pluginRoot);
  const manifest = await findManifest(canonicalRoot, contract.accepted_manifest_paths);
  const identity = parseManifestIdentity(manifest.bytes);
  const [skillIds, agentIds] = await Promise.all([
    identity.skills === null ? Promise.resolve([]) : listSkillIds(canonicalRoot, identity.skills),
    identity.agents === null ? Promise.resolve([]) : listAgentIds(canonicalRoot, identity.agents),
  ]);

  const supported: string[] = [];
  const seen = new Set<string>();
  function add(id: string): void {
    if (!seen.has(id)) {
      seen.add(id);
      supported.push(id);
    }
  }
  if (
    identity.name === contract.reference.name &&
    identity.version === contract.reference.version
  ) {
    add(`engine.${contract.implementation_engine}`);
  }
  for (let index = 0; index < skillIds.length; index += 1) {
    const id = skillIds[index];
    if (id === undefined) {
      invalidInput();
    }
    add(`skills.${id}`);
  }
  for (let index = 0; index < agentIds.length; index += 1) {
    const id = agentIds[index];
    if (id === undefined) {
      invalidInput();
    }
    add(`agents.${id}`);
  }
  supported.sort(compareUtf8);

  const missing: string[] = [];
  for (let index = 0; index < contract.required_capability_ids.length; index += 1) {
    const required = contract.required_capability_ids[index];
    if (required === undefined) {
      invalidInput();
    }
    if (!seen.has(required)) {
      missing.push(required);
    }
  }
  if (missing.length > 0) {
    missing.sort(compareUtf8);
    missingCapability(missing);
  }

  return Object.freeze({
    schema_version: 1,
    engine: Object.freeze({
      name: identity.name,
      version: identity.version,
    }),
    supported_capability_ids: Object.freeze(supported),
  });
}
