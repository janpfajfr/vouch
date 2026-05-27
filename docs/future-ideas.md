# Future ideas

Things considered and deliberately deferred, so the foundation stays small. Not commitments.

## Alternatives engine (removed in favor of simplicity)

A nudge that suggests a built-in or lighter alternative when you add a dependency — e.g.
`uuid` → `crypto.randomUUID()`, or "you already use remeda, prefer it over lodash."

A first version existed (`src/alternatives.ts`) but was a thin, hardcoded list (≈4 built-ins,
≈3 equivalents, plus a `knownAlternatives` config map), and the equivalents only fired when the
alternative was already installed. It was removed to keep the tool focused on its core promise
(record · review · drift), rather than shipping a half-built recommendation engine.

If revisited, decide first:

- **Coverage** — how big a curated set is worth maintaining, and where the data lives (still
  zero runtime deps).
- **Assertiveness** — suggest only already-installed equivalents (soft, rarely fires) vs.
  surface known-lighter options regardless (stronger, risks being preachy).
- **Placement** — keep it a note at add time, never a `check` gate (it's advice, not policy).

Until then, teams can record their own rationale in each ledger entry's `reason`.

## Lockfile-resolved version drift

Version-drift currently compares the recorded `approvedVersion` against the `package.json`
*range*, so drift *within* a range (e.g. recorded `4.17.20`, range `^4`, lockfile `4.17.21`)
isn't caught. A stronger check would compare against the actually-resolved version — most
cleanly by reading `node_modules/<pkg>/package.json` (PM-agnostic JSON) rather than parsing each
lockfile format. Needs an install step before `check`, so it's an opt-in upgrade, not the
default.
