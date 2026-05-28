# Engineering vouch — source notes for an article

> Raw material for a write-up about how `vouch` was built. Decisions, reversals, hard parts,
> and the working discipline that produced them — woven, since the *engineering story* and the
> *product story* are the same story here. Mine what you need; the prose is yours.

---

## The one-paragraph arc

`vouch` started as `you-shall-not-add` / `safe-add` — a "dependency-governance gate" with a
ledger, a CI check, and ambitions toward verifying *who* approved each dependency. It shipped
Phase 1 (capture the human's git identity at approve time) and Phase 2 (verify approvals
against real GitHub PR reviews). Then it deliberately *un-shipped* Phase 2, rewrote its own
positioning around a sharper line — **"vouch records; the PR review approves"** — and trimmed
itself toward a foundation small enough to defend. From that foundation it then grew
narrower-and-stronger features (version drift, opt-in pinning, configurable CVE blocking) and
quieter UX (calm structured output with a `✦ vouch` status marker). The interesting story
isn't the features; it's the *reversal in the middle* and the discipline that allowed it.

---

## Cast of decisions (the timeline a reader can hang the story on)

| PR | Decision | Direction |
|---|---|---|
| #2 | Clean rewrite: dependency-governance gate + CVE provenance | Build |
| #6 | `--help` / `--version` | Build |
| #7 | Spec: verified approver identity | Design |
| #8 | Phase 1: `vouch approve` + captured git identity + `--force-with-reason` | Build |
| #9 | Phase 2: live PR-review verification via GitHub API | Build |
| **#10** | **Foundation simplification** — retire Phase 2, drop `approve`, rename "approval" → "decision", reframe "vouch records; the PR review approves" | **Reversal** |
| #11 | Version-drift + opt-in `requirePinned` | Narrow & strong |
| #12 | Calm structured output + `✦ vouch` status marker; wordmark restricted to `--help` | UX |
| #13 | Retro pixel-art banner (raster PNG, not vector — explained why) | Identity |
| #14 | README restructure (evaluator → adopter funnel) **+ remove the alternatives nudge** | Trim |
| #15 | External-audit cleanup (lockfile hygiene, config enum validation, deprecated→finding) | Hygiene |
| #16 | `cveAtInstall: "warn" \| "block" \| "off"` + severity threshold | Configurable strictness |

---

## The pivotal moment: gate, or feeder of a gate?

Phase 2 (PR #9) shipped a real implementation that read GitHub PR reviews and asserted: "a
permitted human approved this PR." The morning after, the user asked a sharp question:
**"what if an agent uses the gh / glab CLI?"** That probe surfaced the trust boundary the
tool couldn't cross — vouch can authenticate an *account*, not a *human*.

The honest write-up of that boundary (`docs/threat-model.md`) admitted the verification was
informational, with four known gaps. Once the gaps were on paper, the next step wrote itself:
the user produced a *Foundation Simplification* spec, and the verification subsystem was
deleted in PR #10.

### What changed in the reframe
- **Out:** `vouch approve`, `approvedBy`-as-authorization, the GitHub review subsystem
  (`src/review.ts`), the `approval` config block, `requireApprovalForHighRisk`.
- **Renamed:** `vouch reapprove --approved-by` → **`vouch acknowledge <pkg> --reason "<why>"`**
  (scoped strictly to CVE/risk drift).
- **In:** capture `addedBy` from `git config` at *add* time, as *attribution* (self-asserted,
  never authorization).
- **The sentence the rest of the product now obeys:**
  > vouch records decisions; the PR/MR review is the approval.

### Why the reversal isn't waste
- The Phase 2 work *produced the insight*. Without writing the verification, the team
  wouldn't have learned where the trust boundary actually sits — or believed it.
- The threat-model doc survives the deletion almost verbatim: the trust tiers, the
  "humanness-behind-a-credential" disclaimer, the deployment recommendation.
- The team got to choose deliberately, with the artifact in hand, rather than ship it and
  then quietly regret it.

> Worth quoting: "the verification work produced the insight that led to this doc."

---

## Decisions, with the process that produced each (woven)

### Threat-model doc (before #10)
The pivot didn't happen by argument — it happened by *writing the trust model down*. The
moment "verified approval" got placed alongside "self-asserted attribution" in a single trust
table, the question "is vouch the gate or does it feed a gate?" answered itself.

**Methodology callout:** sometimes the unblocking move is to *write the framing*, not to
build the feature.

### Foundation simplification (#10)
Run as a real engineering project, not a tweak: brainstorm → spec → multi-task plan → execute
inline with commits per task → finishing-a-development-branch → PR. The simplification was
disciplined enough that the eight tasks could be reviewed and committed independently, even
though they cut a feature shipped 24 hours earlier.

### Version drift (#11) — solving without dependencies
- vouch has zero runtime deps, by promise. Version-drift detection needs a *semver range
  satisfaction* check (`approvedVersion` against the `package.json` range).
- No `semver` library to lean on. Wrote a small `src/semver.ts` covering the ranges that
  actually appear in package.json: exact, `^`, `~`, x-ranges, comparators, `||`.
- **The hard part:** false positives. A weird range (`"latest"`, `github:user/repo`,
  `file:../x`) parsed badly could cause a *false drift* warning, which would erode trust.
  Resolution: `satisfiesRange` returns `null` for any range it cannot confidently parse, and
  callers treat `null` as **skip** — never a drift signal.
- **Defaults:** warn-by-default; `"block"` and `"off"` available. Configurable, not opinionated.

### Pinning (#11) — opt-in by design
- "Warn if a dependency isn't pinned" sounds nice and useful. It would also fire on nearly
  every `^`-range dependency in a typical project — too noisy by default for a "small, soft,
  smart" tool.
- **Choice:** ship the capability (`requirePinned: "off" | "warn" | "block"`) but default to
  `"off"`. Teams that want strict pinning opt in. The warning, when on, suggests the *exact
  recorded version* to pin to — leveraging the resolved version stored at add time.

### Calm output (#12)
- Started with a big ASCII block banner ("PACKAGE REJECTED" → "DEPENDENCY NEEDS REVIEW") that
  printed on every blocked install, plus a 6-line wordmark on every command.
- Product principle the user articulated:
  > README/banner can be playful. **Terminal output should be calm and useful.**
- The redesign landed on a small `✦ vouch` status marker (cyan brand), semantic color by
  meaning (green pass, yellow needs-review, red failed), and 2-space-indented detail blocks.
- The wordmark moved to `--help` only. `--quiet` drops the decorative marker.
- **Subtle hard part:** the calm output had to remain *honest* under piping/CI. Color must
  auto-strip when stdout isn't a TTY; tests pin that. Multi-line CVE reasons had to render
  acceptably inside a one-line-per-violation bullet list — chose not to special-case them.

### The banner (#13) — raster, intentionally
- User asked: "is it a problem that it's PNG not SVG?"
- Honest answer: PNG is correct. The banner is a **raster pixel-art illustration**, not
  vector. SVG is for line/shape primitives; you can't meaningfully express a detailed
  pixel-art scene in vectors, and downscaling pixel art on non-integer factors blurs the
  intentional crisp edges.
- File size came up (1.65 MB). Without `pngquant` available locally, the right call was
  *keep the quality, document the optimization path* rather than degrade the art for ~0.3 MB.

### README rewrite + alternatives removal (#14)
- The user said "**before you start** — I think the README is super important." Right call —
  rewriting was design work, not editing.
- Did a tiny brainstorm before drafting: clarified the **audience funnel** (evaluator first,
  adopter second), the **voice** (trimmed-poetic, not flowery), and the four concrete
  additions (TOC, install, copy-paste CI YAML, real output examples).
- Picked the "show first" funnel: **what it is → see it → use it → go deep**, with the real
  `✦ vouch` output appearing before any setup instructions.
- **Inside the same PR**, the user asked "how strong are we on the alternatives feature?"
  Honest audit: 4 built-ins + 3 install-gated equivalents + a config overrides map. Tiny,
  thin, soft by design. User's call: **remove it entirely, capture as a future idea.** That
  cut shipped on the same branch as the README, because the README had been about to claim
  something the tool barely did. Code and docs stayed consistent in one reviewable unit.

### Audit response (#15)
An external auditor produced nine findings. Discipline mattered here:
- **Verified every claim against the code** before opining — confirmed all nine, found zero
  false positives.
- Reordered by *impact*, not by audit order: lockfile mess (#1) and silently-downgrading
  config (#7) were the only ones with real teeth.
- **Reframed** finding #2 ("unused registry fields") from "dead code" into an *opportunity*:
  `deprecated` is genuinely useful — turned into a `warn`-level finding at add time. The
  truly unused `hasRepository`/`hasLicense` got deleted.
- **Deferred** three on principle (#4, #5, #8) — low-value smells, called them out
  explicitly in the PR rather than implementing for politeness.

> Worth quoting: "all nine claims verified true; zero false positives."

### CVE at install (#16) — configurability + severity
- Started as a user observation: "the install doesn't block on critical CVE." It didn't, by
  design. The README/code reflected that: "warn at add time, block at check time."
- The honest tension was named out loud: install scripts block, CVEs warn — asymmetric for a
  tool that aspires to consistency.
- Resolution: make it configurable. **`cveAtInstall: "warn" | "block" | "off"` (default
  warn)** + **`cveAtInstallMinSeverity` (default `"high"`)**. Teams that want stricter pick;
  the default preserves the soft posture.
- **Bonus correctness fix surfaced live:** during the demo run, the forced ledger entry
  showed `risk: "low"` — because the CVE finding wasn't fed into `overallRisk`. Unified the
  findings pipeline so a CVE block becomes `risk: "high"`. Tests assert it.

---

## Hard parts (the real ones)

| Tension | How it resolved |
|---|---|
| Sunk-cost of Phase 2 vs. honest reframe | Wrote the threat-model first; the deletion followed naturally |
| Half-built "alternatives engine" looks like a feature | Honest audit (4+3 entries) → cut, captured as future idea |
| Zero-dep promise vs. needing semver | Hand-rolled minimal semver with **null-skip** for unsupported ranges |
| Lockfile format zoo (npm JSON, pnpm YAML, yarn custom, bun binary) for resolved-version drift | Deferred entirely; documented `node_modules/<pkg>/package.json` as the cleaner future path |
| "Show critical CVE as warning" feels weak; "always block" is brittle | Configurable with severity threshold; defaults stay soft |
| Banner: PNG vs SVG, file size vs crispness | Educate user (PNG is correct for raster), keep quality, point at `pngquant` as the path |
| README: keep poetic voice or go crisp? | Trimmed-poetic — kept one or two lines of personality, cut the rest |
| Big block banner on every blocked install | Removed entirely; replaced with `✦ vouch` status line + structured detail |
| External-audit pressure to act on every finding | Verified, prioritized, deferred low-value ones with reasons |

---

## What changed on the way (concrete reversals)

- **Tool name:** `you-shall-not-add` / `safe-add` → **`vouch`** (PR #2 era).
- **Phase 2 verification:** shipped (#9) → retired (#10). The threat-model doc carried the
  insight forward.
- **`vouch approve` / `vouch reapprove`:** removed; replaced by **`vouch acknowledge --reason`**,
  scoped to CVE drift only.
- **Ledger fields:** `approvedBy`/`approvedAt` → `addedBy`/`addedAt` (attribution wording).
- **"Approval" language:** stripped from product copy; survives only in the ledger filename
  (`.security/dependency-approvals.json`), kept for back-compat.
- **Alternatives engine:** existed → deleted. Captured in `docs/future-ideas.md`.
- **Block banner art:** existed → removed. Replaced by `✦ vouch` calm output.
- **Wordmark:** every command → `--help` only.
- **README opening line:** "dependency-governance gate" → **"dependency-decision ledger"**.
- **`check` violation wording:** "not in the ledger — record it: vouch X" → **"missing ledger
  entry"** (the new "Next:" footer carries the action).
- **Config:** `knownAlternatives` removed; `requireApprovalForHighRisk` removed; **enum
  validation added** (a typo'd `versionDrift: "blcok"` no longer silently downgrades to warn).
- **Lockfiles:** stray `pnpm-lock.yaml` removed; `package-lock.json` regenerated so its name
  is `vouch`, not the pre-rename `you-shall-not-add`.

---

## The discipline that held it together

Worth foregrounding for an article about how *AI-paired engineering* can be done without
turning into vibes:

1. **Brainstorming before creative work** — questions one at a time, propose 2–3 approaches,
   recommend one, get explicit approval *before* code. Used for the foundation simplification,
   the README rewrite, and (lightly) for the CVE-at-install question.
2. **Spec → plan → execute → finish.** Multi-task plans were saved under
   `docs/superpowers/plans/`, each step had bite-sized commits and expected outputs. Execute
   step ran the plan with tests at every task.
3. **TDD by default.** New behaviors got a failing test first when feasible (e.g., the
   `satisfiesRange` cases, the `checkKnownCve` matrix, the config enum validation).
4. **Verification = run the app, not the tests.** A separate "verify" discipline: build the
   CLI, point a real demo at it, capture the actual output. Caught real bugs that tests
   missed (the `risk: "low"` on forced CVE entries was found this way).
5. **Receiving code review with rigor** — verify each claim against code; agree or push back
   per evidence; defer with reasons rather than implementing politely.
6. **Honest naming** — when the product positioning was inconsistent ("governance gate" in the
   README vs. "decision ledger" in the CLI), we changed the README, not the CLI.
7. **One branch per concern, one PR per concern, multiple commits per PR.** Made it easy to
   review the audit cleanup (one commit per finding) and to fold tightly-coupled changes
   together (README rewrite + alternatives removal).
8. **`/Users/jan.pfajfr@rossum.ai/.../docs/future-ideas.md` exists.** Deferred work is
   captured visibly; "we considered and chose not to" is part of the design record.

---

## Quotable bits & artifacts

- "**vouch records decisions; the PR/MR review is the approval.**" (the founding sentence
  after #10)
- "**It doesn't prevent the bypass. It makes the bypass impossible to hide.**" (the original
  tagline, surviving every reframe)
- "**The verification work produced the insight that led to this doc.**" (on un-shipping
  Phase 2)
- "**Worth quoting: 'all nine claims verified true; zero false positives.'**" (the audit)
- "**README/banner can be playful. Terminal output should be calm and useful.**" (the UX
  principle behind #12)
- "**Small, soft, smart, not complicated.**" (the foundation doc's tonal anchor)
- The `✦ vouch` marker as the single brand flourish in normal output.
- `docs/threat-model.md` — the trust-tier framing that survived the feature deletion.
- `docs/future-ideas.md` — alternatives engine, lockfile-resolved drift.

---

## Suggested article structure (one option)

1. **Opening anecdote:** ship Phase 2 verification → ask the question that breaks it →
   un-ship a day later. The article's hook.
2. **Why writing the threat model first changed everything.** The lesson about *framing
   before features*.
3. **The foundation simplification, mechanically.** Walk through the eight-task plan; show
   how disciplined removal looks.
4. **Designing under constraints** (zero deps, calm output, small surface): semver from
   scratch, the alternatives nudge that wasn't worth shipping, the `✦ vouch` marker.
5. **Receiving criticism well** (the external audit). What "honest review" looks like in
   practice — verify every claim, prioritize by impact, defer with reasons.
6. **The product the discipline produced.** A small, deliberately limited tool whose entire
   product story is "we said no to the right things."
7. **Closing:** a line on AI-paired engineering — the work was paired, the gates were real,
   the reversals were honest, the artifacts (specs, plans, threat model, audit response, this
   notes file) are *evidence* you can show to your reviewers.
