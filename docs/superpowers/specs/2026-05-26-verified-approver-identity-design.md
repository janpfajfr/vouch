# Verified Approver Identity — Design

Date: 2026-05-26
Status: Draft for review

## Problem

`approvedBy` (high-risk authorization) and `cve.acknowledgedBy` (CVE acknowledgement) are
free-text strings the caller types. That is **a claim, not proof** — an agent or anyone can
type `"Jan"` exactly as easily as Jan can. For a tool whose entire value is honest provenance,
the authorizing identity being unverifiable is the weak link.

We want approver identity to be:
1. **Low-friction to capture** — ideally no name typed at all.
2. **Verifiable** — the gate should be able to confirm a real, permitted human approved, not
   just trust a string in a committed file.

## Core reframe

The trustworthy approver identity is not data we should ask the user to assert — it is
**whoever committed the approval**, which git (and GitHub) already record unforgeably-ish.
`approvedBy` as a self-typed field is largely redundant with "who authored this commit."
So the design leans on git/platform identity instead of trusting input.

> Don't *ask* the human who they are — *capture* it from something they already proved
> (their commit, their signature, their authenticated review).

## Goals / Non-goals

Goals: capture identity automatically; make approval verifiable at the CI boundary; keep the
human path soft (interactive) while making it impossible for an agent to self-approve; stay
zero-dependency and fail-safe.

Non-goals: building our own identity/PKI; replacing GitHub branch protection or CODEOWNERS
(we complement them); cryptographic guarantees from *local* signals (those are convenience).

## The model: soft locally, verified in CI

Trust cannot come from local input alone; it must be checked at the platform boundary.
So the model is two halves that compose:

- **Local (frictionless, low trust):** capture identity from `git config` and gate approval
  behind an interactive human prompt.
- **CI (the real authorization):** `vouch check` *verifies* the approval against the VCS /
  platform — a signed commit, or a GitHub PR review by a permitted human.

### Tiers

| Tier | Mechanism | Friction | Trust | Agent can forge? |
|---|---|---|---|---|
| 0 | Typed `--approved-by "Jan"` (today) | low | none | trivially |
| 1 | Auto-fill from `git config user.name <email>` | zero | low | yes (can set config) |
| 2 | Interactive "approve? [y/N]" at a TTY, identity from git | zero | low–med | only by faking a TTY |
| 3 | **CI verifies**: signed commit *or* GitHub PR review by an allowed human | med | high | no |

A project chooses how strict via config. Tiers 1–2 make the human path pleasant; Tier 3 is
what actually makes an approval *mean* something.

## Behavior

### Capturing identity (Tier 1) — `vouch approve`

New command (also closes the "no CLI to set `approvedBy`" gap — today it requires hand-editing
JSON):

```
vouch approve <pkg>                       # identity auto-derived from git config
vouch approve <pkg> --approved-by "Name"  # explicit override (Tier 0 fallback)
```

Derives the approver from `git config user.name` + `user.email`, records it plus the source.

### Interactive approval (Tier 2) — at add time

When `vouch <pkg>` hits a high-risk finding or a live CVE **and stdin/stdout is a TTY**:

```
esbuild is high-risk (postinstall script). Approve and record you as approver? [y/N]
```

- `y` → record the approval with the git-derived identity (Tier 1) + timestamp.
- **Non-TTY (agent / CI pipeline) → never prompted, cannot self-approve.** Falls through to
  the gate. The absence of a TTY is itself a weak "not a human" signal.
- `--yes` / `--no-input` flags to force non-interactive behavior in scripts.

### Verifying approval (Tier 3) — in `vouch check`

This is where authorization becomes trustworthy. `check` does not merely read `approvedBy`; it
confirms it against the platform:

- **`github-review` (recommended for GitHub teams):** a CI step (GitHub Action) calls the API
  to confirm the PR has an approving review from a human with write access / a CODEOWNER.
  The approver identity = the reviewer's GitHub login, authenticated by GitHub. Uses the
  Action's `GITHUB_TOKEN` and PR context; no new runtime dependency (native `fetch`).
- **`signed-commit` (platform-agnostic):** the commit that set this entry's `approvedBy` must
  be a verified signed commit (GPG/SSH) whose signer is in `allowedApprovers`. Implemented via
  `git` (`git log --format`/`verify-commit`) over `git blame` of the approval line.
- **`off` (default):** no verification; Tiers 0–2 only.

If verification is configured but cannot run (no token, detached context), behavior follows
`requireVerifiedApproval`: fail-open with a clear warning by default; fail-closed if the
project opts in. (Mirrors the CVE fail-open/closed split already in the tool.)

The ledger's stored identity becomes a **cache/record**; CI is the **verifier**. If the cached
`approvedBy` disagrees with the verified identity, `check` flags it.

## Data model

Unify high-risk approval and CVE acknowledgement under a small, explicit shape rather than
bare strings:

```ts
interface Approval {
  by: string;                                   // "Jan Pfajfr <jan@…>" or a GitHub login
  via: "manual" | "git-config" | "signed-commit" | "github-review";
  at: string;                                   // ISO 8601
  ref?: string;                                 // commit SHA or PR review id, when verified
}
```

- `LedgerEntry.approval?: Approval` (supersedes bare `approvedBy`; keep reading the old field
  for back-compat / migration).
- `CveSnapshot` reuses the same shape for the acknowledgement (`acknowledgedBy` → an `Approval`).

`via` records *how* the identity was obtained, so a reader can see at a glance whether an
approval was merely typed or actually verified.

## Config (`.safe-dep.json`)

```json
{
  "approval": {
    "identity": "git-config",
    "interactive": true,
    "verify": "off",
    "requireVerifiedApproval": false,
    "allowedApprovers": ["jan@example.com", "@org/maintainers"]
  }
}
```

All optional; defaults keep today's behavior (manual identity, no verification) so existing
projects are unaffected.

## The agent story (why this holds)

1. An agent runs `vouch react` — no TTY, so no interactive approval; it cannot self-approve.
2. `vouch check` in CI sees no *verified* approval → **fails**.
3. A human approves the PR (GitHub review) — authenticated by GitHub.
4. CI re-runs, verifies the review via the API → **passes**, recording the reviewer's login.

The agent literally cannot manufacture a verified approval; the human's authorization is
captured from something they proved, not something anyone typed.

## Honest limits

Tiers 1–2 (`git config`, TTY presence) are **convenience, not security** — a determined local
process can fake both. They reduce friction and add a soft human signal; they do not, alone,
make an approval trustworthy. Only Tier 3 (signed commit / authenticated PR review) does. The
design is explicit that local makes it *pleasant* and CI makes it *real*.

## Phasing (YAGNI)

This is large; ship it in slices, each independently valuable:

- **Phase 1 (small, immediate):** `vouch approve` + Tier 1 (git-config identity) + Tier 2
  (interactive prompt at add time) + the `Approval` data model with `via`. Also fold in the
  `--force-with-reason` arg-order hardening (a separate small fix already identified). No
  verification yet — but it ends "type any name" and captures real-ish identity ergonomically,
  and gives a CLI for approval instead of hand-editing JSON.
- **Phase 2 (the real gate):** Tier 3 verification — `github-review` in CI first (highest
  value for GitHub teams, least setup), then `signed-commit` for platform-agnostic use.

Recommendation: build Phase 1 now; treat Phase 2 as a follow-up spec/plan once Phase 1 lands.

## Files likely touched (Phase 1)

- `src/ledger.ts` — `Approval` type; `approval?` on `LedgerEntry`; back-compat read of `approvedBy`.
- `src/identity.ts` (new) — derive identity from `git config` (via `child_process`), pure-ish + testable.
- `src/cli.ts` — `approve` command; interactive prompt in `runSafeAdd` (TTY-gated); `--yes`/`--no-input`; force-with-reason hardening.
- `src/check-command.ts` — read `approval`/`approvedBy` consistently.
- Tests across the above; docs (README, AGENTS.md) for the new command and the attribution-vs-verified-authorization story.
