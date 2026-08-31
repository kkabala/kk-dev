# Exoframe Implementation Ledger

This ledger is the authoritative implementation checklist for `kk-dev-final-spec.md`.

## Status legend

- `NOT_STARTED` — no implementation work has begun.
- `IN_PROGRESS` — the task is the current coherent slice.
- `AWAITING_REVIEW` — implementation and local evidence are complete; the exact diff is awaiting Grok's pre-commit verdict.
- `BLOCKED` — progress requires an external decision or unavailable dependency.
- `DONE` — acceptance evidence passed, Grok reviewed the exact change, and the change was committed.

## Working rules

1. Work on one small coherent slice at a time.
2. Write or update executable acceptance coverage before production behavior when the slice changes behavior.
3. Run the narrow tests first, followed by every applicable repository gate.
4. Set the slice to `AWAITING_REVIEW`, allocate a unique review ID, and send the exact uncommitted diff and test evidence to Grok.
5. Do not change the reviewed files after Grok returns `ACCEPT`; any correction requires a new review ID and another review.
6. Commit only after acceptance. Include `Task`, `Grok-Review`, and `Grok-Verdict` trailers in the commit message.
7. In the next reviewed ledger update, replace the pending commit reference with the actual SHA and mark the slice `DONE`.
8. Do not mark the full project complete until every MVP acceptance scenario is covered and the end-to-end audit passes.

## Current milestone

`S0.1 — Project and test scaffold (awaiting review)`

## Task ledger

| ID | Slice | Status | Acceptance evidence | Review / commit |
|---|---|---|---|---|
| L0.1 | Bootstrap the implementation ledger | DONE | Full MVP slice audit; scenarios 1–41 have owners | `GR-20260831-L0.1-R2`; `3c0d8a8` |
| D0.1 | Rewrite the final specification around Exoframe | DONE | Markdown/link checks; Mermaid 11.16.0 render | Grok `ACCEPT`; `de07a1b` |
| D0.2 | Separate post-MVP provider/plugin design | DONE | Linked companion document; scope audit | Grok `ACCEPT`; `de07a1b` |
| S0.1 | Create Node/TypeScript project and test scaffold | AWAITING_REVIEW | RED: missing `src/index`; GREEN: `npm run check` | `GR-20260831-S0.1-R1`; commit pending |
| S0.2 | Add Exoframe CLI entry point and package metadata | NOT_STARTED | CLI help smoke test | pending |
| S0.3 | Record Retemper reuse/attribution policy and pstack boundary | NOT_STARTED | documentation/license assertions | pending |
| S0.4 | Characterize installed pstack capabilities and capture baseline human-time/flake/escape/cost metrics | NOT_STARTED | reproducible characterization report and baseline fixture | pending |
| S1.1 | Define task, intent, decision-packet, and run-state types | NOT_STARTED | schema/type unit tests | pending |
| S1.2 | Implement deterministic run-state transitions and result precedence | NOT_STARTED | transition-table tests | pending |
| S1.3 | Persist and reload run state atomically | NOT_STARTED | restart/recovery tests | pending |
| S1.4 | Implement `run`, `status`, `resume`, and `explain` CLI flow | NOT_STARTED | CLI acceptance tests | pending |
| S1.5 | Implement automatic repository discovery and intake decisions | NOT_STARTED | clear task normalizes intent; ambiguity emits one packet | pending |
| S2.1 | Define protected gate-template schema and resolver | NOT_STARTED | schema and raw-command rejection tests | pending |
| S2.2 | Implement evidence-key canonicalization | NOT_STARTED | golden-vector tests | pending |
| S2.3 | Implement append-only evidence store, reuse, and FLAKY history | NOT_STARTED | immutability/idempotency/reuse/mixed-outcome tests | pending |
| S2.4 | Implement runner attempt parsing, retries, redaction, and artifact policy | NOT_STARTED | runner boundary tests | pending |
| S2.5 | Implement pure evaluator and engineering-status precedence | NOT_STARTED | gate/status algebra tests | pending |
| S2.6 | Implement accepted-gap and override lifecycle | NOT_STARTED | scenarios 27–28; expiry, compensating evidence, forced human merge | pending |
| S2.7 | Implement protected `gate run` and advisory `evidence show` CLI | NOT_STARTED | raw-command rejection and evidence-display tests | pending |
| S3.1 | Define path categories and surface catalog | NOT_STARTED | classification, provisional R2, monotone coverage/hypothesis tests | pending |
| S3.2 | Implement fail-up risk classification | NOT_STARTED | R0–R3 decision-table tests | pending |
| S3.3 | Implement PAC schema, digests, locking, and intended-red overlay | NOT_STARTED | base-overlay/red-green tests | pending |
| S3.4 | Implement deterministic G0–G9 derivation | NOT_STARTED | gate-plan golden tests | pending |
| S3.5 | Implement acceptance-author and independent-verifier boundaries | NOT_STARTED | identity/separation tests | pending |
| S3.6 | Implement `surfaces explain` and `policy check` CLI | NOT_STARTED | explanation and weakening-detection tests | pending |
| S4.1 | Define pstack capability manifest and health check | NOT_STARTED | supported/missing capability tests | pending |
| S4.2 | Implement Exoframe-to-pstack assignment adapter | NOT_STARTED | contract translation tests | pending |
| S4.3 | Collect candidate output without trusting advisory PASS | NOT_STARTED | trust-boundary tests | pending |
| S4.4 | Implement repair bounces and repeated-fingerprint escalation | NOT_STARTED | bounce-loop acceptance tests | pending |
| S4.5 | Integrate declared pstack runtime-control and artifact capabilities | NOT_STARTED | browser/CLI/runtime artifact contract tests | pending |
| S5.1 | Define GitHub provider boundary and authenticated state model | NOT_STARTED | provider contract tests | pending |
| S5.2 | Create/update draft PR and publish Exoframe checks | NOT_STARTED | GitHub adapter tests | pending |
| S5.3 | Implement review, CODEOWNERS, and human-merge waits | NOT_STARTED | governance-state tests | pending |
| S5.4 | Implement queue and non-queue G7 candidate identity | NOT_STARTED | queue/squash/rebase candidate tests | pending |
| S5.5 | Implement R0/R1 promotion, GitHub auto-merge, and demotion | NOT_STARTED | threshold and kill-switch tests | pending |
| S6.1 | Define release/delivery observation boundary and G8 | NOT_STARTED | identity/health tests | pending |
| S6.2 | Implement rollback observation and linked repair runs | NOT_STARTED | unhealthy-delivery acceptance test | pending |
| S6.3 | Implement escaped-defect records and G9 replay | NOT_STARTED | defective-snapshot replay tests | pending |
| S6.4 | Harden scope, secrets, artifacts, and base-judges-candidate policy | NOT_STARTED | security acceptance tests | pending |
| S6.5 | Add retention, audit, metrics, and emergency kill switch | NOT_STARTED | operations tests | pending |
| S6.6 | Build the evaluation bank and staged production rollout controls | NOT_STARTED | representative-task bank and rollout/demotion rehearsal | pending |
| F1.1 | Map all 41 specification scenarios to executable tests | NOT_STARTED | coverage matrix with no gaps | pending |
| F1.2 | Run full end-to-end task → pstack → PR → merge → G8 scenario | NOT_STARTED | protected end-to-end evidence | pending |
| F1.3 | Complete final security, recovery, and documentation audit | NOT_STARTED | all gates green; Grok final acceptance | pending |

## Acceptance-scenario ownership

Every required scenario in specification section 26 has an implementation owner. `F1.1` verifies this mapping; it does not substitute for the owning slice.

| Scenario | Owning slice(s) |
|---:|---|
| 1 | S1.5 |
| 2 | S1.5 |
| 3 | S4.3 |
| 4 | S4.1 |
| 5 | S3.3 |
| 6 | S3.3 |
| 7 | S3.3 |
| 8 | S3.3 |
| 9 | S3.3 |
| 10 | S3.1 |
| 11 | S3.1 |
| 12 | S3.4 |
| 13 | S3.1, S3.4 |
| 14 | S2.1, S2.7 |
| 15 | S6.4 |
| 16 | S2.2, S2.3 |
| 17 | S2.3 |
| 18 | S2.3 |
| 19 | S2.4 |
| 20 | S2.4 |
| 21 | S3.5 |
| 22 | S2.5 |
| 23 | S4.4 |
| 24 | S4.4 |
| 25 | S5.3 |
| 26 | S4.4, S5.3 |
| 27 | S2.6 |
| 28 | S2.6 |
| 29 | S5.2 |
| 30 | S5.3 |
| 31 | S5.5 |
| 32 | S2.6, S5.5 |
| 33 | S5.4 |
| 34 | S5.4 |
| 35 | S5.2, S5.3 |
| 36 | S6.1, S6.2 |
| 37 | S6.3 |
| 38 | S6.4 |
| 39 | S6.4 |
| 40 | S6.4 |
| 41 | S5.5, S6.5 |

## Commit and review log

| Commit | Scope | Tests / validation | Grok verdict |
|---|---|---|---|
| `de07a1b` | Exoframe MVP and post-MVP specifications | Markdown links/fences, `git diff --check`, Mermaid render | `ACCEPT` |
| `3c0d8a8` | L0.1 implementation-ledger bootstrap | Markdown and full-scope ownership audit | `ACCEPT` (`GR-20260831-L0.1-R2`) |
| pending | S0.1 Node/TypeScript project and test scaffold | `npm run check` | awaiting `GR-20260831-S0.1-R1` |
