# Exoframe

Exoframe is an autonomous delivery control plane around the unchanged
third-party pstack/poteto-mode implementation engine.

The MVP is being implemented from [the final specification](./kk-dev-final-spec.md).
Progress and pre-commit Grok reviews are recorded in
[the implementation ledger](./IMPLEMENTATION_LEDGER.md).

Exoframe is available under the [MIT License](./LICENSE.md). Its Retemper source
provenance rules and the unchanged pstack/poteto-mode boundary are recorded in
[source-provenance and third-party notices](./THIRD_PARTY_NOTICES.md).

## Development

Requirements: Node.js 22.18 or newer.

```bash
npm ci
npm run check
```

Build and inspect the CLI:

```bash
npm run build
node dist/bin.js --help
```

## Stage 1 CLI

Start a direct-text task and inspect its durable run:

```bash
node dist/bin.js run "Add CSV export to the orders page"
node dist/bin.js status
node dist/bin.js status <task-id>
node dist/bin.js explain <task-id>
node dist/bin.js resume <task-id>
node dist/bin.js evidence show <gate-id>
node dist/bin.js gate run --task <task-id> --gate <gate-id>
```

`run` emits the new task, its durable checkpoint, and the automatic intake
result as JSON. A clear requested outcome normalizes into intent and remains
`INTAKE`. A blocking product choice emits one decision packet and moves the run
to `WAITING_FOR_INTAKE_DECISION`. `status` emits the same durable task/run view,
while `explain` renders the current state and next action for a person. `resume`
reloads a non-completed checkpoint and continues unfinished intake without
starting implementation; later slices add automatic gates and pstack assignment.

Protected gate templates are looked up by gate ID from the accepted base
catalog. Authoritative commands are argv arrays captured from those templates;
raw command text and caller-supplied argv cannot create a protected command.

Evidence keys are canonical tuples of gate ID, template digest, input digest,
environment digest, and oracle digest when required. The same selected tree,
artifacts, and runner profile produce the same key; hostname and timestamp do
not. Uncertain dependency selection does not yield a reusable key.

Authoritative measurements are appended once and never rewritten. Exact-key
reuse records a decision beside the original body; mixed product outcomes for
one key become FLAKY, and retrying until green cannot clear them.

The protected runner parses structured output into a runner attempt, redacts
secrets, and hashes the redacted bytes before append. Sandbox and runner
failures are `INFRA_ERROR` and retry twice by default, then become `BLOCKED`
rather than a product bounce. Screenshots and video without runner and commit
provenance remain advisory; symlink escapes, writes outside sandbox roots, and
oversized artifacts fail the gate.

The evaluator is a pure function over required gates, measurements, GitHub
state, and time. Advisory PASS and agent prose cannot satisfy a gate;
authoritative FAIL wins; missing or mismatched evidence is never PASS.

Accepted gaps and overrides are narrow, expiring, and independently approved
where required. They never relabel a failed gate as PASS, always force
`human_merge`, and need compensating evidence. Rejection, expiry, or missing
compensation returns the run to verification.

Changed paths are classified by base policy. Declared documentation may stay
non-production; uncertain paths fail upward to production treatment. Unknown
production code receives provisional R2 coverage. A proposal may add coverage
or raise risk, but it cannot drop hypotheses, paths, or a risk floor.

Risk fails upward from R0 to R3. Declared documentation may remain R0,
ordinary local behavior may remain R1, unknown production is at least R2,
and control-plane or trust-boundary changes are R3. An implementation agent
cannot lower a computed tier.

State is stored outside the candidate checkout by default, under the current
user's `~/.exoframe/state/workspaces/` control-plane directory. Each Git
checkout uses a key derived from its canonical root and filesystem identity, so
commands run from its subdirectories or path aliases share state while a new
checkout at a reused path does not inherit old runs. The Git marker's identity
also distinguishes a repository reinitialized in place. Outside Git, the
canonical working directory is the boundary. Set `EXOFRAME_STATE_ROOT` to an
explicit directory when the caller needs a different isolated or externally
managed state location.
