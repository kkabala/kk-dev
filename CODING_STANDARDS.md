# Coding standards

## Package boundary and provenance

- Treat the npm tarball as an exact allowlist, not merely as a successful
  build. Any intentional published entry-point change must update the artifact
  allowlist and its package-level acceptance test in the same change.
- Every build, including `npm pack` through `prepack`, must remove the package's
  own `dist/` tree before compiling. Resolve that directory relative to the
  package script, never the caller's working directory, and do not delete
  sibling build data.
- Publish `LICENSE.md`, `README.md`, and `THIRD_PARTY_NOTICES.md` with the
  compiled public entry points. Do not publish source, caches, stale outputs,
  renamed alternatives, or generated dependency payloads.
- Keep Retemper, pstack, and poteto-mode out of Exoframe's dependency,
  override, bundle, and published-artifact surfaces. Access pstack/poteto-mode
  only through Exoframe's owned adapter and supported public capabilities.
- When reusing Retemper-owned code, record the source repository and exact
  revision, source and destination paths, and modification notes. Recheck any
  third-party or vendored material inside Retemper under its own license; owner
  authorization does not extend to it.
