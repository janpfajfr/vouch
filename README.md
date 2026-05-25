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

## What it is not

Not a scanner. Deep per-package analysis (typosquatting, CVEs, behavioral) is the
job of tools like `npq` and Socket. This tool owns **provenance and enforcement**.

## Overrides

    safe-add some-package --force-with-reason "Needed for customer bugfix"

A reason is *attribution*. A high-risk dependency only passes CI once a human
adds `approvedBy` to its ledger entry (`requireApprovalForHighRisk`).

## Zero dependencies

`"dependencies": {}`. Built on Node 18+ built-ins. A dependency-security tool
with no dependencies.
