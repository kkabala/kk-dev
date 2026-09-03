export type ScenarioTestRef = Readonly<{
  file: string;
  title: string;
}>;

export type AcceptanceScenario = Readonly<{
  schema_version: 1;
  id: number;
  statement: string;
  owning_slices: readonly string[];
  tests: readonly ScenarioTestRef[];
}>;

function freezeTests(
  tests: readonly ScenarioTestRef[],
): readonly ScenarioTestRef[] {
  return Object.freeze(tests.map((testRef) => Object.freeze({ ...testRef })));
}

function scenario(
  id: number,
  statement: string,
  owningSlices: readonly string[],
  tests: readonly ScenarioTestRef[],
): AcceptanceScenario {
  return Object.freeze({
    schema_version: 1,
    id,
    statement,
    owning_slices: Object.freeze([...owningSlices]),
    tests: freezeTests(tests),
  });
}

const ACCEPTANCE_SCENARIOS: readonly AcceptanceScenario[] = Object.freeze([
  scenario(
    1,
    "A clear task proceeds from automatic intake to a pstack assignment without asking the user for repository facts.",
    ["S1.5"],
    [
      {
        file: "tests/cli-run.test.ts",
        title:
          "a clear task proceeds through automatic intake without asking for repository facts",
      },
      {
        file: "tests/intake.test.ts",
        title: "a clear task normalizes intent from repository facts",
      },
    ],
  ),
  scenario(
    2,
    "A genuinely ambiguous product requirement produces one batched decision packet and no implementation begins.",
    ["S1.5"],
    [
      {
        file: "tests/cli-run.test.ts",
        title:
          "an ambiguous product requirement emits one packet and does not start implementation",
      },
      {
        file: "tests/intake.test.ts",
        title: "an ambiguous product choice emits one batched decision packet",
      },
    ],
  ),
  scenario(
    3,
    "Pstack may plan, implement, test, and return observations, but no pstack output can create authoritative PASS.",
    ["S4.3"],
    [
      {
        file: "tests/pstack-candidate.test.ts",
        title:
          "pstack may return code, tests, and a PASS claim, but the collected candidate is not authoritative",
      },
      {
        file: "tests/pstack-candidate.test.ts",
        title: "a pstack PASS claim cannot write authoritative evidence",
      },
    ],
  ),
  scenario(
    4,
    "A missing required pstack capability fails with an actionable adapter error and does not patch pstack.",
    ["S4.1"],
    [
      {
        file: "tests/pstack-health.test.ts",
        title:
          "a missing required pstack capability fails with an actionable adapter error and does not patch pstack",
      },
    ],
  ),
  scenario(
    5,
    "A user-visible task cannot proceed to implementation until its PAC produces the named intended red on base.",
    ["S3.3"],
    [
      {
        file: "tests/pac.test.ts",
        title:
          "intended red is named-outcome fail on base; the same PAC must green on the candidate",
      },
    ],
  ),
  scenario(
    6,
    "A crash, timeout, import error, or unrelated assertion does not count as intended red.",
    ["S3.3"],
    [
      {
        file: "tests/pac.test.ts",
        title:
          "intended red is named-outcome fail on base; the same PAC must green on the candidate",
      },
    ],
  ),
  scenario(
    7,
    "The intended-red base tree contains the locked PAC overlay but no candidate production implementation.",
    ["S3.3"],
    [
      {
        file: "tests/pac.test.ts",
        title:
          "intended-red overlay is PAC-only and excludes candidate production",
      },
    ],
  ),
  scenario(
    8,
    "A wrong intended-red failure returns to the acceptance author for correction and re-lock rather than going to pstack.",
    ["S3.3"],
    [
      {
        file: "tests/pac.test.ts",
        title:
          "intended red is named-outcome fail on base; the same PAC must green on the candidate",
      },
    ],
  ),
  scenario(
    9,
    "The same locked PAC must produce green on the candidate.",
    ["S3.3"],
    [
      {
        file: "tests/pac.test.ts",
        title:
          "intended red is named-outcome fail on base; the same PAC must green on the candidate",
      },
    ],
  ),
  scenario(
    10,
    "A declared `untracked_ok` documentation change may remain R0, while an uncertain path fails upward to production treatment.",
    ["S3.1"],
    [
      {
        file: "tests/surfaces.test.ts",
        title:
          "a declared untracked_ok documentation change may remain R0, while an uncertain path is production",
      },
    ],
  ),
  scenario(
    11,
    "Unknown changed production code receives provisional R2 coverage.",
    ["S3.1"],
    [
      {
        file: "tests/surfaces.test.ts",
        title:
          "unknown changed production code receives provisional R2 coverage",
      },
    ],
  ),
  scenario(
    12,
    "Gate derivation is identical for identical base policy, diff, surfaces, contracts, and delivery inputs.",
    ["S3.4"],
    [
      {
        file: "tests/gate-plan.test.ts",
        title:
          "gate derivation is identical for identical policy, surfaces, contracts, and delivery",
      },
    ],
  ),
  scenario(
    13,
    "An R2/R3 hypothesis cannot disappear because an implementation agent edits a proposal.",
    ["S3.1", "S3.4"],
    [
      {
        file: "tests/gate-plan.test.ts",
        title:
          "an R2/R3 hypothesis cannot disappear because an implementation agent edits a proposal",
      },
      {
        file: "tests/surfaces.test.ts",
        title:
          "a proposal cannot drop R2 hypotheses or coverage; additions remain",
      },
    ],
  ),
  scenario(
    14,
    "Raw model-authored commands and caller-provided argv cannot create authoritative evidence.",
    ["S2.1", "S2.7"],
    [
      {
        file: "tests/gate-template.test.ts",
        title:
          "the gate-template schema accepts protected argv definitions and rejects raw command text",
      },
      {
        file: "tests/cli-gate.test.ts",
        title:
          "raw command text and caller argv cannot create authoritative evidence",
      },
    ],
  ),
  scenario(
    15,
    "A PR that changes its runner or policy is judged by the accepted base version and cannot pass itself.",
    ["S6.4"],
    [
      {
        file: "tests/hardening.test.ts",
        title:
          "a PR that changes its runner or policy is judged by the accepted base and cannot pass itself",
      },
    ],
  ),
  scenario(
    16,
    "Evidence for the wrong commit, template, input, environment, or oracle cannot satisfy a gate.",
    ["S2.2", "S2.3"],
    [
      {
        file: "tests/evidence-key.test.ts",
        title:
          "a change to gate, template, input, environment, or oracle produces a new key",
      },
      {
        file: "tests/evidence-store.test.ts",
        title:
          "uncertain selection and mismatched keys cannot satisfy a stored gate",
      },
    ],
  ),
  scenario(
    17,
    "Exact-key reuse succeeds without rerun; uncertain dependency selection becomes stale and reruns.",
    ["S2.3"],
    [
      {
        file: "tests/evidence-store.test.ts",
        title:
          "exact-key reuse succeeds without rewriting the original measurement",
      },
      {
        file: "tests/evidence-key.test.ts",
        title:
          "uncertain dependency selection cannot produce an evidence key",
      },
    ],
  ),
  scenario(
    18,
    "Mixed outcomes for one evidence key become FLAKY and rerun-until-green cannot clear them.",
    ["S2.3"],
    [
      {
        file: "tests/evidence-store.test.ts",
        title:
          "mixed product outcomes are FLAKY and later green cannot clear them",
      },
    ],
  ),
  scenario(
    19,
    "Two exhausted infrastructure retries produce BLOCKED rather than a product bounce.",
    ["S2.4"],
    [
      {
        file: "tests/protected-runner.test.ts",
        title:
          "two exhausted infrastructure retries produce BLOCKED rather than a product bounce",
      },
    ],
  ),
  scenario(
    20,
    "Screenshots or video without runner and commit provenance remain advisory.",
    ["S2.4"],
    [
      {
        file: "tests/protected-runner.test.ts",
        title:
          "screenshots and video without runner and commit provenance remain advisory",
      },
    ],
  ),
  scenario(
    21,
    "Independent-verifier prose or a harness proposal remains advisory until the protected runner measures an accepted harness.",
    ["S3.5"],
    [
      {
        file: "tests/roles.test.ts",
        title:
          "independent-verifier prose stays advisory until the protected runner measures an accepted harness",
      },
    ],
  ),
  scenario(
    22,
    "The specified result-type precedence produces the same engineering status for the same authoritative inputs.",
    ["S2.5"],
    [
      {
        file: "tests/evaluator.test.ts",
        title:
          "the same authoritative measurements produce the same engineering status",
      },
    ],
  ),
  scenario(
    23,
    "A failed gate creates a minimal bounce that returns to pstack and reruns only affected gates.",
    ["S4.4"],
    [
      {
        file: "tests/bounce.test.ts",
        title:
          "a failed gate creates a minimal bounce that reruns only affected gates",
      },
    ],
  ),
  scenario(
    24,
    "Three repeated equivalent failures create one human packet instead of an endless loop.",
    ["S4.4"],
    [
      {
        file: "tests/bounce.test.ts",
        title:
          "three repeated equivalent failures create one human packet instead of another bounce",
      },
    ],
  ),
  scenario(
    25,
    "Waiting for a required review persists the run without keeping an agent active.",
    ["S5.3"],
    [
      {
        file: "tests/github-governance.test.ts",
        title:
          "waiting for a required review persists the run without keeping an agent active",
      },
    ],
  ),
  scenario(
    26,
    "Review-requested changes return to pstack and replay affected protected gates.",
    ["S4.4", "S5.3"],
    [
      {
        file: "tests/bounce.test.ts",
        title:
          "review-requested changes return to pstack and replay affected protected gates",
      },
      {
        file: "tests/github-governance.test.ts",
        title:
          "review-requested changes return to pstack and replay affected protected gates",
      },
    ],
  ),
  scenario(
    27,
    "Exceptions are narrow, expiring, independently approved, and disable automatic merge.",
    ["S2.6"],
    [
      {
        file: "tests/exception.test.ts",
        title:
          "exceptions cannot cover G0, G2, G7, G8, FLAKY evidence, or a trust-boundary failure",
      },
      {
        file: "tests/exception.test.ts",
        title:
          "an override requires an independent approver and never rewrites FAIL to PASS",
      },
    ],
  ),
  scenario(
    28,
    "An approved exception with compensating evidence produces `ENGINEERING_READY_WITH_EXCEPTION`; rejection or expiry returns to verification.",
    ["S2.6"],
    [
      {
        file: "tests/exception.test.ts",
        title:
          "an approved exception with compensating evidence is live and forces human merge",
      },
      {
        file: "tests/exception.test.ts",
        title:
          "rejection, expiry, or missing compensating evidence returns to verification",
      },
    ],
  ),
  scenario(
    29,
    "The first coherent candidate creates or updates a draft GitHub PR automatically.",
    ["S5.2"],
    [
      {
        file: "tests/github-pr.test.ts",
        title:
          "the first coherent candidate creates a draft GitHub pull request",
      },
      {
        file: "tests/github-pr.test.ts",
        title: "a later candidate updates the same draft pull request",
      },
    ],
  ),
  scenario(
    30,
    "Zero GitHub-required reviewers still waits for human merge authorization while policy remains `human_merge`.",
    ["S5.3"],
    [
      {
        file: "tests/github-governance.test.ts",
        title:
          "zero GitHub-required reviewers still waits for human merge authorization",
      },
    ],
  ),
  scenario(
    31,
    "Eligible promoted R0/R1 work is merged by GitHub auto-merge, never by an agent operation.",
    ["S5.5"],
    [
      {
        file: "tests/github-auto-merge.test.ts",
        title:
          "eligible promoted R0/R1 work uses GitHub auto-merge, never an agent operation",
      },
    ],
  ),
  scenario(
    32,
    "R2/R3 and exception-bearing tasks cannot enter automatic merge.",
    ["S2.6", "S5.5"],
    [
      {
        file: "tests/github-auto-merge.test.ts",
        title:
          "R2/R3 and exception-bearing tasks cannot enter automatic merge",
      },
      {
        file: "tests/exception.test.ts",
        title:
          "an approved exception with compensating evidence is live and forces human merge",
      },
    ],
  ),
  scenario(
    33,
    "G7 evaluates an exact queue-generated candidate when a merge queue exists and failure returns to pstack.",
    ["S5.4"],
    [
      {
        file: "tests/github-g7.test.ts",
        title:
          "G7 evaluates an exact queue-generated candidate and failure returns to pstack",
      },
    ],
  ),
  scenario(
    34,
    "Without a queue, G7 binds base SHA, head SHA, merge method, and candidate tree; any change makes it stale and the landed tree must match.",
    ["S5.4"],
    [
      {
        file: "tests/github-g7.test.ts",
        title:
          "without a queue, G7 binds base SHA, head SHA, merge method, and candidate tree",
      },
      {
        file: "tests/github-g7.test.ts",
        title:
          "a changed tuple makes G7 stale and the landed tree must match",
      },
    ],
  ),
  scenario(
    35,
    "The run is not DONE merely because a PR exists or CI is green.",
    ["S5.2", "S5.3"],
    [
      {
        file: "tests/github-pr.test.ts",
        title:
          "a pull request and green engineering check do not complete the run",
      },
    ],
  ),
  scenario(
    36,
    "A healthy expected deployment completes G8; an unhealthy one invokes rollback and a linked repair while the original run waits for that repair's delivery.",
    ["S6.1", "S6.2"],
    [
      {
        file: "tests/delivery.test.ts",
        title: "a healthy expected deployment completes G8",
      },
      {
        file: "tests/delivery-repair.test.ts",
        title: "an unhealthy delivery invokes rollback and a linked repair",
      },
      {
        file: "tests/delivery-repair.test.ts",
        title: "the original run waits for the linked repair delivery",
      },
    ],
  ),
  scenario(
    37,
    "An escaped defect discovered after DONE creates a new linked run and cannot close without replay against the defective snapshot.",
    ["S6.3"],
    [
      {
        file: "tests/g9.test.ts",
        title:
          "an escaped defect after DONE creates a new linked learning run",
      },
      {
        file: "tests/g9.test.ts",
        title:
          "G9 cannot pass unless the defective snapshot fails under the new protection",
      },
    ],
  ),
  scenario(
    38,
    "Scope expansion inside an affected surface is automatic; unknown production becomes provisional R2; trust-boundary expansion needs approval.",
    ["S6.4"],
    [
      {
        file: "tests/hardening.test.ts",
        title:
          "scope expansion inside an affected surface is automatic; unknown production is provisional R2; trust-boundary needs approval",
      },
    ],
  ),
  scenario(
    39,
    "Secrets in parameters, output, observations, or artifacts are redacted before storage.",
    ["S6.4"],
    [
      {
        file: "tests/hardening.test.ts",
        title:
          "secrets are redacted before storage and rejected artifacts do not leak their content",
      },
    ],
  ),
  scenario(
    40,
    "Oversized, unallowlisted, or escaping artifacts are rejected without leaking their content.",
    ["S6.4"],
    [
      {
        file: "tests/hardening.test.ts",
        title:
          "secrets are redacted before storage and rejected artifacts do not leak their content",
      },
    ],
  ),
  scenario(
    41,
    "A trust-boundary failure or severity-1/2 escape automatically disables R0/R1 auto-merge for the affected scope.",
    ["S5.5", "S6.5"],
    [
      {
        file: "tests/github-auto-merge.test.ts",
        title:
          "a trust-boundary failure or severity-1/2 escape disables R0/R1 auto-merge",
      },
      {
        file: "tests/operations.test.ts",
        title:
          "an emergency kill switch, trust-boundary failure, or severity-1/2 escape disables R0/R1 auto-merge for the affected scope",
      },
    ],
  ),
]);

export function listAcceptanceScenarios(): readonly AcceptanceScenario[] {
  return ACCEPTANCE_SCENARIOS;
}
