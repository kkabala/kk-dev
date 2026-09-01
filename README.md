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

Build and inspect the current CLI scaffold:

```bash
npm run build
node dist/bin.js --help
```

The task lifecycle commands will be added during Stage 1.
