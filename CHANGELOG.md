# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.0] — 2026-06-13

### Added

- **Provenance attestations are now recorded.** `vouch <pkg>` and `vouch adopt` record whether each version was published with an [npm provenance attestation](https://docs.npmjs.com/generating-provenance-statements) in an optional `checks.provenance` field on the ledger entry. When the attestation is present, vouch also records the claimed source repo, commit, and CI workflow it was built from — evidence the reviewer sees in the PR diff. The field is additive: existing ledgers load unchanged, and an entry written before 0.5.0 simply has no `provenance` field (no migration).
- **New `requireProvenance` config option** (`"off"` default, `"warn"`, `"block"`). An add-time-only gate: with `"block"`, an unattested version can't be added without `--force-with-reason`. Provenance is *always* recorded regardless of this setting — the option only controls the gate. Fail-open: the gate acts only on the registry-confirmed presence fact, so an unreachable attestation endpoint never blocks. `vouch adopt` records the evidence but never lets provenance affect a baselined dependency's risk.

### Notes

- vouch records the **registry-verified** provenance claim from publish time; it does **not** re-verify sigstore signatures. Use `npm audit signatures` for cryptographic re-verification.

## [0.4.0] — 2026-06-02

### Added

- **`init` now seeds `AGENTS.md`.** Alongside the config, `vouch init` writes the agent dependency rules to `AGENTS.md` at the repo root so coding agents read them. It creates the file if absent, appends a fenced `<!-- vouch:begin -->…<!-- vouch:end -->` section to an existing one (preserving prior content), and is idempotent — a re-run never duplicates the section.

## [0.3.0] — 2026-06-02

### Added

- **Advisory baseline at record time.** `vouch adopt` and `vouch <pkg>` now record the advisories present when a dependency is first recorded, in an optional `checks.advisories` field on each ledger entry. The field is additive — existing ledgers load unchanged, no migration. It lets `check` tell an advisory that already existed at record time from one that appeared afterward.

### Fixed

- **`check` no longer reports every known advisory as drift.** A freshly `adopt`-ed project previously saw every pre-existing advisory flagged as "gained … since it was recorded." `check` now classifies each unacknowledged advisory as either **present when recorded** ("known when recorded, not yet acknowledged") or **new since recorded** ("NEW advisory since it was recorded") — matching the threat model's "gained a new advisory *since*" intent. Entries with no recorded baseline (written before 0.3.0) degrade safely to the present-at-record wording, never a false "NEW". Both still require an explicit `vouch acknowledge --reason` — nothing is auto-accepted.

## [0.2.0] — 2026-06-01

### Added

- **Workspace-aware `check`, `adopt`, and `init`** for pnpm (`pnpm-workspace.yaml`) and npm/yarn (`package.json` `workspaces`) monorepos. They discover every workspace, take the union of declared dependencies, and operate against one root ledger at the repo root (located via `findRepoRoot`). `check` output is grouped by workspace and capped per group.
- **`vouch adopt`** — baseline a whole project in one command: records every installed, unrecorded dependency across all workspaces (deduped by `name@version`), with real risk assessment and a blanket reason. Never installs, never acknowledges CVEs, idempotent.
- **`init` nudge** — after writing the config, reports how many dependencies are unrecorded and points to `vouch adopt`.
- The installed-version resolver falls back to `pnpm-lock.yaml`'s `importers` block when a pnpm workspace has no local `node_modules`, so every declared dependency resolves.

### Breaking

- **Ledger format is now keyed by `name@version`** and wrapped in a `{ "version": 2, "entries": … }` envelope. 0.1.x name-keyed ledgers auto-migrate on read; the rewritten file lands in the next mutation's diff (commit it). No `vouch migrate` command. A 0.1.x entry lacking `approvedVersion` fails closed with a clear message. (A repo that only runs `check` keeps the 0.1.x file on disk until its next mutation — `check` migrates it in memory, so it still passes.)
- **`vouch check` is now version-aware and block-always**: it resolves each dependency's installed version (from `node_modules`) and asserts that exact `name@version` was reviewed. Run `check` after a complete install. A repo whose installed versions drifted from recorded versions will newly fail — run `vouch <pkg>@<installed>` to record them.
- **Config:** `requirePinned` no longer accepts `"block"` (use `"warn"` | `"off"`); `versionDrift` is deprecated and ignored.

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
