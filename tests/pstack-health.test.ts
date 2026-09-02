import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { checkPstackHealth } from "../src/index.ts";

const contract = {
  schema_version: 1 as const,
  implementation_engine: "pstack",
  reference: {
    name: "pstack",
    version: "0.14.5",
  },
  accepted_manifest_paths: [".cursor-plugin/plugin.json"],
  required_capability_ids: ["engine.pstack", "skills.poteto-mode", "agents.poteto-agent"],
};

async function digestTree(root: string): Promise<string> {
  const entries: string[] = [];
  async function visit(current: string): Promise<void> {
    const listing = await readdir(current, { withFileTypes: true });
    listing.sort((left, right) => (left.name < right.name ? -1 : 1));
    for (const entry of listing) {
      const full = path.join(current, entry.name);
      const relative = path.relative(root, full);
      if (entry.isDirectory()) {
        entries.push(`dir:${relative}`);
        await visit(full);
        continue;
      }
      const bytes = await readFile(full);
      entries.push(
        `file:${relative}:${createHash("sha256").update(bytes).digest("hex")}`,
      );
    }
  }
  await visit(root);
  return createHash("sha256").update(entries.join("\n")).digest("hex");
}

async function writeCompatiblePlugin(pluginRoot: string): Promise<void> {
  await mkdir(path.join(pluginRoot, ".cursor-plugin"), { recursive: true });
  await writeFile(
    path.join(pluginRoot, ".cursor-plugin", "plugin.json"),
    `${JSON.stringify({
      name: "pstack",
      version: "0.14.5",
      skills: "./skills/",
      agents: "./agents/",
      hooks: "./hooks/preflight.mjs",
    })}\n`,
  );
  await mkdir(path.join(pluginRoot, "skills", "poteto-mode"), { recursive: true });
  await mkdir(path.join(pluginRoot, "skills", "how"), { recursive: true });
  await writeFile(
    path.join(pluginRoot, "skills", "poteto-mode", "SKILL.md"),
    "advisory skill text\n",
  );
  await writeFile(path.join(pluginRoot, "skills", "how", "SKILL.md"), "how\n");
  await mkdir(path.join(pluginRoot, "agents"), { recursive: true });
  await writeFile(
    path.join(pluginRoot, "agents", "poteto-agent.md"),
    "advisory agent text\n",
  );
  await writeFile(path.join(pluginRoot, "agents", "reviewer.md"), "reviewer\n");
  await mkdir(path.join(pluginRoot, "hooks"), { recursive: true });
  await writeFile(
    path.join(pluginRoot, "hooks", "preflight.mjs"),
    'import { writeFileSync } from "node:fs";\nwriteFileSync(new URL("../executed.txt", import.meta.url), "executed\\n");\n',
  );
}

test("a compatible public pstack manifest reports supported capabilities without mutation", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "exoframe-s41-ok-"));
  context.after(async () => rm(root, { force: true, recursive: true }));
  const pluginRoot = path.join(root, "plugin");
  await writeCompatiblePlugin(pluginRoot);
  const before = await digestTree(pluginRoot);

  const health = await checkPstackHealth({
    contract,
    plugin_root: pluginRoot,
  });

  assert.equal(health.schema_version, 1);
  assert.deepEqual(health.engine, { name: "pstack", version: "0.14.5" });
  assert.deepEqual(health.supported_capability_ids, [
    "agents.poteto-agent",
    "agents.reviewer",
    "engine.pstack",
    "skills.how",
    "skills.poteto-mode",
  ]);
  assert.equal(await digestTree(pluginRoot), before);
  await assert.rejects(access(path.join(pluginRoot, "executed.txt")), {
    code: "ENOENT",
  });
});

test("a missing required pstack capability fails with an actionable adapter error and does not patch pstack", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "exoframe-s41-missing-"));
  context.after(async () => rm(root, { force: true, recursive: true }));
  const pluginRoot = path.join(root, "plugin");
  await writeCompatiblePlugin(pluginRoot);
  await rm(path.join(pluginRoot, "skills", "poteto-mode", "SKILL.md"));
  const before = await digestTree(pluginRoot);

  await assert.rejects(
    () =>
      checkPstackHealth({
        contract,
        plugin_root: pluginRoot,
      }),
    {
      name: "TypeError",
      message: "Missing required pstack capability: skills.poteto-mode",
    },
  );
  assert.equal(await digestTree(pluginRoot), before);
  await assert.rejects(access(path.join(pluginRoot, "executed.txt")), {
    code: "ENOENT",
  });
});

test("an unmatched engine identity is a missing required capability and does not patch pstack", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "exoframe-s41-engine-"));
  context.after(async () => rm(root, { force: true, recursive: true }));
  const pluginRoot = path.join(root, "plugin");
  await writeCompatiblePlugin(pluginRoot);
  await writeFile(
    path.join(pluginRoot, ".cursor-plugin", "plugin.json"),
    `${JSON.stringify({
      name: "pstack",
      version: "0.14.6",
      skills: "./skills/",
      agents: "./agents/",
    })}\n`,
  );
  const before = await digestTree(pluginRoot);
  const metadata = await stat(path.join(pluginRoot, ".cursor-plugin", "plugin.json"));
  assert.equal(metadata.isFile(), true);

  await assert.rejects(
    () =>
      checkPstackHealth({
        contract,
        plugin_root: pluginRoot,
      }),
    {
      name: "TypeError",
      message: "Missing required pstack capability: engine.pstack",
    },
  );
  assert.equal(await digestTree(pluginRoot), before);
});
