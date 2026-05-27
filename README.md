# vouch

![banner](assets/banner.png)

A **dependency-governance gate** for Node.js projects and coding agents.

> It doesn't prevent the bypass. It makes the bypass **impossible to hide.**

It's not a scanner and not a security product. It's a **memory and conscience** for your
dependencies: it records who decided to add each one, why, and at what version — then taps
you on the shoulder, quietly, when the world changes underneath a decision someone made.

---

## The idea in three points

1. **Every dependency is a decision.** Adding one should be reviewed and *recorded* — by a
   named human — not slipped in silently.
2. **The record lives in your repo.** Decisions go into a committed ledger
   (`.security/dependency-approvals.json`), so they're visible in the PR diff and auditable forever.
3. **The record stays honest over time.** When a dependency you vouched for later gains a
   known advisory, CI surfaces it until a human re-decides.

---

## Quick start

Instead of:

    pnpm add some-package

run:

    npx vouch some-package      # or, installed: vouch some-package

Then, in CI, add one step:

    npx vouch check             # fails the build on any unreviewed dependency

That's it. A raw `pnpm add` (by a human *or* an agent) can no longer reach `main` unreviewed.

---

## How it works

**When you add a package** (`vouch`):

1. Suggests **built-in or already-present alternatives** (`uuid` → `crypto.randomUUID()`,
   "you already have remeda").
2. Reviews it: **version age** and **install-time scripts** (blocked by default).
3. Warns you **right then** if the version already has a **known CVE** — so `check` is never
   the first messenger.
4. Installs it, and records the decision (version, risk, who/why) in the ledger.

**In CI** (`check`):

- Fails the build if any dependency in `package.json` has **no ledger entry** — i.e. it was
  added without `vouch`.
- Fails if a dependency **gained a CVE** that no human has acknowledged.
- Fails if a **high-risk** entry has no `reason` recorded — so the reviewer can judge it in the PR.
- **Version drift:** when a recorded version no longer satisfies the `package.json` range, a
  decision was made for a version you no longer ship. Default `versionDrift: "warn"` surfaces it
  without failing; set `"block"` to fail CI, or `"off"` to disable. Direct deps only; compared
  against the `package.json` range (no lockfile). Re-record with `vouch <pkg>`.
- **Pinning (opt-in):** `requirePinned` warns (`"warn"`) or fails (`"block"`) when a recorded
  dep uses a range (`^`, `~`, …) instead of an exact version, suggesting the recorded version
  to pin to. Default `"off"` — turn it on for repos that want exact pins.

---

## Commands

| Command | What it does |
|---|---|
| `vouch <pkg> [-D]` | Review, install, and record a dependency (`-D` for devDependencies). |
| `vouch <pkg> --force-with-reason "<why>"` | Override a block, recording the reason in the ledger. |
| `vouch check` | CI gate: fail on unrecorded deps, unexplained high-risk, or CVE drift. |
| `vouch acknowledge <pkg> --reason "<why>"` | Knowingly accept a dependency's current advisories (CVE drift). |

Environment: `YSNA_ADVISORY_URL` overrides the npm advisory endpoint (for enterprise mirrors/proxies).

---

## vouch records; the PR review approves

This distinction is the heart of the tool:

- **vouch records a decision.** The ledger entry — who added it (`addedBy`, derived from `git
  config`), why (`reason`), at what version, with what risk — is *attribution*. It is
  self-asserted and not, by itself, an authorization.
- **The PR/MR review is the authorization.** A human approving the pull request — with the
  ledger entry visible in the diff — is the act that approves. vouch does not try to verify or
  replace that; it makes the decision conscious and reviewable.

You can always force a thing through with `--force-with-reason`. You can never do it
*invisibly* — the reason and your identity land in the committed ledger, in the diff, in front
of the reviewer. See [`docs/threat-model.md`](docs/threat-model.md) for what vouch does and
does not defend.

## When `check` blocks on a CVE

A block isn't damage — it's a pause: *something about a dependency you vouched for changed.*
You have three honest options, in order of preference:

1. **Fix it** — `vouch <pkg>@<patched-version>` to record a fixed release.
2. **Remove or replace it** — drop the dependency (or take a suggested alternative).
3. **Accept it knowingly** — once you've judged the risk acceptable (dev-only, unreachable
   code path, no fix yet), `vouch acknowledge <pkg> --reason "<why this is acceptable>"`.

`acknowledge` re-queries advisories for the recorded version and records the acknowledged set,
who acknowledged it (from `git config`), why, and when — visible in the PR diff. It refuses to
write while offline (we never record an acknowledgement we couldn't verify).

It only blocks on a CVE it **confirmed**: offline or a stalled endpoint fails *open* (a warning,
never a failed build), and it blocks only the specific dependency that drifted — never your
whole project.

---

## Configuration (`.safe-dep.json`)

All optional; sensible defaults apply.

```json
{
  "minimumVersionAgeHours": 24,
  "warnVersionAgeHours": 168,
  "blockInstallScripts": true,
  "requireCooldownConfigured": false,
  "versionDrift": "warn",
  "requirePinned": "off",
  "allowScopedPackages": ["@your-org/*"],
  "packageManager": "auto",
  "knownAlternatives": { "moment": "Prefer date-fns or the Intl APIs." }
}
```

---

## For coding agents

`AGENTS.md` tells agents to use `vouch` instead of raw installs, to explain *why* a
dependency is needed before adding it, and — crucially — **not** to silence the gate on a
human's behalf. As agents add more dependencies, the ledger becomes the place a human reviews
those decisions, asynchronously and accountably.

---

## What it is *not*

Not a scanner. Deep per-package analysis (typosquatting, behavioral) is the job of tools like
`npq` and Socket. We don't *scan* for CVEs to discover them — we record the advisory posture of
what you recorded and flag **drift** after the fact. This tool owns **provenance and enforcement**.

---

## Zero dependencies

`"dependencies": {}`. Built on Node 18+ built-ins. A dependency-security tool with no
dependencies of its own.
