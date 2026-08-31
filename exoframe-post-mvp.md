# Exoframe Post-MVP: Provider and Plugin Architecture

- **Status:** Post-MVP proposal
- **Relationship to `kk-dev-final-spec.md`:** Companion document. It does not replace the MVP specification.
- **Scope:** Configurable task ingestion, repository hosting, pipeline monitoring, release observation, and plugin lifecycle.

## 1. Relationship to the MVP run

`kk-dev-final-spec.md` is the only normative definition of the Exoframe run, planning boundary, verification, and merge lifecycle. This document does not repeat or change that lifecycle.

Post-MVP plugins only supply normalized task inputs or authenticated provider observations. After a plugin resolves a task reference such as `ABC-123`, the ordinary MVP run continues unchanged. Plugins cannot lower risk, remove gates, grant PASS, modify pstack/poteto-mode, or merge code.

## 2. Post-MVP plugin objective

Post-MVP, Exoframe should understand project-specific task references and engineering systems through installed, configured providers.

Example:

```text
exoframe run ABC-123
```

With a Jira route configured, Exoframe should:

1. recognize `ABC-123` as a Jira task reference;
2. call the configured Jira provider;
3. retrieve the title, description, acceptance criteria, attachments, links, and relevant metadata;
4. record source identity, revision, URL, and content digest;
5. normalize the result into an Exoframe task envelope;
6. continue automatic intake without asking the user to copy the ticket.

This behavior must be explicitly configured and auditable. Exoframe must not silently learn a permanent routing rule from an ordinary conversation.

## 3. Extension points

| Extension point | Default | Example alternatives | Responsibility |
|---|---|---|---|
| Task source | direct task text | Jira, Linear, GitHub Issues, Azure Boards, custom REST | Resolve a reference into normalized task intent and provenance |
| Repository host | GitHub | GitLab, Bitbucket, Azure Repos, self-hosted Git | Read repository metadata, diffs, branches, reviews, protections, and merge state |
| Pipeline provider | GitHub Actions | GitLab CI, Buildkite, CircleCI, Jenkins, Azure Pipelines | Start or observe jobs and return authenticated status and artifact references |
| Review/governance provider | GitHub | GitLab, Bitbucket, Azure DevOps | Expose required reviews, CODEOWNERS-equivalent rules, approvals, and queue state |
| Release/delivery observer | project-defined | Argo CD, Kubernetes, cloud providers, package registries | Observe release identity, rollout, health, and rollback state |
| Notification provider | none | Slack, Microsoft Teams, email | Deliver actionable human packets without becoming a decision authority |

Repository hosting, review governance, pipeline execution, and release observation are separate capabilities. One plugin may implement several capabilities, but Exoframe must not assume they come from the same vendor.

## 4. Project integration profiles

A **project integration profile** is the canonical way to teach Exoframe how a project names tasks and which engineering systems it uses. Teaching means configuring and approving the profile once; later matching runs resolve their systems automatically without asking the user to repeat those choices.

The profile is explicit, inspectable, versioned configuration. It is not conversational memory, model fine-tuning, or an implicit rule inferred from prior prompts. It may be organization-scoped with repository-specific overrides once configuration inheritance is defined.

The profile selects these capabilities independently:

- task-source routing;
- repository access and hosting;
- review and governance state;
- pipeline execution and monitoring;
- release and delivery observation;
- optional notifications.

A repository or organization should be able to configure its conventions as follows:

```yaml
task_routes:
  - id: company-jira
    match:
      regex: '^[A-Z][A-Z0-9]+-[0-9]+$'
    provider: jira
    config_ref: org:jira-main

  - id: github-issue-url
    match:
      url_hosts: [github.com]
      url_kinds: [issue]
    provider: github-issues
    config_ref: repo:origin

defaults:
  repository_provider: github
  review_provider: github
  pipeline_provider: github-actions
```

GitHub, GitHub review governance, and GitHub Actions remain the defaults when a profile does not override them. Repository access and pipeline monitoring are separate selections: for example, a GitHub repository may use Buildkite, while a GitLab repository may use Jenkins.

Configuration may be created manually or through a setup command, but the resulting profile must be inspectable, versioned, validated, and identified in the run audit record.

Suggested commands:

```text
exoframe plugins list
exoframe plugins install <plugin>
exoframe plugins configure <plugin>
exoframe plugins doctor
exoframe profiles show
exoframe profiles validate
exoframe task resolve ABC-123
exoframe providers explain ABC-123
```

## 5. Normalized provider contracts

Provider-specific data must be normalized before it reaches the Exoframe evaluator.

### 5.1 Task envelope

```yaml
task:
  schema_version: 1
  source:
    provider: jira
    external_id: ABC-123
    canonical_url: https://jira.example.com/browse/ABC-123
    revision: '18492'
    content_digest: sha256:...
    retrieved_at: 2026-08-31T12:00:00Z
  title: Add account export
  description: ...
  acceptance_hints: []
  attachments: []
  relationships: []
  metadata: {}
```

Task-provider content is input to intent derivation. Ticket labels, priority, or prose claiming that work is safe cannot lower Exoframe's derived risk.

### 5.2 Repository context

```yaml
repository:
  provider: github
  identity: kkabala/example
  default_branch: main
  base_sha: abc123
  protection_snapshot_digest: sha256:...
  authenticated_subject: installation:...
```

### 5.3 Pipeline snapshot

```yaml
pipeline:
  provider: github-actions
  repository_identity: kkabala/example
  run_id: '9981'
  candidate_sha: def456
  state: completed
  conclusion: success
  jobs: []
  artifact_refs: []
  provider_event_digest: sha256:...
```

A successful provider pipeline is an authenticated observation. It becomes sufficient for an Exoframe gate only when protected policy maps that pipeline and candidate identity to the required gate.

## 6. End-to-end plugin-assisted run

```text
User: exoframe run ABC-123
          |
          v
Project integration profile selects the configured routes and providers
          |
          v
Task router matches company-jira
          |
          v
Jira plugin retrieves and normalizes the ticket
          |
          v
Repository provider resolves checkout, base, and protections
          |
          v
Exoframe derives intent, surfaces, risk, PAC, and gates
          |
          v
pstack/poteto-mode implements through the Exoframe adapter
          |
          v
Pipeline provider starts/observes protected checks
          |
          v
Review provider reports approvals and merge-queue state
          |
          v
Repository host merges the exact eligible candidate
          |
          v
Delivery provider observes release identity and health
```

## 7. Plugin trust and security

Plugins cross important trust boundaries and therefore require stricter controls than ordinary agent skills.

Each installed plugin must declare:

- stable plugin and capability IDs;
- plugin version and package digest;
- supported contract versions;
- requested network hosts;
- required secret names and permissions;
- repository read/write permissions;
- whether operations are read-only, reversible, or destructive;
- normalized outputs it can produce;
- health-check and diagnostic operations.

Exoframe must:

- pin accepted plugin versions or digests for authoritative use;
- obtain credentials from an external secret store rather than repository files or model context;
- apply least-privilege credentials independently per provider;
- record provider identity and source revision with every observation;
- redact secrets before logs or artifacts are stored;
- fail closed when identity, candidate SHA, task revision, or provider status is uncertain;
- prevent plugins from writing `authoritative: true` or directly setting Exoframe status;
- require explicit approval before installing a plugin or granting new permissions;
- keep pstack/poteto-mode unchanged and integrate only through the Exoframe-owned adapter.

## 8. Plugin packaging and lifecycle

A plugin package should contain:

```text
plugin.json               identity, version, capabilities, permissions
schemas/                  input and normalized output schemas
providers/                provider implementations
migrations/               configuration migrations, if needed
tests/                    contract and provider tests
README.md                 setup and operational documentation
```

Lifecycle operations:

1. discover or select a plugin;
2. review requested capabilities and permissions;
3. install a pinned version;
4. configure credential references and routing;
5. run `doctor` and contract tests;
6. activate for advisory use;
7. promote to authoritative-provider eligibility only through protected policy;
8. update through an explicit, auditable migration;
9. disable or roll back without losing run history.

## 9. Delivery sequence

Recommended post-MVP increments:

1. Extract the built-in GitHub repository, governance, and Actions behavior behind stable provider interfaces.
2. Add the task-source interface and deterministic routing rules.
3. Ship Jira as the first external task-source plugin.
4. Add plugin discovery, installation, permission review, pinning, and `doctor` commands.
5. Add one alternative repository/review provider, preferably GitLab.
6. Add one vendor-independent pipeline provider such as Jenkins or Buildkite.
7. Add release/delivery observation plugins.
8. Add optional notification plugins for human decision packets.

Each increment must preserve GitHub as the default and must not weaken the protected runner, evidence provenance, producer/judge separation, or hosting authority.

## 10. Post-MVP acceptance criteria

The plugin architecture is ready when all of the following are demonstrable:

1. `exoframe run ABC-123` resolves through a configured Jira route without additional user input.
2. An unknown or ambiguous task reference fails with an actionable routing explanation.
3. The same normalized task envelope can be produced by two different task providers.
4. GitHub remains the default repository, governance, and pipeline provider when no override is configured.
5. Repository and pipeline providers can be selected independently.
6. A provider status for the wrong commit cannot satisfy a gate.
7. A plugin cannot grant itself authoritative status or lower task risk.
8. Missing, expired, or over-scoped credentials fail without exposing secret material.
9. Plugin upgrades change the recorded digest and invalidate affected reusable evidence where required.
10. Disabling a plugin preserves prior task, evidence, and audit records.
11. Once a project integration profile is configured, repeated matching task references require no provider-selection prompt.
12. Every plugin-assisted run records the profile identity and revision that selected its providers.

## 11. Explicitly deferred decisions

- public versus private plugin registry;
- plugin implementation language and process-isolation mechanism;
- organization-wide configuration inheritance;
- interactive configuration UI;
- plugin signing and publisher reputation;
- compatibility policy across Exoframe major versions;
- offline plugin bundles for restricted environments.
