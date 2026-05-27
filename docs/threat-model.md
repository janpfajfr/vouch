# Threat model

What `vouch` defends, what it deliberately does not, and the gaps that are *known* rather
than hidden. Read this before relying on `vouch` as a security control.

## The one-sentence framing

> `vouch` makes a dependency decision **conscious, attributed, and auditable**. The
> authorization itself — the act of a trusted human signing off — lives on your code-review
> platform (GitHub/GitLab branch protection + required reviews), not in `vouch`.

`vouch` *feeds* a platform gate; it does not, on its own, *replace* one. Everything below
follows from that line.

## Trust tiers

Each signal `vouch` records sits at a different level of trust. Conflating them is the main
way to misread the tool.

| Tier | Signal | Source | What it proves |
|------|--------|--------|----------------|
| 1 — attribution | ledger `approvedBy` | `git config user.name/email` | *who claims* they approved — **self-asserted, forgeable** |
| 2 — provenance | ledger entry, committed in the PR diff | the repo | that a dependency add was a *deliberate, recorded* decision |
| 3 — authorization | approving PR review by a permitted human | the platform API | that a *platform-authenticated* account with write access signed off |

**Tier 1 is attribution, not authorization.** `git config` can be set to any name and email,
so `approvedBy` answers "who says so," never "who is allowed to." Treating the ledger field as
the approval is the central mistake this document exists to prevent.

**Tier 3 is the real gate.** `vouch check`'s optional verification
(`approval.verify: "github-review"`) confirms a permitted reviewer approved the PR via the
GitHub API. That is the act that authorizes — and it is enforced by *your branch protection*,
not by `vouch`.

## What `vouch` defends well

- **Silent dependency creep.** A new dependency is technically visible in the lockfile diff,
  but buried where no reviewer reads it. `vouch check` *fails the build* on any added
  dependency with no ledger entry, pulling the decision up to eye level.
- **Undocumented high-risk adds.** High-risk entries must carry a `reason` and (with
  `requireApprovalForHighRisk`) a recorded approver.
- **CVE drift after the fact.** `check` re-queries advisories for the approved version and
  blocks when a dependency *you vouched for* gained a new advisory since approval. Fail-open:
  offline or a stalled endpoint warns, never fails.
- **Tamper-evidence.** Every decision is a committed JSON entry in the PR diff — auditable
  forever, hard to change without it showing up in history.

## What `vouch` does NOT defend (by design)

- **Humanness behind a credential.** No tool can distinguish a human from an agent acting
  with that human's token. If an account that can approve is in an agent's hands, the gate is
  only as strong as that credential's custody — which lives outside `vouch`. Keep approval
  credentials out of agent hands; `AGENTS.md` already instructs agents not to self-authorize.
- **Per-package vulnerability discovery.** `vouch` records the advisory posture of what you
  approved and flags drift; it does not *scan* to discover typosquatting or malware. That is
  the job of `npq` / Socket.
- **The platform's own authentication.** `vouch` trusts that GitHub correctly authenticated
  the reviewer account. It verifies *that* a permitted account approved, not *who was really
  at the keyboard*.

## Known gaps (tracked, not hidden)

These are real limitations of the current verification pass. They are documented here rather
than papered over; hardening them is the subject of a future phase.

1. **PR-level, not dep-level, verification.** `verifyApprovals` confirms *a* permitted human
   approved the PR — one approval blesses every high-risk add in that PR. It does not require
   each high-risk dependency to be named in the approval.
2. **Bot reviews are not excluded.** Approvals are filtered by `author_association`
   (`OWNER`/`MEMBER`/`COLLABORATOR`) but not by account `type`. A bot/automation account with
   write association would currently count.
3. **Reviewer ≠ author is not enforced.** `vouch` relies on the platform's own self-approval
   block. GitHub forbids approving your own PR; GitLab allows it unless *Prevent approval by
   author* is enabled. On GitLab you must enable that setting to match GitHub's baseline.
4. **Ledger identity and PR reviewer are not linked.** The Tier-1 `approvedBy` (a git email)
   and the Tier-3 reviewer (a GitHub login) are never checked to be the same person. There is
   no reliable automatic mapping between the two.

## Recommended deployment

To get the strongest gate `vouch` is designed to feed:

- Enable branch protection requiring a review, and **require review from someone other than
  the last pusher**.
- Put `package.json` and the lockfile under `CODEOWNERS` if you want a dedicated approver
  group.
- Set `approval.verify: "github-review"` and pin `allowedApprovers` to a known human set, so
  an attacker needs a *specific* person's credential, not just any write-access token.
- Set `requireVerifiedApproval: true` once reviews reliably land before `check` runs, to make
  an unverified high-risk approval fail the build.
- On GitLab, enable *Prevent approval by author*.

See the [README](../README.md) for configuration and `examples/github-actions-verify.yml` for
a ready-to-use workflow.
