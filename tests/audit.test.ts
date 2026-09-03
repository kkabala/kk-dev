import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { runCli } from "../src/cli.ts";
import { DOCUMENTED_COMMANDS, evaluateAudit } from "../src/index.ts";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));

async function captureHelp(): Promise<string> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCode = await runCli(["--help"], {
    error(message) {
      stderr.push(message);
    },
    log(message) {
      stdout.push(message);
    },
  });
  const helpText = stdout[0];
  if (
    exitCode !== 0 ||
    stderr.length !== 0 ||
    stdout.length !== 1 ||
    helpText === undefined
  ) {
    throw new Error("CLI help was not captured");
  }
  return helpText;
}

const documentedReadme = [
  "# Exoframe",
  "",
  ...DOCUMENTED_COMMANDS,
  "",
].join("\n");

function audit(overrides: Record<string, unknown> = {}) {
  return evaluateAudit({
    documentation: {
      readme: documentedReadme,
      help_text: documentedReadme,
    },
    security: {
      pstack_modified: false,
      adapter_only: true,
      candidate_authoritative: false,
      agent_direct_merge: false,
    },
    recovery: {
      restart_preserves_run: true,
      dead_lock_recovered: true,
    },
    ...overrides,
  });
}

test("documentation explains the run before implementation detail and matches CLI help", async () => {
  const readme = await readFile(path.join(packageRoot, "README.md"), "utf8");
  const helpText = await captureHelp();
  const result = evaluateAudit({
    documentation: {
      readme,
      help_text: helpText,
    },
    security: {
      pstack_modified: false,
      adapter_only: true,
      candidate_authoritative: false,
      agent_direct_merge: false,
    },
    recovery: {
      restart_preserves_run: true,
      dead_lock_recovered: true,
    },
  });
  assert.equal(result.documentation_ok, true);
  assert.equal(result.audit_complete, true);
  assert.equal(result.run_complete, false);
  for (const command of DOCUMENTED_COMMANDS) {
    assert.equal(readme.includes(command), true, command);
    assert.equal(helpText.includes(command), true, command);
  }
});

test("pstack remains unmodified and is accessed only through the Exoframe adapter", () => {
  const ok = audit();
  assert.equal(ok.pstack_unmodified, true);
  assert.equal(ok.adapter_only, true);
  assert.equal(ok.audit_complete, true);

  const patched = audit({
    security: {
      pstack_modified: true,
      adapter_only: true,
      candidate_authoritative: false,
      agent_direct_merge: false,
    },
  });
  assert.equal(patched.pstack_unmodified, false);
  assert.equal(patched.audit_complete, false);

  const bypass = audit({
    security: {
      pstack_modified: false,
      adapter_only: false,
      candidate_authoritative: false,
      agent_direct_merge: false,
    },
  });
  assert.equal(bypass.adapter_only, false);
  assert.equal(bypass.audit_complete, false);
});

test("agents cannot create authoritative PASS or merge; recovery stays fail-closed", () => {
  const pass = audit({
    security: {
      pstack_modified: false,
      adapter_only: true,
      candidate_authoritative: true,
      agent_direct_merge: false,
    },
  });
  assert.equal(pass.agent_cannot_pass_or_merge, false);
  assert.equal(pass.audit_complete, false);

  const merge = audit({
    security: {
      pstack_modified: false,
      adapter_only: true,
      candidate_authoritative: false,
      agent_direct_merge: true,
    },
  });
  assert.equal(merge.agent_cannot_pass_or_merge, false);
  assert.equal(merge.audit_complete, false);

  const deadLock = audit({
    recovery: {
      restart_preserves_run: true,
      dead_lock_recovered: false,
    },
  });
  assert.equal(deadLock.recovery_ok, false);
  assert.equal(deadLock.audit_complete, false);

  const restart = audit({
    recovery: {
      restart_preserves_run: false,
      dead_lock_recovered: true,
    },
  });
  assert.equal(restart.recovery_ok, false);
  assert.equal(restart.audit_complete, false);
});
