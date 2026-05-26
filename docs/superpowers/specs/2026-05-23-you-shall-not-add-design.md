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

## Core principle (read this first)

> **The tool does not prevent the bypass. It makes the bypass impossible to hide.**

This is the thesis of the entire project, and every design decision follows from
it. We cannot stop a human or an AI agent from running raw `pnpm add`, from
hand-editing `package.json`, from passing `--force-with-reason "trust me"`, or
even from hand-editing the ledger — any *local-execution* defense is bypassable,
so we do not fight there. Instead, we guarantee that **every path to a passing CI
leaves a committed, reviewable artifact in the diff.** A risky dependency cannot
enter the repo *silently*; it can only enter *loudly*, attributed, and gated by a
human reviewer.

So when reading the rest of this spec, do not evaluate a mechanism by "can the
agent get around it locally?" (it always can) but by "does getting around it
produce a visible artifact a human must approve?"

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
    "reason": null,                // attribution: who/what added it & why (agent-supplied on --force)
    "approvedBy": null,            // authorization: a second-party signal the agent cannot self-issue
    "checks": { "ageHours": 900, "installScripts": false }
  }
}
```

**`reason` vs `approvedBy` — the distinction that closes the bypass:**

- **`reason`** is *attribution*, not authorization. It is supplied by whoever ran
  `safe-add` (including an agent on `--force-with-reason`). It answers "what
  happened and why," and makes the action loud and named in the diff. It does
  **not** by itself authorize a risky dependency.
- **`approvedBy`** is *authorization* — a second-party signal an agent cannot
  fabricate for itself. It is the human/reviewer sign-off that lets a high-risk
  entry pass CI. `safe-add` never writes this for a forced high-risk entry; it is
  added by a human as a separate, reviewable change (or supplied by a CI step a
  human controls).

This is why an agent cannot bypass the gate by simply inventing a reason: the
reason gets it *recorded*, but only `approvedBy` gets it *merged* (see `check`
and `requireApprovalForHighRisk`).

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
- Any entry with `risk: "high"` must have a non-empty `reason` (attribution).
- When `requireApprovalForHighRisk` is true (default), any entry with
  `risk: "high"` must **also** have a non-empty `approvedBy` (authorization). A
  forced high-risk entry with a reason but no `approvedBy` **fails** — this is the
  step that stops an agent from self-approving by inventing a reason.
- Exit non-zero on any violation.

Because the ledger is a committed file, the only way to satisfy `approvedBy` is a
visible diff a reviewer makes — consistent with the core principle. Branch
protection requiring human review of ledger/`package.json` changes is the
irreducible backstop (a determined actor could hand-forge an entry; the reviewer
is what catches that).

### Native checks (`checks.ts`)

Only checks that need **no maintained data**, so they never rot and stay
zero-dep:

- **Version age** — registry publish time. Block `< 24h`, warn `< 7d`, allow
  `>= 7d`. Thresholds configurable. **Not our differentiator:** as of 2026 all
  three managers gate release age natively (pnpm `minimumReleaseAge`, Yarn
  `npmMinimalAgeGate`, npm `min-release-age`). Our age check exists only as a
  **pre-decision explanation layer** — it tells the human/agent *why* a version
  is risky *before* `package.json`/the lockfile changes, which the native,
  silent install-time refusals do not. We do not pretend to own age-gating.
- **Cooldown verification** — detect whether the active package manager has a
  release-age cooldown configured (`minimumReleaseAge` / `npmMinimalAgeGate` /
  `min-release-age`). If not, warn (and optionally fail `check`, via
  `requireCooldownConfigured`). This makes us a governance layer *on top of* the
  native primitive rather than a worse reimplementation of it.
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
  "requireApprovalForHighRisk": true,   // high-risk needs approvedBy, not just a reason
  "requireCooldownConfigured": false,   // check fails if PM has no native release-age cooldown set
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
    art.ts                     # ASCII/ANSI art + TTY/NO_COLOR/--quiet rules
  assets/
    banner.svg                 # README header (fantasy + 80s palette)
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

## Branding & CLI presentation

Theme: **Gandalf / Moria, fantasy motifs (gate, staff, runes) in an 80s color
palette.** The personality is part of the product — the gate should *feel* like a
gate. Three surfaces:

1. **Block banner (`art.ts`)** — when `safe-add` BLOCKS, print a "YOU SHALL NOT
   PASS" ASCII/ANSI banner. **Always shown, even non-TTY** — a block is meant to
   be loud and unmissable in logs and PR output. Uses ANSI color when supported,
   degrades to plain ASCII otherwise.
2. **README header banner** — a hand-written **SVG** in `assets/`: fantasy gate /
   staff / rune motif rendered in a retro 80s palette. Vector, no binary
   tooling.
3. **Wordmark on normal runs** — small ASCII wordmark, but **TTY-aware**: shown
   only on interactive terminals. **Auto-suppressed when output is not a TTY**
   (piped, CI, agent invocation) or when `--quiet` / `NO_COLOR` is set. This
   keeps machine/agent output clean — noise in non-interactive output is treated
   as a bug.

Color handling respects `NO_COLOR` and absence of a TTY. All art lives in one
module (`art.ts`) so presentation is isolated from logic and easy to test (the
TTY/`NO_COLOR`/`--quiet` suppression rules are unit-tested against a fake
stdout).

## Threat model — what we do and don't defend against

Being explicit here keeps the tool honest and prevents the overclaiming that
rightly gets security tools mocked.

**We defend against (consumer-side governance):**

- A dependency entering the repo *silently* — raw `pnpm add`, a hand-edited
  `package.json`, or an agent skipping review. `check` fails CI with no ledger
  entry.
- An agent self-approving a risky dependency by inventing a reason — `reason` is
  attribution only; merging a high-risk entry requires a second-party
  `approvedBy` (see `requireApprovalForHighRisk`).
- Adding a dependency that a built-in or an already-present package makes
  unnecessary — the alternatives engine surfaces it before it's added.
- Install-scripted packages slipping in unreviewed — blocked by default.

**We do NOT defend against (out of scope by design):**

- **Publisher-side / pipeline compromise** — e.g. the TanStack incident
  (May 2026): a poisoned CI cache stole an OIDC token and published malware
  directly to npm. No install script, no typosquat. This is a *maintainer's*
  problem (pin actions to SHAs, fix `pull_request_target`, per-publish OIDC
  gates). Our consumer-side gate has no bearing on it. For *downstream consumers*
  of such a release, the relevant defense is the **release-age cooldown** — which
  is now **native** in pnpm/Yarn/npm, not something we provide. We at most
  *verify it is configured*.
- **Behavioral / deep scanning** — obfuscated payloads, network/filesystem access
  in install scripts, malware signatures. That is `npq`/Socket's job.
- **A determined local actor** — anyone who can run code locally can hand-forge a
  ledger entry. The irreducible backstop is branch protection + human review of
  ledger/`package.json` diffs. Our job is only to guarantee every path to a
  passing CI leaves a reviewable artifact.

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
