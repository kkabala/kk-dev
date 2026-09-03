# Agentic Development — Risk-Based Autonomous SDLC
## Brainstorm / Proposal for P-Stack Integration

> Status: **brainstorm / design proposal**
>
> The purpose of this document is not to describe an established industry standard.
> It is a proposal for extending an Agentic Development / P-Stack workflow, with the primary goal of reducing human review as a bottleneck without blindly increasing agent autonomy.

---

# 1. Problem

In Agentic Development, humans can become the main bottleneck.

If an agent:

1. plans a change,
2. implements it,
3. runs tests,
4. performs verification,
5. prepares a PR,

but **every PR must then wait for a human**, the throughput of the entire system is still limited by human review.

At the same time, completely removing human review is risky.

Changing UI copy and changing financial transaction execution logic should not have the same approval process.

### Main hypothesis

Instead of:

> every PR → human review

use:

> risk assessment → workflow appropriate for the risk level

For example:

- very low risk → full autonomy / auto-merge,
- low risk → automated verification,
- medium risk → AI review + automated verification,
- high risk → human review,
- critical risk → additional safeguards / mandatory human review.

The exact meaning of R0–R4 remains to be designed.

---

# 2. Proposed End-to-End Workflow

The target system could look like this:

```text
                    ┌──────────────┐
                    │    TICKET    │
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
                    │   PLANNING   │
                    └──────┬───────┘
                           │
                           ▼
              ┌────────────────────────┐
              │ PRE-WORK RISK ANALYSIS │
              │       R0 ... R4        │
              └───────────┬────────────┘
                          │
                          ▼
              ┌────────────────────────┐
              │ WORKFLOW / ASSIGNMENT  │
              └───────────┬────────────┘
                          │
                          ▼
              ┌────────────────────────┐
              │ P-STACK / POTATO MODE  │
              │     IMPLEMENTATION     │
              └───────────┬────────────┘
                          │
                          ▼
              ┌────────────────────────┐
              │ TESTS + VERIFICATION   │
              └───────────┬────────────┘
                          │
                          ▼
              ┌────────────────────────┐
              │ POST-DIFF RISK CHECK   │
              │ actual changed files   │
              └───────────┬────────────┘
                          │
                          ▼
                        ┌────┐
                        │ PR │
                        └─┬──┘
                          │
              ┌───────────┼───────────┐
              ▼           ▼           ▼
         AUTO-MERGE    AI REVIEW   HUMAN REVIEW
```

**Important:** the current discussion is primarily focused on:

> **PRE-WORK RISK ANALYSIS**

Post-diff risk analysis is the next stage of the design.

---

# 3. Two Different Risk Assessments

This distinction is important.

## 3.1 Pre-Work Risk

Performed **after planning but before implementation**.

At this point, the actual diff does not exist yet.

The system therefore answers:

> "How risky is this change likely to be?"

Based on:

- the plan,
- repository structure,
- architecture,
- predicted touched areas,
- existing repository risk policy.

The result may affect:

- workflow,
- model/agent assignment,
- required verification,
- required tests,
- required review.

---

## 3.2 Post-Diff Risk

Performed after implementation.

At this point, the system knows:

- the actual diff,
- the actual changed files,
- the actual blast radius,
- added/removed tests,
- API changes,
- migrations, etc.

It can therefore detect situations such as:

> "The plan looked like R1, but the agent also modified the transaction engine. This is now R4."

**The final human-review/auto-merge decision should not be based solely on pre-work risk.**

This should be designed separately.

---

# 4. Problem: How Does the System Know the Repository's Risk Profile?

We do not want this process:

```text
Install tool

→ developer manually describes 150 directories
→ developer defines dozens of rules
→ developer maps the architecture
→ developer configures the risk engine

→ only then can the system work
```

That would destroy the UX.

We want:

```text
Install
   ↓
Init Skill
   ↓
AI scans repository
   ↓
AI proposes risk map
   ↓
Human reviews proposal once
   ↓
Policy committed to repository
   ↓
Normal autonomous operation
```

---

# 5. INIT RISK SKILL

We propose a separate skill, tentatively:

```text
/init-risk
```

or:

```text
/risk-bootstrap
```

It runs when the system is first introduced to a repository.

---

# 6. What Exactly Does the Init Skill Do?

## STEP 1 — Repository Discovery

The agent analyzes the repository structure.

For example:

```text
/src
    /payments
    /deposits
    /transactions
    /authentication
    /app-team
    /settings
    /notifications

/tests
/database
/infrastructure
```

This should not rely solely on directory names.

The agent should also analyze dependencies and code responsibilities.

---

## STEP 2 — Domain Discovery

The agent attempts to identify domains.

Example:

```text
payments       → financial
deposits       → financial
transactions   → financial
auth           → security
database       → persistence
settings       → application configuration
app-team       → low-impact application feature
```

---

## STEP 3 — Criticality Discovery

The agent looks for signals indicating criticality.

Example signals:

### Financial

- money movement,
- balances,
- deposits,
- withdrawals,
- trades,
- settlement,
- fees,
- billing.

### Security

- authentication,
- authorization,
- permissions,
- roles,
- tokens,
- secrets.

### Data Integrity

- database migrations,
- destructive operations,
- persistence layer,
- schema changes.

### External Contracts

- public APIs,
- event schemas,
- integrations,
- backwards compatibility.

### Operational

- deployment,
- infrastructure,
- CI/CD,
- feature flags.

---

# 7. Init Skill Also Analyzes Testability

The agent checks:

- where unit tests exist,
- where integration tests exist,
- where E2E tests exist,
- where acceptance tests exist,
- which modules have weak test coverage,
- whether deterministic checks exist for a given domain.

Example observation:

```text
/src/payments

Criticality: HIGH
Unit tests: YES
Integration tests: YES
E2E tests: PARTIAL

Suggested minimum risk: R4
```

vs.

```text
/src/app-team

Criticality: LOW
Unit tests: YES
E2E tests: YES

Suggested minimum risk: R1
```

---

# 8. The Agent Generates a Risk Policy

The output of the Init Skill should not be a decision hidden inside an LLM.

The output should be an **explicit, version-controlled artifact stored in the repository**.

For example:

```text
.pstack-risk.yml
```

or:

```text
.agent-risk.yml
```

Example:

```yaml
version: 1

risk_levels:
  R0:
    description: trivial
  R1:
    description: low
  R2:
    description: moderate
  R3:
    description: high
  R4:
    description: critical

paths:

  "src/payments/**":
    minimum_risk: R4
    reason: "Money movement"

  "src/deposits/**":
    minimum_risk: R4
    reason: "Customer funds"

  "src/transactions/**":
    minimum_risk: R4
    reason: "Financial transactions"

  "src/auth/**":
    minimum_risk: R4
    reason: "Authentication / authorization"

  "database/migrations/**":
    minimum_risk: R4
    reason: "Persistent data modification"

  "src/api/**":
    minimum_risk: R3
    reason: "External contract"

  "src/settings/**":
    minimum_risk: R1

  "src/app-team/**":
    minimum_risk: R1
```

This is what **policy as code** means in this context.

Not:

> "The LLM remembers that payments are important."

But:

> The repository contains a deterministic rule stating that `payments/** >= R4`.

---

# 9. Human Involvement During Initialization

The Init Skill creates a PR:

```text
Initialize repository risk policy
```

The PR shows something like:

```text
Detected 14 domains.

Suggested:

payments       R4
deposits       R4
transactions   R4
authentication R4
API            R3
notifications  R2
settings       R1
app-team       R1
```

A human can change:

```text
notifications → R3
settings → R2
```

and approve it.

### Key Principle

The human configures the system **once at the repository level**, rather than classifying every task manually.

The policy then lives normally in Git:

```text
code review
history
blame
PR
versioning
```

---

# 10. Normal Task — Pre-Work Risk Analysis

Assume the following ticket:

> Add filtering to App Team settings screen.

The planning agent creates:

```text
1. Modify AppTeamSettings component.
2. Add filter state.
3. Update AppTeamService query.
4. Add tests.
```

Now the system runs:

```text
PRE-WORK RISK ANALYSIS
```

---

# 11. The Agent Should Not Immediately Assign a Risk Level

First, the agent performs **fact extraction**.

Example:

```yaml
predicted_areas:

  - src/app-team/AppTeamSettings.tsx
  - src/app-team/AppTeamService.ts

change_types:

  - UI
  - query filtering

touches_money: false
touches_auth: false
touches_permissions: false
touches_persistent_data: false
touches_external_api: false

estimated_blast_radius: local

test_coverage:
  unit: true
  integration: true

confidence: 0.92
```

This separation is important.

The LLM answers:

> "What is likely to change?"

Not:

> "Are we allowed to bypass human review for this PR?"

---

# 12. Deterministic Policy Engine

The policy engine then takes:

```text
facts from agent
+
.pstack-risk.yml
```

and determines the minimum risk level.

Example:

```text
predicted path:

src/app-team/**

policy:

minimum_risk = R1

additional escalation rules:

money = false
auth = false
migration = false
external API = false

RESULT:

PRE-WORK RISK = R1
```

This part should be as deterministic as possible.

---

# 13. Why a Hybrid Approach?

## LLM Only

Problem:

```text
Ticket A → R1
the same Ticket A tomorrow → R2
```

It also becomes difficult to answer:

> "Why was this task allowed to auto-merge?"

---

## Deterministic Rules Only

Problem:

A plan might say:

> Add notification after deposit.

Keyword:

```text
notification
```

looks harmless.

But the plan may require touching:

```text
DepositService
TransactionProcessor
AccountBalance
NotificationService
```

So the actual change affects money.

Simple keyword rules are not sufficient.

---

## Therefore:

```text
LLM
 ↓
semantic understanding / fact extraction
 ↓
structured facts
 ↓
deterministic policy
 ↓
Risk Level
```

---

# 14. Very Important Rule

AI may detect additional risk.

AI **must not be able to bypass the minimum repository policy**.

If:

```yaml
"src/payments/**":
    minimum_risk: R4
```

the agent cannot say:

> "The change is small, therefore R1."

The policy engine responds:

```text
R4 minimum.
```

---

# 15. Uncertainty / Confidence

The agent may not know which files will be required.

Example:

```yaml
confidence: 0.52
```

This should itself be considered a risk signal.

A possible rule:

```yaml
escalation:

  low_confidence:
    below: 0.70
    increase_risk_by: 1

  very_low_confidence:
    below: 0.40
    minimum_risk: R3
```

**This is currently a design hypothesis.**

We need to determine whether numerical LLM confidence is sufficiently useful, or whether a classification such as:

```text
KNOWN
PARTIALLY_KNOWN
UNKNOWN
```

would be more reliable.

---

# 16. Example 1 — Trivial UI Change

Ticket:

> Change button label from "Save" to "Save changes".

Agent:

```yaml
predicted_paths:
  - src/settings/components/SaveButton.tsx

change_type:
  - copy

money: false
auth: false
data: false
api: false

blast_radius: local
```

Policy:

```text
settings/** → R1
```

Potential result:

```text
PRE-WORK RISK: R1
```

---

# 17. Example 2 — Deposit Validation

Ticket:

> Prevent deposits below minimum amount.

The plan predicts:

```text
DepositService
DepositValidator
Deposit API
tests
```

Agent:

```yaml
predicted_paths:

  - src/deposits/**
  - src/api/deposits/**

change_types:

  - business_logic
  - validation

touches_money: true

blast_radius: domain

confidence: 0.94
```

Policy:

```text
deposits/** → minimum R4
```

Result:

```text
PRE-WORK RISK: R4
```

Even if the implementation is likely to change only ten lines.

---

# 18. Example 3 — An Innocent-Looking Ticket

Ticket:

> Send notification after successful transaction.

At first glance:

```text
notification → R1/R2
```

But the planning agent predicts:

```text
TransactionProcessor
TransactionCompleted event
NotificationService
```

Fact extraction:

```yaml
predicted_paths:

  - src/transactions/**
  - src/events/TransactionCompleted.ts
  - src/notifications/**

touches_money: true
touches_external_contract: true

blast_radius: cross-module
```

Policy:

```text
transactions/** → R4
```

Result:

```text
PRE-WORK RISK: R4
```

This demonstrates why **analyzing keywords from the ticket alone is insufficient**.

---

# 19. What Should the Pre-Work Agent Analyze?

At the current stage, the proposed signal set is:

### Predicted Touched Areas

Which:

- modules,
- directories,
- components,
- services,

are likely to be modified.

### Change Type

For example:

```text
copy
UI
configuration
business logic
API
database
migration
security
infrastructure
```

### Sensitive Domains

Does the change affect:

```text
money
authentication
authorization
PII
persistent data
external contracts
infrastructure
```

### Blast Radius

For example:

```text
LOCAL
MODULE
CROSS_MODULE
SYSTEM
```

### Reversibility

How easily can the change be reverted?

For example:

```text
feature flag
simple code rollback
DB migration
destructive migration
external side effects
```

### Error Detectability

Would an error likely be detected by:

```text
compiler
unit tests
integration tests
E2E
monitoring
```

or only by:

```text
customer
production data
financial reconciliation
```

### Existing Test Coverage

Does the predicted area have appropriate deterministic tests?

### Confidence / Uncertainty

Does the agent actually understand the expected scope of the change?

---

# 20. Risk Should Not Be Determined by a Single Signal

Not:

```text
risk = keyword(ticket)
```

Not:

```text
risk = folder
```

Not:

```text
risk = LLM opinion
```

Instead:

```text
          PLAN
            │
            ▼
     semantic analysis
            │
            ▼
     predicted changes
            │
      ┌─────┴─────┐
      │           │
      ▼           ▼
 repo policy   risk signals
      │           │
      └─────┬─────┘
            ▼
      POLICY ENGINE
            │
            ▼
          R0-R4
```

---

# 21. P-Stack Integration

Proposed flow:

```text
PLAN
 ↓
risk-precheck
 ↓
P-Stack / Potato workflow
 ↓
implementation
 ↓
verification
 ↓
risk-postcheck
 ↓
PR
```

The risk system should not replace P-Stack.

It should operate as a **routing/control layer around P-Stack**.

---

# 22. Verification vs Deterministic Regression Protection

Another important topic emerged during the discussion.

Agent verification primarily answers:

> "Does this implementation work as expected right now?"

That does not necessarily mean:

> "Has a permanent deterministic regression test been created that CI will continue running for years?"

These are two different problems.

A potential future workflow:

```text
Agent Verification
       ↓
successful verified flow
       ↓
Should this become regression protection?
       ↓
YES
       ↓
Generate / update deterministic test
       ↓
CI
```

For example:

```text
Playwright
Cucumber
integration tests
contract tests
```

However, not every agent verification should automatically generate an E2E test.

This requires a separate policy.

---

# 23. Potential Target Autonomy Model

**This is a hypothesis, not a final decision.**

For example:

| Risk | Workflow |
|---|---|
| R0 | tests → auto-merge |
| R1 | verification → auto-merge |
| R2 | verification + AI review → auto-merge |
| R3 | verification + AI review + human review |
| R4 | enhanced verification + mandatory human review |

We should not become attached to this table yet.

First, R0–R4 need precise definitions.

---

# 24. What We Currently Consider Agreed

### 1. Risk Assessment Should Be Part of the Workflow

Not every agentic task should have the same level of human supervision.

### 2. Risk Should Be Assessed at Least Twice

```text
PRE-WORK
POST-DIFF
```

### 3. Pre-Work Risk Should Run After Planning

Only the plan provides enough information about the predicted scope of the change.

### 4. We Do Not Want Manual Classification of Every Task

Risk assessment should be automated.

### 5. The Repository Should Contain a Persistent Risk Policy

For example:

```text
.pstack-risk.yml
```

### 6. The Policy Should Be Bootstrapped by AI

A dedicated Init Skill scans the repository and proposes the configuration.

### 7. A Human Reviews the Bootstrap

But this is essentially done **once**, after which the policy is maintained like code.

### 8. LLMs and Deterministic Rules Have Different Roles

LLM:

```text
understand
discover
classify facts
identify uncertainty
```

Policy engine:

```text
decide minimum allowed risk
apply deterministic rules
```

### 9. AI Cannot Bypass the Minimum Defined by Policy

It may potentially escalate risk.

It cannot reduce risk below a hard repository rule.

---

# 25. What We Have NOT Decided Yet

The following areas require further discussion.

## A. How Exactly Does the Init Skill Determine Criticality?

Should it analyze:

- folder names,
- code,
- dependency graph,
- DB schema,
- APIs,
- tests,
- Git history,
- CODEOWNERS,
- existing CI,
- production configuration,
- a combination of all of the above?

The key question is:

> How do we obtain a good risk map without forcing developers to manually configure dozens of things?

---

## B. Levels or Numerical Score?

Option A:

```text
R0
R1
R2
R3
R4
```

Option B:

```text
0-100
```

then:

```text
0-20   → R0
21-40  → R1
...
```

We need to determine whether scoring provides real value or merely creates false precision.

---

## C. How Should Multiple Signals Be Combined?

Example:

```text
UI change                R1
payments module          R4
excellent tests          -?
feature flag             -?
cross-module change      +?
low confidence           +?
```

Should it simply be:

```text
risk = MAX(all rules)
```

or should there be a more sophisticated model?

---

## D. Can Strong Test Coverage Reduce Risk?

This is particularly important.

One possible approach:

```text
payments = inherent risk R4
```

and even excellent tests cannot reduce inherent risk.

Alternatively, separate:

```text
INHERENT RISK
CONTROL STRENGTH
RESIDUAL RISK
```

Example:

```text
Inherent risk: R4

Controls:
+ strong unit tests
+ integration tests
+ deterministic E2E
+ feature flag
+ rollback

Residual risk: R2/R3
```

This may be a better model than a single "risk score".

---

## E. Cross-Cutting Changes

What if the plan touches:

```text
settings/**        R1
notifications/**   R2
transactions/**    R4
```

The simplest rule is:

```text
risk = MAX(R1, R2, R4)
     = R4
```

But we need to determine whether that is sufficient.

---

## F. Confidence

Should we use:

```text
0.0 - 1.0
```

or:

```text
HIGH
MEDIUM
LOW
UNKNOWN
```

And what exactly should happen when confidence is `LOW`?

---

## G. Post-Diff Re-Evaluation

This will probably become a key safety mechanism.

We need to separately design:

```text
planned files
vs
actual files

planned domains
vs
actual domains

planned blast radius
vs
actual blast radius

planned tests
vs
actual tests
```

If implementation goes beyond the original plan:

```text
risk escalation
```

should happen automatically.

---

# 26. Next Problem to Solve

The most logical next step in this discussion is:

> **How should the Init Risk Skill automatically scan an unknown repository and generate a sensible `.pstack-risk.yml` without asking the developer dozens of questions?**

Specifically:

```text
INPUT
  repository

        ↓

STATIC DISCOVERY
        +
AI DISCOVERY
        +
EXISTING REPO SIGNALS

        ↓

DOMAIN MAP

        ↓

CRITICALITY MAP

        ↓

TEST / CONTROL MAP

        ↓

PROPOSED RISK POLICY

        ↓

ONE HUMAN REVIEW

        ↓

.pstack-risk.yml
```

This should be the next stage of the brainstorm.

---

# 27. Working Design Principle

The entire idea can be summarized in one principle:

> **Use AI to understand the repository. Use deterministic policy to decide how much autonomy AI gets.**

The agent should perform work requiring semantic understanding.

The policy engine should make decisions that need to be:

- predictable,
- auditable,
- repeatable,
- version-controlled,
- explainable.

The goal is not to remove humans from the SDLC.

The goal is to reach a state where:

> **human attention is spent only where risk justifies it.**
