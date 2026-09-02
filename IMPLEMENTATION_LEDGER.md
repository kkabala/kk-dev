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

`S3.3 — Implement PAC schema, digests, locking, and intended-red overlay`

## Task ledger

| ID | Slice | Status | Acceptance evidence | Review / commit |
|---|---|---|---|---|
| L0.1 | Bootstrap the implementation ledger | DONE | Full MVP slice audit; scenarios 1–41 have owners | `GR-20260831-L0.1-R2`; `3c0d8a8` |
| D0.1 | Rewrite the final specification around Exoframe | DONE | Markdown/link checks; Mermaid 11.16.0 render | Grok `ACCEPT`; `de07a1b` |
| D0.2 | Separate post-MVP provider/plugin design | DONE | Linked companion document; scope audit | Grok `ACCEPT`; `de07a1b` |
| S0.1 | Create Node/TypeScript project and test scaffold | DONE | RED: missing `src/index`; GREEN: `npm run check` | `GR-20260831-S0.1-R1`; `dd945cd` |
| S0.2 | Add Exoframe CLI entry point and package metadata | DONE | RED: missing `src/cli`; GREEN: four tests and built help smoke | `GR-20260831-S0.2-R1`; `1bb2cdd` |
| D0.3 | Clarify automatic run preparation and post-MVP integration profiles | DONE | terminology and cross-document scope audit; `npm run check`; balanced fences | `GR-20260901-D0.3-R1`; `4d9f237` |
| S0.3 | Record Retemper reuse/provenance policy and pstack boundary | DONE | RED: empty license; GREEN: 10 licensing tests, full `npm run check`, isolated clean/stale-output package with exactly 16 artifacts, and boolean/array bundle probes | `GR-20260901-S0.3-R1`; `29b7bd7` |
| S0.4 | Characterize installed pstack capabilities and capture baseline human-time/flake/escape/cost metrics | DONE | RED→GREEN across four hardening bounces; 21 characterization tests, full `npm run check` with 35 tests, exact installed-manifest replay, and unchanged 16-artifact package | `GR-20260901-S0.4-R1`; `6f30846` |
| S1.1 | Define task, intent, decision-packet, and run-state types | DONE | RED→GREEN across four hardening bounces; 5 domain tests, full `npm run check` with 40 tests, strict installed-package TypeScript/JavaScript consumers, and exact 19-artifact package | `GR-20260901-S1.1-R1`; `c4f3474` |
| S1.2 | Implement deterministic run-state transitions and result precedence | DONE | RED→GREEN across five hardening bounces; 9 transition/precedence tests, full `npm run check` with 49 tests, exhaustive installed-package transition and 5,910-case precedence replay, and exact 22-artifact package | `GR-20260901-S1.2-R1`; `d4b3543` |
| S1.3 | Persist and reload run state atomically | DONE | RED→GREEN across ten hardening cycles; 15 persistence tests, full `npm run check` with 64 tests, installed 24/28-writer and dead-owner recovery replays, and exact 25-artifact package | `GR-20260901-S1.3-R1`; `a30215b` |
| S1.4 | Implement `run`, `status`, `resume`, and `explain` CLI flow | DONE | RED→GREEN across eleven hardening cycles and downstream returns, including the STORAGE HIGH `stage()` check-then-act race; 20 CLI, 7 catalog, and exact-initialization tests; full `npm run check` with 92 tests; exact 28-artifact installed package; workspace, hostile-storage, residual-journal, phase-race, concurrent creator/recovery, and exclusive-staging-across-commit replays | `GR-20260902-S1.4-R2`; `3796f41` |
| S1.5 | Implement automatic repository discovery and intake decisions | DONE | RED→GREEN: 22 CLI, 4 intake, and 1 preparation-store tests; clear task normalizes intent without asking for repository facts; ambiguity emits one packet and stays `WAITING_FOR_INTAKE_DECISION`; full `npm run check` with 99 tests; exact 34-artifact installed package | `GR-20260902-S1.5-R1`; `b24190c` |
| S2.1 | Define protected gate-template schema and resolver | DONE | RED→GREEN: 4 gate-template tests; protected argv schema; raw command text and caller argv cannot resolve a protected command; full `npm run check` with 103 tests; exact 37-artifact installed package | `GR-20260902-S2.1-R1`; `92ac961` |
| S2.2 | Implement evidence-key canonicalization | DONE | RED→GREEN: 5 evidence-key tests; golden canonical vectors; hostname/timestamp excluded; uncertain selection yields no key; full `npm run check` with 108 tests; exact 40-artifact installed package | `GR-20260902-S2.2-R1`; `6d88ad6` |
| S2.3 | Implement append-only evidence store, reuse, and FLAKY history | DONE | RED→GREEN: 5 evidence-store tests; immutable/idempotent append; exact-key reuse without rewrite; uncertain/mismatched keys cannot satisfy; mixed outcomes sticky FLAKY; full `npm run check` with 113 tests; exact 43-artifact installed package | `GR-20260902-S2.3-R1`; `4683c45` |
| S2.4 | Implement runner attempt parsing, retries, redaction, and artifact policy | DONE | RED→GREEN across R1–R2 REJECT: INFRA_ERROR only from sandbox/execute/null exit; completed-process garbage stdout is PRODUCT_FAIL not retries; 5 protected-runner tests; secrets redacted before hash; unbound screenshots/video stay advisory; symlink/escape/oversize fail the gate; two exhausted infra retries produce BLOCKED not a bounce; raw commands rejected; full `npm run check` with 118 tests; exact 46-artifact installed package | `GR-20260902-S2.4-R3`; `f7a0636` |
| S2.5 | Implement pure evaluator and engineering-status precedence | DONE | RED→GREEN across R1 REJECT: timeout displaces PASS; exception does not rewrite FAIL; gate id matches evidence key; 8 evaluator tests; full `npm run check` with 126 tests; exact 49-artifact installed package | `GR-20260902-S2.5-R2`; `055418a` |
| S2.6 | Implement accepted-gap and override lifecycle | DONE | RED→GREEN: 4 exception tests; cannot cover G0/G2/G7/G8/FLAKY/trust-boundary; override needs independent approver and matching evidence key; approved+compensating is live HUMAN_MERGE without rewriting FAIL; rejection/expiry/missing compensation returns to verification; full `npm run check` with 130 tests; exact 52-artifact installed package | `GR-20260902-S2.6-R1`; `47250e4` |
| S2.7 | Implement protected `gate run` and advisory `evidence show` CLI | DONE | RED→GREEN: 3 gate CLI tests plus help/malformed updates; `--cmd`/caller argv cannot create evidence; `gate run` looks up a protected template by gate ID and writes authoritative measurements; `evidence show` is advisory and does not append; full `npm run check` with 133 tests; exact 52-artifact installed package | `GR-20260902-S2.7-R1`; `b7a0618` |
| S3.1 | Define path categories and surface catalog | DONE | RED→GREEN across R1 REJECT: provisional ids are digest-stable for any production path charset; 3 surface tests; untracked_ok docs vs uncertain production; unmatched production is provisional R2; proposal cannot drop hypotheses/coverage; full `npm run check` with 136 tests; exact 55-artifact installed package | `GR-20260902-S3.1-R2`; `c3c9d74` |
| S3.2 | Implement fail-up risk classification | DONE | RED→GREEN: 2 risk tests; R0–R3 decision table; untracked_ok remains R0; unknown production R2; control-plane and trust-boundary R3; agent cannot lower a computed tier; full `npm run check` with 138 tests; exact 58-artifact installed package | `GR-20260902-S3.2-R1`; `6302df5` |
| S3.3 | Implement PAC schema, digests, locking, and intended-red overlay | AWAITING_REVIEW | RED→GREEN: 3 PAC tests; lockPac freezes semantic/oracle digests at the base SHA; intended-red overlay is PAC-only and excludes candidate production; named-outcome fail on base is accepted while crash/timeout/import/unrelated/setup-fail return to author and already-green/infra do not assign pstack; the same locked PAC greens on the candidate; full `npm run check` with 141 tests; exact 61-artifact installed package | `GR-20260902-S3.3-R1`; pending commit |
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
| `dd945cd` | S0.1 Node/TypeScript project and test scaffold | `npm run check`; npm audit | `ACCEPT` (`GR-20260831-S0.1-R1`) |
| `1bb2cdd` | S0.2 CLI entry point and package metadata | `npm run check`; built CLI smoke; package-consumer typecheck | `ACCEPT` (`GR-20260831-S0.2-R1`) |
| `4d9f237` | D0.3 automatic preparation and integration-profile clarification | terminology and cross-document scope audit; `npm run check`; balanced fences | `ACCEPT` (`GR-20260901-D0.3-R1`) |
| `29b7bd7` | S0.3 Retemper provenance policy and pstack boundary | earlier cycle found stale-`dist` and boolean bundle gaps; resumed cycle 4 fixed them; 10 licensing tests, full `npm run check`, isolated clean/stale-output package with exactly 16 artifacts, and boolean/array bundle probes are green | `ACCEPT` (`GR-20260901-S0.3-R1`) |
| `6f30846` | S0.4 pstack compatibility characterization and baseline | four hardening bounces closed symlink confinement, prototype-key, false-positive compatibility, manifest-binding, metric-cohort, and npm-reproduction gaps; 21 characterization tests, 35 full-suite tests, exact installed-manifest replay, and 16-artifact package are green | `ACCEPT` (`GR-20260901-S0.4-R1`) |
| `c4f3474` | S1.1 core task, intent, decision-packet, digest, and run-state domain types | four hardening bounces closed run-state structural overlap, packet correlation/narrowing, aliased excess-property, digest-format/coercion, and empty-evidence gaps; 5 domain tests, 40 full-suite tests, strict installed-package consumers, and 19-artifact package are green | `ACCEPT` (`GR-20260901-S1.1-R1`) |
| `d4b3543` | S1.2 deterministic run-state transitions and engineering-result precedence | five hardening bounces closed accepted-gap ordering, malformed-JavaScript readiness, accessor TOCTOU, sparse/overridden traversal, and cross-mutation gaps; 9 focused tests, 49 full-suite tests, exhaustive installed-package transition/precedence replay, and 22-artifact package are green | `ACCEPT` (`GR-20260901-S1.2-R1`) |
| `a30215b` | S1.3 atomic run-state persistence and restart recovery | ten hardening cycles closed atomicity, lock ownership/recovery, namespace, platform, immutable identity, call-boundary capture, and high-contention livelock gaps; 15 focused tests, 64 full-suite tests, installed 24/28-writer replays, and 25-artifact package are green | `ACCEPT` (`GR-20260901-S1.3-R1`) |
| `3796f41` | S1.4 run, status, resume, and explain CLI with durable catalog | eleven hardening cycles closed workspace identity, residual-journal recovery, phase-race reconciliation, concurrent creator/recovery, and `stage()`/`commit` TOCTOU; 20 CLI and 7 catalog tests, 92 full-suite tests, and the 28-artifact package are green | `ACCEPT` (`GR-20260902-S1.4-R2`) |
| `b24190c` | S1.5 automatic repository discovery and intake decisions | clear tasks normalize intent without asking for repository facts; blocking product choices emit one packet and wait; 22 CLI, 4 intake, and 1 preparation-store tests, 99 full-suite tests, and the 34-artifact package are green | `ACCEPT` (`GR-20260902-S1.5-R1`) |
| `92ac961` | S2.1 protected gate-template schema and resolver | argv templates resolve by gate ID; raw command text and caller argv cannot mint a protected command; 4 gate-template tests, 103 full-suite tests, and the 37-artifact package are green | `ACCEPT` (`GR-20260902-S2.1-R1`) |
| `6d88ad6` | S2.2 evidence-key canonicalization | golden input/environment vectors; hostname/timestamp excluded; uncertain selection is not reusable; 5 evidence-key tests, 108 full-suite tests, and the 40-artifact package are green | `ACCEPT` (`GR-20260902-S2.2-R1`) |
| `4683c45` | S2.3 append-only evidence store, reuse, and FLAKY history | immutable/idempotent append; exact-key reuse without rewrite; mixed product outcomes stay FLAKY; 5 evidence-store tests, 113 full-suite tests, and the 43-artifact package are green | `ACCEPT` (`GR-20260902-S2.3-R1`) |
| `f7a0636` | S2.4 runner attempt parsing, retries, redaction, and artifact policy | R1/R2 closed stdout-minted infra retries; secrets redacted before hash; unbound screenshots stay advisory; two exhausted infra retries are BLOCKED not a bounce; 5 protected-runner tests, 118 full-suite tests, and the 46-artifact package are green | `ACCEPT` (`GR-20260902-S2.4-R3`) |
| `055418a` | S2.5 pure evaluator and engineering-status precedence | same measurements yield the same status; advisory prose cannot PASS; timeout displaces PASS; exceptions do not rewrite FAIL; 8 evaluator tests, 126 full-suite tests, and the 49-artifact package are green | `ACCEPT` (`GR-20260902-S2.5-R2`) |
| `47250e4` | S2.6 accepted-gap and override lifecycle | cannot cover G0/G2/G7/G8/FLAKY/trust-boundary; override needs independent approver; approved+compensating is live human_merge without rewriting FAIL; rejection/expiry/missing compensation returns to verification; 4 exception tests, 130 full-suite tests, and the 52-artifact package are green | `ACCEPT` (`GR-20260902-S2.6-R1`) |
| `b7a0618` | S2.7 protected gate run and advisory evidence show CLI | `--cmd`/caller argv cannot create evidence; gate run looks up a protected template and writes authoritative measurements; evidence show is advisory and does not append; 3 gate CLI tests, 133 full-suite tests, and the 52-artifact package are green | `ACCEPT` (`GR-20260902-S2.7-R1`) |
| `c3c9d74` | S3.1 path categories and surface catalog | R1 closed raw-path provisional ids; untracked_ok docs vs uncertain production; unmatched production is provisional R2; proposals cannot drop hypotheses or coverage; 3 surface tests, 136 full-suite tests, and the 55-artifact package are green | `ACCEPT` (`GR-20260902-S3.1-R2`) |
| `6302df5` | S3.2 fail-up risk classification | R0–R3 decision table; untracked_ok remains R0; unknown production R2; control-plane and trust-boundary R3; agent cannot lower a computed tier; 2 risk tests, 138 full-suite tests, and the 58-artifact package are green | `ACCEPT` (`GR-20260902-S3.2-R1`) |
