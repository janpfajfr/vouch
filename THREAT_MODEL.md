# Threat model

What `vouch` defends, what it deliberately does not, and where the real authorization lives.
Read this before relying on `vouch` as a security control.

## The one-sentence framing

> `vouch` makes a dependency decision **conscious, attributed, and auditable**. The
> authorization itself — a trusted human signing off — lives entirely on your code-review
> platform (GitHub/GitLab branch protection + required reviews), not in `vouch`.

`vouch` records decisions so reviewers approve them consciously. It does not attempt to verify
who approved, or to be the approval. Everything below follows from that line.

## Trust tiers

| Tier | Signal | Source | What it proves |
|------|--------|--------|----------------|
| 1 — attribution | ledger `addedBy` | `git config user.name/email` | *who claims* they recorded it — **self-asserted, forgeable** |
| 2 — provenance | the committed, reviewed ledger entry in the PR diff | the repo | that the dependency add was a *deliberate, recorded, reviewable* decision |

**Tier 1 is attribution, not authorization.** `git config` can be set to any name and email,
so `addedBy` answers "who says so," never "who is allowed to." Treating the ledger field as
the approval is the central mistake this document exists to prevent.

**The authorization is not a tier `vouch` owns.** It is the PR/MR review on the platform — a
human approving the change with the ledger entry visible in the diff. `vouch` deliberately
does **not** read, verify, or reproduce that review. It feeds the platform gate; it is not the
gate.

## What `vouch` defends well

- **Silent dependency creep.** A new dependency is technically visible in the lockfile diff,
  but buried where no reviewer reads it. `vouch check` *fails the build* on any added
  dependency with no ledger entry, pulling the decision up to eye level.
- **Undocumented high-risk adds.** A high-risk entry must carry a `reason`, so the reviewer
  has something to judge.
- **CVE drift after the fact.** `check` re-queries advisories for the recorded version and
  blocks when a dependency *you recorded* gained a new advisory since. Fail-open: offline or a
  stalled endpoint warns, never fails. Clear it by fixing, removing, or `vouch acknowledge`.
- **Tamper-evidence.** Every decision is a committed JSON entry in the PR diff — auditable
  forever, hard to change without it showing up in history.

## What `vouch` does NOT defend (by design)

- **Humanness behind a credential.** No tool can distinguish a human from an agent acting with
  that human's token. If an account that can approve is in an agent's hands, the gate is only
  as strong as that credential's custody — which lives outside `vouch`. Keep approval
  credentials out of agent hands; `AGENTS.md` instructs agents not to self-authorize.
- **Per-package vulnerability discovery.** `vouch` records the advisory posture of what you
  recorded and flags drift; it does not *scan* to discover typosquatting or malware. That is
  the job of `npq` / Socket.
- **Transitive install-time scripts.** The install-script gate inspects only the package you
  add directly, not its dependency tree. A transitive dependency's `postinstall` is out of
  scope — pair `vouch` with a package-manager release-age cooldown and, if you need it,
  deeper per-package scanning.
- **Who approved the PR.** `vouch` does not verify the reviewer. That is the platform's job,
  enforced by branch protection.

## Recommended deployment

To get the strongest gate `vouch` is designed to feed:

- Enable branch protection requiring a review, and **require review from someone other than
  the last pusher**.
- Put `package.json` and the lockfile under `CODEOWNERS` if you want a dedicated approver
  group.
- Run `vouch check` on `pull_request` (see `examples/github-actions-check.yml`).
- On GitLab, enable *Prevent approval by author* so the platform requires a second principal.

See the [README](README.md) for configuration.
