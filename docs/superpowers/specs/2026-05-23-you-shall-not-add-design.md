# you-shall-not-add — Design Spec

**Date:** 2026-05-23
**Status:** Approved (brainstorming)

## One-line positioning

A **dependency-governance gate**, not a scanner: it proves every dependency was
reviewed before it entered the repo, and fails CI when one wasn't.

We deliberately cede deep per-package scanning (typosquatting databases, CVE
feeds, behavioral analysis) to existing tools like `npq` and Socket. Our ground
is the thing none of them do well and that is naturally zero-dependency:
**provenance and enforcement**.

## Why this exists

The pre-install review checklist is already solved by `npq` (open source) and
Socket/Aikido (commercial). Rebuilding it produces a worse `npq`. Those tools
*warn* at install time and then forget — none of them prove, later in CI, that a
dependency was actually reviewed. They also assume you run them; nothing stops a
human (muscle memory) or an AI agent (instructions aren't enforcement) from
running plain `pnpm add` and skipping the gate entirely.

This project fills that gap: a committed approval ledger plus a CI check that
fails any PR introducing a dependency with no ledger entry. CI cannot be
skipped, so this is the only truly bypass-proof layer.

## Constraints

- **Zero runtime dependencies.** `"dependencies": {}`. Built on Node 18+ natives
  (`fetch`, `node:child_process`, `node:fs`, `node:test`). TypeScript is a
  dev-only compiler; we publish compiled JS. Leanness is the brand: a
  dependency-security tool with no dependencies.
- **npm-ecosystem only.** Not multi-ecosystem (PyPI/cargo). The registry-fetch
  layer sits behind an interface so multi-ecosystem stays *possible*, but is not
  built.
- **Distributed via npm**, runnable with `npx` (no global install needed — matters
  for agents).

## Architecture

Three pieces, one source of truth:

1. **The ledger** (`.security/dependency-approvals.json`, committed) — the record
   that a dependency was reviewed. Source of truth.
2. **`safe-add`** — the write path: reviews a package, then (on successful
   install) writes the ledger entry.
3. **`check`** — the enforce path: reads `package.json`, fails if any dependency
   has no ledger entry. The single, portable enforcement primitive — runs in any
   CI and as local git hooks.

The separation is the point: `safe-add` is convenience; `check` is the boundary.
Skipping `safe-add` and running raw `pnpm add` yields no ledger entry → `check`
fails the PR.

```
agent/dev → safe-add X → [alternatives] → [fetch metadata] → [age + script checks]
          → decision → install → write ledger
                                       │
                  (later, in CI) check: every dep in package.json
                                        must trace to a ledger entry → pass/fail
```

## Components

### Ledger (`ledger.ts`)

`.security/dependency-approvals.json`, keyed by package name:

```jsonc
{
  "lodash": {
    "approvedVersion": "4.17.21",
    "approvedAt": "2026-05-23T10:00:00Z",
    "risk": "low",                 // low | medium | high
    "reason": null,                // required non-empty string when forced/high
    "checks": { "ageHours": 900, "installScripts": false }
  }
}
```

- v1 enforces **name presence** — every name in `dependencies` and
  `devDependencies` must appear in the ledger.
- Version-drift detection (installed version ≠ `approvedVersion`) is a future
  strict-mode add. Recorded for audit now; not enforced in v1.
- Responsibilities: read, write/upsert, validate shape. Malformed file → error.

### `safe-add <pkg>` (`cli.ts` + orchestration)

Supports `safe-add <pkg>` and `safe-add -D <pkg>` (dev). Alias:
`you-shall-not-add`. Flow:

1. **Alternatives engine** — built-in or already-present equivalent? Surface it;
   may abort here (the cleanest security outcome is not adding the dep).
2. **Fetch registry metadata** — one call to `registry.npmjs.org`.
3. **Native checks** — version age + install scripts (the only two zero-data
   checks).
4. **Decision** — allow / warn / BLOCK.
5. **Block handling** — exit 1 unless `--force-with-reason "<non-empty reason>"`.
6. **Install** — run the detected package manager.
7. **Write ledger** — only after install succeeds.

**Ordering rule:** ledger is written *after* a successful install. If anything
crashes mid-way, the result is an installed dep with no ledger entry, which
`check` catches. Failure always lands on the safe side (fail-closed).

### `check` (`check-command.ts`)

Pure local logic, zero network. **The one enforcement primitive every CI and hook
calls** — `npx you-shall-not-add check`, exit 0 = pass, non-zero = fail:

- Read `dependencies` + `devDependencies` from `package.json`.
- Every name must have a ledger entry → else **fail and list the offenders**.
- Any entry with `risk: "high"` must have a non-empty `reason`.
- Exit non-zero on any violation.

### Native checks (`checks.ts`)

Only checks that need **no maintained data**, so they never rot and stay
zero-dep:

- **Version age** — registry publish time. Block `< 24h`, warn `< 7d`, allow
  `>= 7d`. Thresholds configurable.
- **Install scripts** — inspect `preinstall`, `install`, `postinstall`,
  `prepare`, `prepublish`, `prepublishOnly` in metadata. Block by default;
  allow only via `--force-with-reason`.

Out of v1 (need databases/lists — `npq`/Socket's turf): typosquatting, CVE
lookups, trust signals (repo/license/maintainer count). Optional future: shell
out to `npq` *if installed* — never a hard dependency.

### Alternatives engine (`alternatives.ts`)

Static embedded map (our data, not a runtime dependency):

- **Built-ins:** `uuid` → `crypto.randomUUID()`, `node-fetch` → `fetch`,
  `left-pad` → `String.prototype.padStart()`, `rimraf` →
  `fs.rm(..., { recursive: true })`.
- **Already-have:** read the project's `package.json`; suggest existing
  equivalents — `lodash` ↔ `remeda`, `moment` ↔ `date-fns`, `axios` ↔ `ky`.

The agent-facing carrot. Overridable via config.

### Registry client (`registry.ts`)

Fetches and normalizes npm metadata (latest/target version, publish time,
scripts, repository/license fields). Behind an interface so tests inject a fake
and multi-ecosystem stays possible.

### Package-manager detection (`pm.ts`)

Auto-detect by lockfile, default pnpm:

| Lockfile | Manager | runtime | dev |
|---|---|---|---|
| `pnpm-lock.yaml` | pnpm | `pnpm add X` | `pnpm add -D X` |
| `yarn.lock` | yarn | `yarn add X` | `yarn add -D X` |
| `package-lock.json` | npm | `npm install X` | `npm install -D X` |
| none | pnpm (default) | — | — |

The installer is an injectable runner so tests never invoke a real package
manager.

### Config (`config.ts`, `.safe-dep.json`)

```jsonc
{
  "minimumVersionAgeHours": 24,
  "warnVersionAgeHours": 168,
  "blockInstallScripts": true,
  "allowScopedPackages": ["@your-org/*"],
  "packageManager": "auto",        // auto | pnpm | npm | yarn
  "knownAlternatives": { "moment": "Prefer date-fns or Intl APIs" }
}
```

## Error handling

- Package not found → exit 1 with clear message.
- Registry unreachable → **fail closed** (do not install).
- Missing publish time in metadata → warn (do not silently allow).
- Malformed ledger or config → error, do not proceed.
- Install subprocess fails → propagate its exit code; **no ledger entry written**.

## Testing

`node:test` + `node:assert` only (zero dev-dep test framework).

- Inject the **registry client** and the **installer runner** — tests never hit
  the network or run a real package manager.
- Unit: age math, install-script detection, alternatives matching (built-in +
  already-have), ledger read/write/upsert, `check` pass/fail (missing entry,
  high-risk-without-reason), package-manager detection, config parsing.
- The fail-closed paths (registry down, unknown publish time) are explicitly
  tested.

## CI / enforcement integration

`check` is the **single portable primitive**: `npx you-shall-not-add check`
returns non-zero on any unreviewed dependency. Every integration below is a thin
wrapper around that one command — no per-platform logic lives in our code.

**Shipped example files** (GitHub and GitLab are the majors):

- **GitHub Actions** — `.github/workflows/dependency-security.yml`, triggered on
  changes to `package.json`, lockfiles, `.safe-dep.json`, and the ledger; runs
  `check` (optionally `pnpm install --frozen-lockfile --ignore-scripts` and
  `pnpm audit` as defense in depth).
- **GitLab CI** — `.gitlab-ci.yml` job using `rules:changes` on the same paths,
  running `npx you-shall-not-add check`.

**Documented one-liner** for everything else (CircleCI, Jenkins, Bitbucket,
Drone, …): run `npx you-shall-not-add check` in any pipeline step. We do not
build or maintain a file per platform.

**Local git hooks** (zero-dep, no husky): plain `.sh` scripts for **pre-commit**
and **pre-push** that call the same `check`. Installed via copy-paste or an
optional `init` helper into `.git/hooks/`.

## Repo structure

```
you-shall-not-add/
  README.md
  package.json                 # "dependencies": {}
  AGENTS.md                    # agents must use safe-add, must not run raw add
  .safe-dep.json
  .security/
    dependency-approvals.json  # the ledger (committed)
  docs/superpowers/specs/2026-05-23-you-shall-not-add-design.md
  src/
    cli.ts
    registry.ts
    checks.ts
    alternatives.ts
    ledger.ts
    check-command.ts
    pm.ts
    config.ts
  test/
  examples/
    pre-commit.sh
    pre-push.sh
  .github/workflows/dependency-security.yml
  .gitlab-ci.yml
```

## Agent integration

`AGENTS.md` instructs agents to use `safe-add`/`safe-add -D` instead of raw
`npm install` / `pnpm add` / `yarn add`, to justify each dependency (why needed,
why existing deps don't suffice, whether a built-in works), and to never bypass
a block. The ledger + CI `check` is the enforcement that backs those
instructions — instructions alone are not enforcement.

## Explicit non-goals (v1)

- Typosquatting detection, CVE lookups, trust-signal scoring (delegate to
  `npq`/Socket).
- Multi-ecosystem support (PyPI, cargo).
- Version-drift strict enforcement.
- A weighted numeric risk score — v1 uses a few hard rules (age, install
  scripts) plus explicit overrides. Precision over coverage; one bad false-block
  destroys trust in the gate.
- Per-CI-platform integration code beyond the shipped GitHub/GitLab examples.

## Success criteria

- A dev or agent cannot silently add a dependency: raw `pnpm add` fails CI.
- Install-scripted and very-new packages are blocked by default.
- Overrides require a documented, committed reason, visible in PR review.
- Zero runtime dependencies, verifiable in `package.json`.
- Works in both GitHub Actions and GitLab CI out of the box.
- Clear docs, `AGENTS.md`, and working examples.
