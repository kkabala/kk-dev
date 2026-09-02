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
```

`run` emits the new task and its initial `INTAKE` checkpoint as JSON. `status`
emits the same durable task/run view, while `explain` renders the current state
and next action for a person. In the current Stage 1 slice, `resume` reloads and
reports a non-completed checkpoint without advancing it; automatic intake is
introduced by the next implementation slice.

State is stored outside the candidate checkout by default, under the current
user's `~/.exoframe/state/workspaces/` control-plane directory. Each Git
checkout uses a key derived from its canonical root and filesystem identity, so
commands run from its subdirectories or path aliases share state while a new
checkout at a reused path does not inherit old runs. The Git marker's identity
also distinguishes a repository reinitialized in place. Outside Git, the
canonical working directory is the boundary. Set `EXOFRAME_STATE_ROOT` to an
explicit directory when the caller needs a different isolated or externally
managed state location.
