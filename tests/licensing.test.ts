import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  cp,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";

const execFileAsync = promisify(execFile);
const packageRoot = fileURLToPath(new URL("../", import.meta.url));

const canonicalMitLicense = `
MIT License

Copyright (c) 2026 Krzysztof Kabala

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

type PackedFile = Readonly<{
  path: string;
  size: number;
}>;

type PackResult = Readonly<{
  bundled?: string[];
  files: PackedFile[];
}>;

type DependencyMap = Readonly<Record<string, string>>;

type OverrideValue = string | OverrideMap;

type OverrideMap = Readonly<{
  [dependencyName: string]: OverrideValue;
}>;

type PackageManifest = Readonly<{
  bundleDependencies?: boolean | string[];
  bundledDependencies?: boolean | string[];
  dependencies?: DependencyMap;
  devDependencies?: DependencyMap;
  optionalDependencies?: DependencyMap;
  overrides?: OverrideMap;
  peerDependencies?: DependencyMap;
  scripts?: Readonly<Record<string, string>>;
}>;

type BundleDeclaration = PackageManifest["bundleDependencies"];

type BundleDeclarationName =
  | "bundleDependencies"
  | "bundledDependencies";

function normalizeWhitespace(value: string): string {
  return value.trim().replaceAll(/\s+/g, " ");
}

const allowedPublishedPackagePaths = new Set([
  "LICENSE.md",
  "README.md",
  "THIRD_PARTY_NOTICES.md",
  "dist/bin.d.ts",
  "dist/bin.js",
  "dist/bin.js.map",
  "dist/bounce.d.ts",
  "dist/bounce.js",
  "dist/bounce.js.map",
  "dist/cli.d.ts",
  "dist/cli.js",
  "dist/cli.js.map",
  "dist/delivery.d.ts",
  "dist/delivery.js",
  "dist/delivery.js.map",
  "dist/delivery-repair.d.ts",
  "dist/delivery-repair.js",
  "dist/delivery-repair.js.map",
  "dist/domain.d.ts",
  "dist/domain.js",
  "dist/domain.js.map",
  "dist/evidence-key.d.ts",
  "dist/evidence-key.js",
  "dist/evidence-key.js.map",
  "dist/evaluator.d.ts",
  "dist/evaluator.js",
  "dist/evaluator.js.map",
  "dist/exception.d.ts",
  "dist/exception.js",
  "dist/exception.js.map",
  "dist/evidence-store.d.ts",
  "dist/evidence-store.js",
  "dist/evidence-store.js.map",
  "dist/gates.d.ts",
  "dist/gates.js",
  "dist/gates.js.map",
  "dist/gate-template.d.ts",
  "dist/gate-template.js",
  "dist/gate-template.js.map",
  "dist/g9.d.ts",
  "dist/g9.js",
  "dist/g9.js.map",
  "dist/github.d.ts",
  "dist/github.js",
  "dist/github.js.map",
  "dist/github-auto-merge.d.ts",
  "dist/github-auto-merge.js",
  "dist/github-auto-merge.js.map",
  "dist/github-g7.d.ts",
  "dist/github-g7.js",
  "dist/github-g7.js.map",
  "dist/github-governance.d.ts",
  "dist/github-governance.js",
  "dist/github-governance.js.map",
  "dist/github-pr.d.ts",
  "dist/github-pr.js",
  "dist/github-pr.js.map",
  "dist/hardening.d.ts",
  "dist/hardening.js",
  "dist/hardening.js.map",
  "dist/index.d.ts",
  "dist/index.js",
  "dist/index.js.map",
  "dist/intake.d.ts",
  "dist/intake.js",
  "dist/intake.js.map",
  "dist/pac.d.ts",
  "dist/pac.js",
  "dist/pac.js.map",
  "dist/preparation-store.d.ts",
  "dist/preparation-store.js",
  "dist/preparation-store.js.map",
  "dist/product.d.ts",
  "dist/product.js",
  "dist/product.js.map",
  "dist/protected-runner.d.ts",
  "dist/protected-runner.js",
  "dist/protected-runner.js.map",
  "dist/pstack-assignment.d.ts",
  "dist/pstack-assignment.js",
  "dist/pstack-assignment.js.map",
  "dist/pstack-candidate.d.ts",
  "dist/pstack-candidate.js",
  "dist/pstack-candidate.js.map",
  "dist/pstack-health.d.ts",
  "dist/pstack-health.js",
  "dist/pstack-health.js.map",
  "dist/pstack-runtime.d.ts",
  "dist/pstack-runtime.js",
  "dist/pstack-runtime.js.map",
  "dist/risk.d.ts",
  "dist/risk.js",
  "dist/risk.js.map",
  "dist/roles.d.ts",
  "dist/roles.js",
  "dist/roles.js.map",
  "dist/run-catalog.d.ts",
  "dist/run-catalog.js",
  "dist/run-catalog.js.map",
  "dist/run-state.d.ts",
  "dist/run-state.js",
  "dist/run-state.js.map",
  "dist/run-state-store.d.ts",
  "dist/run-state-store.js",
  "dist/run-state-store.js.map",
  "dist/surfaces.d.ts",
  "dist/surfaces.js",
  "dist/surfaces.js.map",
  "package.json",
]);

function unexpectedPublishedFiles(files: readonly PackedFile[]): string[] {
  return files
    .map((file) => file.path)
    .filter((publishedPath) => !allowedPublishedPackagePaths.has(publishedPath));
}

function missingPublishedFiles(files: readonly PackedFile[]): string[] {
  const publishedPaths = new Set(files.map((file) => file.path));
  return [...allowedPublishedPackagePaths].filter(
    (expectedPath) => !publishedPaths.has(expectedPath),
  );
}

const upstreamProjectToken =
  /(?:^|[^a-z0-9])(?:retemper|pstack|poteto-mode)(?:$|[^a-z0-9])/i;

function referencesUpstreamProject(value: string): boolean {
  if (upstreamProjectToken.test(value)) {
    return true;
  }

  try {
    const decodedValue = decodeURIComponent(value);
    return decodedValue !== value && upstreamProjectToken.test(decodedValue);
  } catch {
    return true;
  }
}

function formatOverridePath(parentPath: string, dependencyName: string): string {
  return dependencyName === "."
    ? `${parentPath}["."]`
    : `${parentPath}.${dependencyName}`;
}

function upstreamOverrideReferences(
  overrides: OverrideMap,
  parentPath = "overrides",
): string[] {
  return Object.entries(overrides).flatMap(([dependencyName, override]) => {
    const overridePath = formatOverridePath(parentPath, dependencyName);
    if (typeof override === "string") {
      return referencesUpstreamProject(dependencyName) ||
        referencesUpstreamProject(override)
        ? [`${overridePath}: ${override}`]
        : [];
    }

    const nestedReferences = upstreamOverrideReferences(override, overridePath);
    return referencesUpstreamProject(dependencyName)
      ? [overridePath, ...nestedReferences]
      : nestedReferences;
  });
}

function namedDependenciesFromBundleDeclaration(
  declaration: BundleDeclaration,
): readonly string[] {
  return Array.isArray(declaration) ? declaration : [];
}

function upstreamDependencyReferences(manifest: PackageManifest): string[] {
  const dependencyMaps = [
    manifest.dependencies,
    manifest.devDependencies,
    manifest.optionalDependencies,
    manifest.peerDependencies,
  ];
  const declaredDependencies = dependencyMaps
    .flatMap((dependencies) => Object.entries(dependencies ?? {}))
    .filter(
      ([dependencyName, dependencyLocator]) =>
        referencesUpstreamProject(dependencyName) ||
        referencesUpstreamProject(dependencyLocator),
    )
    .map(([dependencyName, dependencyLocator]) =>
      `${dependencyName}: ${dependencyLocator}`,
    );
  const bundledDependencyNames = [
    manifest.bundleDependencies,
    manifest.bundledDependencies,
  ].flatMap(namedDependenciesFromBundleDeclaration);

  return [
    ...declaredDependencies,
    ...bundledDependencyNames.filter(referencesUpstreamProject),
    ...upstreamOverrideReferences(manifest.overrides ?? {}),
  ];
}

async function writeInstalledPackage(
  fixtureRoot: string,
  installName: string,
  packageName = installName,
): Promise<void> {
  const dependencyRoot = path.join(fixtureRoot, "node_modules", installName);
  await mkdir(dependencyRoot, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(dependencyRoot, "package.json"),
      `${JSON.stringify({ name: packageName, version: "1.0.0" }, null, 2)}\n`,
    ),
    writeFile(path.join(dependencyRoot, "index.js"), "export {};\n"),
  ]);
}

async function dryRunPack(
  fixtureRoot: string,
  npmCache: string,
  invocationRoot = fixtureRoot,
): Promise<PackResult> {
  const packageTarget =
    path.resolve(invocationRoot) === path.resolve(fixtureRoot) ? "." : fixtureRoot;
  const { stdout } = await execFileAsync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    [
      "pack",
      packageTarget,
      "--dry-run",
      "--json",
      "--ignore-scripts",
      "--cache",
      npmCache,
    ],
    { cwd: invocationRoot },
  );
  const [packedPackage] = JSON.parse(stdout) as PackResult[];
  assert.ok(packedPackage, "npm must describe the package it would publish");
  return packedPackage;
}

test("the package artifact allowlist rejects nested, emitted, and renamed files", () => {
  const prohibitedPaths = [
    "dist/pstack/index.js",
    "dist/retemper/runner.js",
    "dist/pstack.js",
    "dist/chunks/poteto-mode-runtime.js",
    "dist/generated/retemper/index.js",
    "dist/index.js.LICENSE.txt",
    "dist/index.mjs",
    "dist/tsconfig.build.tsbuildinfo",
    "src/index.ts",
    "THIRD_PARTY_NOTICES-copy.md",
  ];

  for (const prohibitedPath of prohibitedPaths) {
    assert.deepEqual(
      unexpectedPublishedFiles([{ path: prohibitedPath, size: 1 }]),
      [prohibitedPath],
      `${prohibitedPath} must be rejected`,
    );
  }
});

test("the package artifact allowlist reports a missing expected file", () => {
  const completePackage = [...allowedPublishedPackagePaths].map((publishedPath) => ({
    path: publishedPath,
    size: 1,
  }));
  const missingPath = "THIRD_PARTY_NOTICES.md";

  assert.deepEqual(missingPublishedFiles(completePackage), []);
  assert.deepEqual(
    missingPublishedFiles(
      completePackage.filter((publishedFile) => publishedFile.path !== missingPath),
    ),
    [missingPath],
  );
});

test("the dependency guard recognizes upstream names at locator punctuation boundaries", () => {
  const prohibitedLocators = [
    "github:example/retemper#main",
    "git+https://github.com/example/retemper.git",
    "git+ssh://git@github.com/example/pstack.git#semver:^1",
    "https://packages.example.test/adapter.tgz?source=poteto-mode",
    "file:../vendor/retemper",
    "npm:@example/pstack@^1.0.0",
  ];

  for (const prohibitedLocator of prohibitedLocators) {
    assert.deepEqual(
      upstreamDependencyReferences({ dependencies: { adapter: prohibitedLocator } }),
      [`adapter: ${prohibitedLocator}`],
      `${prohibitedLocator} must be rejected`,
    );
  }

  const prohibitedNames = [
    "retemper",
    "@example/retemper",
    "company.pstack.adapter",
    "@example/poteto-mode",
  ];

  for (const prohibitedName of prohibitedNames) {
    assert.deepEqual(
      upstreamDependencyReferences({ dependencies: { [prohibitedName]: "1.0.0" } }),
      [`${prohibitedName}: 1.0.0`],
      `${prohibitedName} must be rejected`,
    );
  }

  assert.deepEqual(
    upstreamDependencyReferences({
      dependencies: {
        "pstacked-tools": "https://example.test/retempered.git",
        "poteto-model": "https://example.test/poteto-model.git",
        "retemperable-kit": "file:../pstacked-adapter",
      },
    }),
    [],
    "unrelated substrings must remain allowed",
  );
});

test("the dependency guard covers every dependency and bundle declaration", () => {
  assert.deepEqual(
    upstreamDependencyReferences({
      dependencies: { direct: "github:example/retemper" },
      devDependencies: { "@example/pstack": "1.0.0" },
      optionalDependencies: { optional: "file:../poteto-mode" },
      peerDependencies: { peer: "https://example.test/pstack.tgz" },
      bundleDependencies: ["retemper", "pstacked-tools"],
      bundledDependencies: ["@example/poteto-mode", "retemperable-kit"],
    }),
    [
      "direct: github:example/retemper",
      "@example/pstack: 1.0.0",
      "optional: file:../poteto-mode",
      "peer: https://example.test/pstack.tgz",
      "retemper",
      "@example/poteto-mode",
    ],
  );
});

test("the dependency guard safely handles boolean bundle declarations", () => {
  assert.deepEqual(
    upstreamDependencyReferences({
      dependencies: { retemper: "1.0.0", safe: "2.0.0" },
      bundleDependencies: true,
      bundledDependencies: false,
    }),
    ["retemper: 1.0.0"],
    "true must rely on the inspected dependency map without being spread",
  );
  assert.deepEqual(
    upstreamDependencyReferences({
      bundleDependencies: false,
      bundledDependencies: true,
    }),
    [],
    "boolean declarations do not name explicit bundled dependencies",
  );
});

test("npm bundle declarations cannot hide upstream dependencies", async (context) => {
  const fixtureParent = await mkdtemp(
    path.join(tmpdir(), "exoframe-bundle-declaration-test-"),
  );
  const npmCache = await mkdtemp(path.join(tmpdir(), "exoframe-npm-cache-"));
  context.after(async () => rm(fixtureParent, { force: true, recursive: true }));
  context.after(async () => rm(npmCache, { force: true, recursive: true }));

  const dependencies = {
    retemper: "1.0.0",
    "safe-dependency": "1.0.0",
    "upstream-alias": "npm:pstack@1.0.0",
  };
  const cases: ReadonlyArray<
    Readonly<{
      declaration: boolean | string[];
      declarationName: BundleDeclarationName;
      expectedBundled: string[];
    }>
  > = [
    {
      declarationName: "bundleDependencies",
      declaration: ["safe-dependency", "upstream-alias"],
      expectedBundled: ["safe-dependency", "upstream-alias"],
    },
    {
      declarationName: "bundledDependencies",
      declaration: ["retemper", "safe-dependency"],
      expectedBundled: ["retemper", "safe-dependency"],
    },
    {
      declarationName: "bundleDependencies",
      declaration: true,
      expectedBundled: ["retemper", "safe-dependency", "upstream-alias"],
    },
    {
      declarationName: "bundledDependencies",
      declaration: true,
      expectedBundled: ["retemper", "safe-dependency", "upstream-alias"],
    },
    {
      declarationName: "bundleDependencies",
      declaration: false,
      expectedBundled: [],
    },
    {
      declarationName: "bundledDependencies",
      declaration: false,
      expectedBundled: [],
    },
  ];

  for (const [caseIndex, bundleCase] of cases.entries()) {
    const fixtureRoot = path.join(fixtureParent, `case-${caseIndex}`);
    await mkdir(fixtureRoot);
    await Promise.all([
      writeFile(path.join(fixtureRoot, "index.js"), "export {};\n"),
      ...Object.keys(dependencies).map((installName) =>
        writeInstalledPackage(
          fixtureRoot,
          installName,
          installName === "upstream-alias" ? "pstack" : installName,
        ),
      ),
    ]);
    const manifest: PackageManifest & Readonly<{ name: string; version: string }> = {
      name: `bundle-declaration-probe-${caseIndex}`,
      version: "1.0.0",
      dependencies,
      [bundleCase.declarationName]: bundleCase.declaration,
    };
    await writeFile(
      path.join(fixtureRoot, "package.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );

    const packedPackage = await dryRunPack(fixtureRoot, npmCache);
    assert.deepEqual(
      [...(packedPackage.bundled ?? [])].sort(),
      [...bundleCase.expectedBundled].sort(),
      `${bundleCase.declarationName}=${JSON.stringify(bundleCase.declaration)} must follow npm's actual bundled list`,
    );
    const explicitlyBundledUpstreamNames = Array.isArray(bundleCase.declaration)
      ? bundleCase.declaration.filter(referencesUpstreamProject)
      : [];
    assert.deepEqual(
      upstreamDependencyReferences(manifest),
      [
        "retemper: 1.0.0",
        "upstream-alias: npm:pstack@1.0.0",
        ...explicitlyBundledUpstreamNames,
      ],
      "dependency names and npm aliases must remain visible regardless of bundle syntax",
    );
  }
});

test("the dependency guard recognizes percent-encoded upstream references", () => {
  const prohibitedLocators = [
    "npm:%40example%2Fpstack@^1.0.0",
    "github:example/%70stack#main",
    "https://packages.example.test/poteto%2Dmode.tgz",
  ];

  for (const prohibitedLocator of prohibitedLocators) {
    assert.deepEqual(
      upstreamDependencyReferences({ dependencies: { adapter: prohibitedLocator } }),
      [`adapter: ${prohibitedLocator}`],
      `${prohibitedLocator} must be rejected after safe decoding`,
    );
  }

  assert.deepEqual(
    upstreamDependencyReferences({
      dependencies: {
        adapter: "npm:%40example%2Fpstacked-tools@1.0.0",
        formatter: "github:example/%70stacked-kit#main",
        model: "https://packages.example.test/poteto%2Dmodel.tgz",
      },
    }),
    [],
    "encoded near-names must remain allowed",
  );
});

test("the dependency guard recursively inspects npm overrides", () => {
  assert.deepEqual(
    upstreamDependencyReferences({
      overrides: {
        "@example/pstack": "1.0.0",
        adapter: "npm:%40example%2Fpstack@^1.0.0",
        "%70stack": "1.0.0",
        parent: {
          ".": "https://packages.example.test/poteto%2Dmode.tgz",
          child: {
            "%72etemper": "1.0.0",
          },
        },
        "pstacked-tools": {
          ".": "npm:%40example%2Fpstacked-tools@1.0.0",
        },
        "%70stacked-tools": {
          ".": "github:example/%72etemperable-kit#main",
        },
      },
    }),
    [
      "overrides.@example/pstack: 1.0.0",
      "overrides.adapter: npm:%40example%2Fpstack@^1.0.0",
      "overrides.%70stack: 1.0.0",
      "overrides.parent[\".\"]: https://packages.example.test/poteto%2Dmode.tgz",
      "overrides.parent.child.%72etemper: 1.0.0",
    ],
  );
});

test("the dependency guard fails closed on malformed percent encoding", () => {
  const malformedReferences = ["pstack%ZZ", "%70stack%ZZ", "adapter%"];

  for (const malformedReference of malformedReferences) {
    assert.deepEqual(
      upstreamDependencyReferences({ dependencies: { adapter: malformedReference } }),
      [`adapter: ${malformedReference}`],
      `${malformedReference} must be rejected without throwing`,
    );
  }

  assert.deepEqual(
    upstreamDependencyReferences({
      overrides: {
        parent: {
          ".": "%70stack%ZZ",
          "%72etemper%ZZ": "1.0.0",
        },
      },
    }),
    [
      "overrides.parent[\".\"]: %70stack%ZZ",
      "overrides.parent.%72etemper%ZZ: 1.0.0",
    ],
    "malformed override keys and values must be rejected without throwing",
  );
});

test("the published package carries its license and auditable upstream reuse policy", async (context) => {
  const cleanScript = await lstat(path.join(packageRoot, "scripts", "clean.mjs"));
  assert.ok(cleanScript.isFile(), "the cleaner entry point must be a regular file");
  assert.equal(
    cleanScript.isSymbolicLink(),
    false,
    "the cleaner target must not depend on symlink resolution outside the package",
  );
  const npmCache = await mkdtemp(path.join(tmpdir(), "exoframe-npm-cache-"));
  const invocationRoot = await mkdtemp(
    path.join(tmpdir(), "exoframe-pack-invocation-"),
  );
  const isolatedPackageRoot = await mkdtemp(
    path.join(packageRoot, ".exoframe-package-test-"),
  );
  context.after(async () => rm(npmCache, { force: true, recursive: true }));
  context.after(async () => rm(invocationRoot, { force: true, recursive: true }));
  context.after(async () =>
    rm(isolatedPackageRoot, { force: true, recursive: true }),
  );

  const packageInputs = [
    "LICENSE.md",
    "README.md",
    "THIRD_PARTY_NOTICES.md",
    "package.json",
    "tsconfig.build.json",
    "tsconfig.json",
  ];
  await Promise.all(
    packageInputs.map((inputPath) =>
      copyFile(
        path.join(packageRoot, inputPath),
        path.join(isolatedPackageRoot, inputPath),
      ),
    ),
  );
  await mkdir(path.join(isolatedPackageRoot, "scripts"));
  await copyFile(
    path.join(packageRoot, "scripts", "clean.mjs"),
    path.join(isolatedPackageRoot, "scripts", "clean.mjs"),
  );
  await cp(path.join(packageRoot, "src"), path.join(isolatedPackageRoot, "src"), {
    recursive: true,
  });
  const staleDistPaths = [
    "dist/obsolete-upstream-runtime.js",
    "dist/legacy/pstack/runtime.js",
    "dist/renamed-index.mjs",
    "dist/bin.js.LICENSE.txt",
  ].map((stalePath) => path.join(isolatedPackageRoot, stalePath));
  await Promise.all(
    staleDistPaths.map(async (staleDistPath) => {
      await mkdir(path.dirname(staleDistPath), { recursive: true });
      await writeFile(
        staleDistPath,
        "throw new Error('stale output was published');\n",
      );
    }),
  );
  assert.deepEqual(
    (await readdir(path.join(isolatedPackageRoot, "dist"))).sort(),
    ["bin.js.LICENSE.txt", "legacy", "obsolete-upstream-runtime.js", "renamed-index.mjs"],
    "the isolated package must begin with nested and renamed stale output",
  );
  const packageBoundarySentinel = path.join(
    isolatedPackageRoot,
    "build-cache",
    "keep.txt",
  );
  const invocationBoundarySentinel = path.join(
    invocationRoot,
    "dist",
    "keep.txt",
  );
  await Promise.all([
    mkdir(path.dirname(packageBoundarySentinel), { recursive: true }),
    mkdir(path.dirname(invocationBoundarySentinel), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(packageBoundarySentinel, "keep package sibling\n"),
    writeFile(invocationBoundarySentinel, "keep invocation dist\n"),
  ]);

  const { stdout } = await execFileAsync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["pack", isolatedPackageRoot, "--dry-run", "--json", "--cache", npmCache],
    { cwd: invocationRoot },
  );
  const [packedPackage] = JSON.parse(stdout) as PackResult[];
  assert.ok(packedPackage, "npm must describe the package it would publish");
  await Promise.all(
    staleDistPaths.map((staleDistPath) =>
      assert.rejects(
        readFile(staleDistPath),
        { code: "ENOENT" },
        `${path.relative(isolatedPackageRoot, staleDistPath)} must be removed before compilation`,
      ),
    ),
  );
  assert.equal(
    await readFile(packageBoundarySentinel, "utf8"),
    "keep package sibling\n",
    "the cleaner must not remove package content outside dist",
  );
  assert.equal(
    await readFile(invocationBoundarySentinel, "utf8"),
    "keep invocation dist\n",
    "the cleaner must resolve dist from its package rather than the invoking cwd",
  );
  assert.equal(
    packedPackage.files.length,
    109,
    "the package must publish exactly the 109 reviewed artifacts",
  );

  const licenseEntry = packedPackage.files.find((file) => file.path === "LICENSE.md");
  assert.ok(licenseEntry, "the package must publish LICENSE.md");
  assert.ok(licenseEntry.size > 0, "the published license must not be empty");
  assert.equal(
    normalizeWhitespace(
      await readFile(path.join(isolatedPackageRoot, licenseEntry.path), "utf8"),
    ),
    normalizeWhitespace(canonicalMitLicense),
    "LICENSE.md must be the canonical MIT license owned by Krzysztof Kabala",
  );

  const policyEntry = packedPackage.files.find(
    (file) => file.path === "THIRD_PARTY_NOTICES.md",
  );
  assert.ok(policyEntry, "the package must publish its third-party provenance policy");
  assert.ok(policyEntry.size > 0, "the published provenance policy must not be empty");

  const policy = await readFile(
    path.join(isolatedPackageRoot, policyEntry.path),
    "utf8",
  );
  const normalizedPolicy = normalizeWhitespace(policy);
  assert.match(policy, /\bRetemper\b/i);
  assert.match(policy, /\b(?:owner-authorized|owned by|same owner)\b/i);
  assert.match(
    policy,
    /\b(?:no|without)\b[^.\n]{0,80}\b(?:attribution|credit)\b|\b(?:attribution|credit)\b[^.\n]{0,80}\bnot required\b/i,
    "Retemper reuse must not impose an attribution or credit requirement",
  );
  assert.match(policy, /\bprovenance\b/i);
  assert.match(policy, /\bsource repository\b/i);
  assert.match(policy, /\bexact\b[^.\n]{0,40}\b(?:commit|revision)\b/i);
  assert.match(policy, /\bsource path\b/i);
  assert.match(policy, /\b(?:Exoframe )?destination path\b/i);
  assert.match(policy, /\bmodification notes\b/i);
  assert.match(
    normalizedPolicy,
    /\bthird-party\b[^.]{0,100}\bvendored\b[^.]{0,160}\bnot covered\b/i,
    "Retemper owner authorization must exclude third-party and vendored material",
  );
  assert.match(normalizedPolicy, /\bthird-party\b[^.]{0,180}\bown license\b/i);
  assert.match(
    normalizedPolicy,
    /\bcurrently contains no\b[^.]{0,80}\bcopied Retemper source\b/i,
  );

  assert.match(policy, /\bpstack\b/i);
  assert.match(policy, /\bpoteto-mode\b/i);
  assert.match(policy, /\bexternal\b/i);
  assert.match(policy, /\bunmodified\b/i);
  assert.match(policy, /\bunbundled\b|\bnot bundled\b/i);
  assert.match(policy, /\bdoes not copy\b/i);
  assert.match(policy, /\bfork\b/i);
  assert.match(policy, /\bpatch\b/i);
  assert.match(policy, /\bvendor\b/i);
  assert.match(
    policy,
    /\bonly\b[^.\n]{0,80}\badapter\b|\badapter\b[^.\n]{0,80}\bonly\b/i,
    "pstack/poteto-mode must be accessible only through Exoframe's adapter",
  );

  const readmeEntry = packedPackage.files.find((file) => file.path === "README.md");
  assert.ok(readmeEntry, "the package must publish its README");
  const readme = await readFile(
    path.join(isolatedPackageRoot, readmeEntry.path),
    "utf8",
  );
  assert.match(readme, /\[MIT License\]\(\.\/LICENSE\.md\)/);
  assert.match(
    readme,
    /\[source-provenance and third-party notices\]\(\.\/THIRD_PARTY_NOTICES\.md\)/,
  );

  assert.deepEqual(
    unexpectedPublishedFiles(packedPackage.files),
    [],
    "the package must contain only deliberately reviewed publication artifacts",
  );
  assert.deepEqual(
    (packedPackage.bundled ?? []).filter(referencesUpstreamProject),
    [],
    "the package must not bundle Retemper or pstack/poteto-mode dependencies",
  );

  const manifest = JSON.parse(
    await readFile(path.join(isolatedPackageRoot, "package.json"), "utf8"),
  ) as PackageManifest;
  assert.equal(
    manifest.scripts?.prepack,
    "npm run build",
    "npm pack must deterministically rebuild every dist entry point",
  );
  assert.deepEqual(
    upstreamDependencyReferences(manifest),
    [],
    "the published manifest must not declare Retemper or pstack/poteto-mode dependencies",
  );
  assert.deepEqual(
    missingPublishedFiles(packedPackage.files),
    [],
    "the package must not omit any reviewed publication artifact",
  );
  assert.deepEqual(
    packedPackage.files.map((file) => file.path).sort(),
    [...allowedPublishedPackagePaths].sort(),
    "the package must contain the complete reviewed publication artifact set",
  );
});
