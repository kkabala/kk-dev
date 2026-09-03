import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { listAcceptanceScenarios } from "../src/index.ts";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));

function testTitles(source: string): Set<string> {
  const titles = new Set<string>();
  const pattern = /^test\("([^"]+)"/gmu;
  for (const match of source.matchAll(pattern)) {
    const title = match[1];
    if (title !== undefined) {
      titles.add(title);
    }
  }
  return titles;
}

function specStatements(source: string): Map<number, string> {
  const start = source.indexOf("## 26. Required acceptance scenarios");
  const end = source.indexOf("## 27. Definition of MVP complete");
  if (start < 0 || end < 0 || end <= start) {
    throw new Error("specification section 26 is missing");
  }
  const statements = new Map<number, string>();
  const pattern = /^(\d+)\. (.+)$/gmu;
  for (const match of source.slice(start, end).matchAll(pattern)) {
    const id = Number(match[1]);
    const statement = match[2];
    if (!Number.isInteger(id) || statement === undefined) {
      continue;
    }
    statements.set(id, statement);
  }
  return statements;
}

function ledgerOwners(source: string): Map<number, readonly string[]> {
  const start = source.indexOf("## Acceptance-scenario ownership");
  const end = source.indexOf("## Commit and review log");
  if (start < 0 || end < 0 || end <= start) {
    throw new Error("ledger ownership table is missing");
  }
  const owners = new Map<number, readonly string[]>();
  const pattern = /^\| (\d+) \| ([^|]+) \|$/gmu;
  for (const match of source.slice(start, end).matchAll(pattern)) {
    const id = Number(match[1]);
    const slices = match[2]?.split(",").map((slice) => slice.trim());
    if (!Number.isInteger(id) || slices === undefined || slices.length === 0) {
      continue;
    }
    owners.set(id, slices);
  }
  return owners;
}

test("all 41 specification scenarios have consecutive ids and ledger owning slices", async () => {
  const scenarios = listAcceptanceScenarios();
  assert.equal(scenarios.length, 41);
  const ledger = ledgerOwners(
    await readFile(path.join(packageRoot, "IMPLEMENTATION_LEDGER.md"), "utf8"),
  );
  assert.equal(ledger.size, 41);
  for (const [index, scenario] of scenarios.entries()) {
    const id = index + 1;
    assert.equal(scenario.id, id);
    assert.deepEqual(scenario.owning_slices, ledger.get(id));
    assert.ok(scenario.tests.length > 0);
  }
});

test("every scenario maps to at least one executable test that exists in the repository", async () => {
  const scenarios = listAcceptanceScenarios();
  const titlesByFile = new Map<string, Set<string>>();
  for (const scenario of scenarios) {
    for (const ref of scenario.tests) {
      let titles = titlesByFile.get(ref.file);
      if (titles === undefined) {
        const source = await readFile(path.join(packageRoot, ref.file), "utf8");
        titles = testTitles(source);
        titlesByFile.set(ref.file, titles);
      }
      assert.equal(
        titles.has(ref.title),
        true,
        `scenario ${scenario.id} missing ${ref.file} test "${ref.title}"`,
      );
    }
  }
});

test("scenario statements match specification section 26 with no gaps", async () => {
  const scenarios = listAcceptanceScenarios();
  const statements = specStatements(
    await readFile(path.join(packageRoot, "kk-dev-final-spec.md"), "utf8"),
  );
  assert.equal(statements.size, 41);
  for (const scenario of scenarios) {
    assert.equal(statements.get(scenario.id), scenario.statement);
  }
});
