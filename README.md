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

The installed command matches `exoframe --help`:

```text
exoframe run <task text>
exoframe status [task-id]
exoframe explain [task-id]
exoframe resume <task-id>
exoframe evidence show <gate-id>
exoframe gate run --task <task-id> --gate <gate-id>
exoframe surfaces explain <path>
exoframe policy check
exoframe risk-bootstrap
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

A Protected Acceptance Contract locks observable meaning before implementation.
Intended red is a named outcome that fails on a PAC-only overlay of the base
tree, never on candidate production files, crash, timeout, or import error. The
same locked contract must then pass on the candidate.

Gate selection is a pure function of base policy, risk, surfaces, contracts,
and delivery metadata. Identical inputs produce the same G0–G9 plan. R2 and R3
keep mapped hypotheses and require an independent verifier; a proposal cannot
drop those hypotheses from the plan.

When G2 is required, a distinct acceptance author writes only PAC and probe
artifacts and cannot become the implementer for that task. R0 and
behavior-preserving work without a new acceptance claim do not dispatch that
role. Independent-verifier prose stays advisory until the protected runner
measures an accepted harness. An R2/R3 implementer cannot re-lock the oracle.

The adapter inspects installed public pstack capabilities read-only. A missing
required capability fails with an actionable error and never patches pstack.

A pstack assignment is a translation of intent, risk, surfaces, contracts, and
gates into the bounded adapter contract. It names writable scope and required
verification IDs, sets `secrets: none`, and does not include goals, recipes, or
secret values. Pstack remains unmodified.

Pstack may plan, implement, test, and return observations, including YAML or
prose that says `PASS`. Collected candidate output stays advisory: it cannot
write `authoritative: true` or satisfy a required gate.

A failed or flaky gate creates a minimal bounce back to pstack that reruns only
affected gates. Three equivalent failure fingerprints produce one human packet
instead of another bounce. Review-requested changes also return to pstack and
replay the affected protected gates.

Browser, CLI, and runtime-control tools are granted only when those capability
IDs are declared in the public pstack support list. Screenshots and other
pstack-produced files stay advisory until the protected runner binds them.

GitHub provider state is accepted only from an authenticated GitHub actor.
An agent cannot invent merge completion; a merged SHA is present only when
GitHub reports the pull request as merged.

The first coherent candidate creates a draft pull request. Later candidates
update that same draft. Exoframe publishes `exoframe/engineering` and
`exoframe/merge-ready` checks. A pull request or green engineering check does
not complete the run.

Required GitHub reviews, CODEOWNERS, and stale approvals keep the run in
`WAITING_FOR_REVIEW` without an active agent. Review-requested changes return
to pstack. Zero required reviewers still wait in `WAITING_FOR_MERGE` while
policy remains `human_merge`.

G7 binds either a queue-generated commit SHA or the non-queue tuple of base
SHA, head SHA, merge method, and candidate tree. A change makes that identity
stale. After a non-queue land, the landed tree must match; a mismatch fails
closed. G7 failure returns to pstack.

Eligible promoted R0/R1 work may enable GitHub auto-merge. R2/R3 work and
tasks with a live exception stay in `human_merge`. A trust-boundary failure
or severity-1/2 escape disables auto-merge. An agent never merges.

G8 observes the released commit, environment, route, and declared health.
No delivery target makes G8 not applicable. A SHA or environment mismatch
fails G8. Exoframe does not deploy.

An unhealthy delivery requires observed rollback and a distinct linked repair
run. The original run waits in `WAITING_FOR_REPAIR` and is not DONE. When the
repair is delivered, the original run returns to delivery verification.

An escaped defect after DONE opens a linked learning run. G9 passes only when
a durable fix exists, the preserved defective snapshot fails, the repaired
snapshot passes, and the missed gate and risk are recorded.

A candidate that changes runner or policy is judged by the accepted base and
cannot pass itself. Scope expansion inside an affected surface is automatic;
unknown production is provisional R2; trust-boundary expansion needs approval.
Secrets are redacted before storage. Oversized, unallowlisted, or escaping
artifacts are rejected without leaking their content.

Evidence expires after its retention window and expired bodies are not kept.
Authenticated control-plane writers may append audit records; agents cannot
rewrite them. Active human time, cycle time, flake, escape, and autonomy
metrics are recorded rather than invented as zero. An emergency kill switch,
a trust-boundary failure, or a severity-1/2 escape disables R0/R1 auto-merge
for the affected scope.

A representative-task evaluation bank must pass before a staged production
rollout may advance. Rollout moves one healthy stage at a time from canary to
subset to production and cannot skip. Demotion rehearsal decreases autonomy
when quality worsens and does not mutate production.

All 41 specification acceptance scenarios map to executable tests. The ledger
names each owning slice; the scenario map names the tests.

A clear task is demonstrated through pstack assignment, a draft pull request,
GitHub merge, and healthy G8. A pull request and green engineering check do
not complete the run. Pstack PASS is not authoritative and an agent never
merges.

State is stored outside the candidate checkout by default, under the current
user's `~/.exoframe/state/workspaces/` control-plane directory. Each Git
checkout uses a key derived from its canonical root and filesystem identity, so
commands run from its subdirectories or path aliases share state while a new
checkout at a reused path does not inherit old runs. The Git marker's identity
also distinguishes a repository reinitialized in place. Outside Git, the
canonical working directory is the boundary. Set `EXOFRAME_STATE_ROOT` to an
explicit directory when the caller needs a different isolated or externally
managed state location.
