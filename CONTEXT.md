# Exoframe Delivery Domain

Exoframe coordinates a software task from intake through independently verified delivery while keeping implementation and decision authority separate.

## Language

**Run**:
The durable lifecycle of one task from intake through implementation, verification, governance, merge, and delivery.
_Avoid_: Session, workflow execution

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
