# Exoframe Delivery Domain

Exoframe coordinates a software task from intake through independently verified delivery while keeping implementation and decision authority separate.

## Language

**Run**:
The durable lifecycle of one task from intake through implementation, verification, governance, merge, and delivery.
_Avoid_: Session, workflow execution

**Run state**:
The single lifecycle position of a run. It is distinct from runner attempts, gate results, engineering readiness, merge mode, and repository governance.
_Avoid_: Status, result, gate state

**Run transition**:
A permitted move from one run state to another after one validated domain event.
_Avoid_: Status update, arbitrary state assignment

**Run snapshot**:
A versioned durable record of one run's identity, lifecycle state, and revision at a committed point in time.
_Avoid_: Cache, session dump, partial write

**Run catalog**:
The durable association between a task's immutable direct-input context and the run that owns its lifecycle state.
_Avoid_: Run state, task list, cache

**Workspace identity**:
The canonical checkout root plus root and Git-marker filesystem identity used to isolate external control-plane state from other or replacement checkouts.
_Avoid_: Repository facts, working-directory string, remote repository ID

**Repository facts**:
Discoverable checkout observations used during run preparation: the actual base, instruction files, and existing test or build commands.
_Avoid_: Workspace identity, task, conversational memory

**Runner attempt**:
One protected execution observation before authoritative history is evaluated into a gate result.
_Avoid_: Test result, gate result

**Gate result**:
The authoritative evaluation of one gate from its accepted evidence and attempt history.
_Avoid_: Runner attempt, engineering status

**Engineering status**:
The derived readiness of a candidate across required gates, live exceptions, and human or non-human blockers.
_Avoid_: Run state, gate result

**Merge mode**:
Repository governance that selects human merge authorization or GitHub-native auto-merge after engineering readiness.
_Avoid_: Run state, agent merge

**Task**:
The requested user outcome together with the stable identity of its source.
_Avoid_: Ticket, task envelope, repository facts

**Intent**:
The resolved goals, non-goals, constraints, and still-unresolved product decisions derived during run preparation.
_Avoid_: Plan, implementation design

**Decision packet**:
The minimal, evidence-linked information required for one human decision or review; related blocking intake questions may be batched into one packet.
_Avoid_: Question dump, raw logs, approval request

**Run preparation**:
The automatic derivation of task intent, non-goals, affected surfaces, risk, acceptance outcomes, gates, and writable scope before implementation begins.
_Avoid_: Control planning, planning phase

**Implementation planning**:
The technical exploration, choices, and work decomposition performed by pstack after it receives a bounded assignment.
_Avoid_: Exoframe planning

**Task reference**:
A compact external identifier or URL, such as `ABC-123`, that a configured task source can resolve into a task envelope.
_Avoid_: Task, ticket content

**Task envelope**:
The provider-neutral task content and provenance produced after direct input or a task reference is resolved.
_Avoid_: Ticket, provider payload

**Project integration profile**:
The explicit, versioned definition of a project's task conventions and provider selections.
_Avoid_: Learned behavior, conversational memory, implicit configuration

**Provider**:
An authenticated connection that supplies normalized task input or engineering-system observations for one capability.
_Avoid_: Plugin

**Plugin**:
An installed extension package that may implement one or more provider capabilities without gaining Exoframe decision authority.
_Avoid_: Provider

**Gate**:
A progression requirement evaluated from accepted evidence; it may require an executable test or another authenticated observation.
_Avoid_: Test, check

**Gate template**:
The protected command definition used to execute a gate, selected by gate ID from templates accepted by the actual base.
_Avoid_: Raw command, caller argv, shell string

**Evidence key**:
The identity of exactly what was checked, with which template and environment; ephemeral hostnames and timestamps are not part of it.
_Avoid_: Measurement, log line, check name

**Measurement**:
An immutable runner record of one attempt; reuse decisions may be appended beside it, but the body is never rewritten.
_Avoid_: Gate result, log, advisory PASS

**Evidence artifact**:
A runner-produced file that counts as evidence only when bound to runner identity, measured commit, and gate.
_Avoid_: Unprovenanced screenshot, attached image

**Infrastructure retry**:
A repeated protected execution after an infrastructure error; exhausting the configured retries yields a blocked gate, not a product bounce.
_Avoid_: Product retry, rerun until green

**Accepted gap**:
A temporary exception covering a required behavior that cannot currently be measured; it needs compensating evidence, owner, reason, and expiry.
_Avoid_: Waiver, skipped gate, silent skip

**Override**:
A temporary exception covering one specific authoritative failure believed to be a false positive; it needs an independent approver, exact evidence key, owner, reason, and expiry.
_Avoid_: Force pass, ignored failure

**Path category**:
The base-policy classification of a changed path as production, verification, control-plane, or declared non-production material.
_Avoid_: File type, language, folder name

**Surface**:
A named product boundary with paths, risk floor, consumption exercises, and hypotheses that production changes must match.
_Avoid_: Feature area, module, component

**Provisional R2**:
Coverage assigned when a production path does not match a declared surface; it raises unknown shipped behavior to R2 rather than leaving it unclassified.
_Avoid_: Default skip, inferred R0

**Risk tier**:
The fail-up classification of a change from R0 to R3; signals may raise it and an implementation agent cannot lower it.
_Avoid_: Severity, priority, review level

**Protected Acceptance Contract**:
The locked observable meaning of a task, including named outcomes, intended red, and oracle identity, recorded before implementation.
_Avoid_: Test plan, ticket acceptance, informal checklist

**Intended red**:
A named PAC outcome that must fail on the base overlay while setup and the probe itself succeed.
_Avoid_: Any red test, crash, timeout

**Gate plan**:
The deterministic required G0–G9 set derived from base policy, risk, surfaces, contracts, and delivery metadata.
_Avoid_: CI job list, test matrix

**Acceptance author**:
The independent machine role that writes PAC and probe artifacts before implementation and cannot become the implementer for that task.
_Avoid_: Human reviewer, tester, implementer

**Independent verifier**:
The R2/R3 role that attacks hypotheses and proposes harnesses; its prose stays advisory until the protected runner measures an accepted harness.
_Avoid_: Implementer self-check, final PASS
