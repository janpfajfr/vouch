# you-shall-not-add

![banner](assets/banner.svg)

A **dependency-governance gate** for Node.js projects and coding agents.

> The tool does not prevent the bypass. It makes the bypass impossible to hide.

Instead of running:

    pnpm add some-package

use:

    npx you-shall-not-add some-package      # alias: safe-add

It reviews the package (version age, install scripts), suggests built-in or
already-present alternatives, then installs and records the decision in a
committed approval ledger (`.security/dependency-approvals.json`).

In CI, `you-shall-not-add check` fails any pull request that introduced a
dependency without a ledger entry — so a raw `pnpm add` (by a human or an agent)
cannot slip in unreviewed.

## What it checks

- **Version age** — explains risk before the lockfile changes (release-age
  cooldowns are native in pnpm/Yarn/npm; we surface and verify, not reimplement).
- **Install-time scripts** — blocked by default.
- **Alternatives** — `uuid` → `crypto.randomUUID()`, or "you already have remeda".
- **CVE drift** — `safe-add` warns you at install time if the version you're adding already
  has a known advisory (so `check` is never the first messenger). Thereafter, if a dependency
  gains an advisory nobody acknowledged, `check` fails until a human runs
  `safe-add reapprove <pkg> --approved-by "<name>"`. Offline never fails the gate
  (we warn that we couldn't verify, but only *block* on a CVE we confirmed).

## What it is not

Not a scanner. Deep per-package analysis (typosquatting, behavioral) is the job of tools
like `npq` and Socket. We do not *scan* for CVEs at install time; we record the advisory
posture of what you approved and flag *drift* after the fact — provenance and enforcement,
not discovery. This tool owns **provenance and enforcement**.

## Overrides

    safe-add some-package --force-with-reason "Needed for customer bugfix"

A reason is *attribution*. A high-risk dependency only passes CI once a human
adds `approvedBy` to its ledger entry (`requireApprovalForHighRisk`).

## Re-approving after CVE drift

    safe-add check                                  # in CI: BLOCKED if a dep gained a CVE
    safe-add reapprove lodash --approved-by "Jane"  # a human acknowledges the new advisory

Re-approval re-queries advisories for the approved version and records the acknowledged set,
who acknowledged it, and when, in the committed ledger — so the acknowledgement is visible in
the PR diff. It refuses to write while offline (we never record an acknowledgement we couldn't
verify). Point `YSNA_ADVISORY_URL` at a mirror if you proxy the npm advisory endpoint.

## Zero dependencies

`"dependencies": {}`. Built on Node 18+ built-ins. A dependency-security tool
with no dependencies.
