# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] - 2026-05-30

### Fixed

- `vouch check` now names the actual unrecorded package(s) in its "Next" hint —
  e.g. `vouch axios`, or `vouch typescript -D` for a devDependency — instead of a
  generic `vouch <package>` placeholder.

## [0.1.0] - 2026-05-29

Initial public release as `@vouchjs/vouch`.

### Added

- `vouch <pkg>` — review (version age, install-time scripts, deprecation, known CVEs), install,
  and record a dependency decision in `.security/dependency-approvals.json`.
- `vouch check` — CI gate failing on unrecorded dependencies, unexplained high-risk entries,
  CVE drift, and (configurable) version drift and unpinned ranges.
- `vouch acknowledge <pkg> --reason "<why>"` — knowingly accept a dependency's current
  advisories, recorded with attribution in the ledger.
- `vouch init` — bootstrap a typed `vouch.config.{js,mjs}` with all defaults shown; never
  overwrites an existing config.
- Typed configuration via `defineConfig` (`vouch.config.{ts,mjs,js,cjs}`) with runtime
  validation; legacy `.safe-dep.json` still supported.
- `AGENTS.md` guidance so coding agents record (and do not self-authorize) dependency decisions.
- Zero runtime dependencies; Node.js 18+.

[Unreleased]: https://github.com/janpfajfr/vouch/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/janpfajfr/vouch/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/janpfajfr/vouch/releases/tag/v0.1.0
