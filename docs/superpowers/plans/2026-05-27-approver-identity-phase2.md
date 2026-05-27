# Approver Identity — Phase 2 (GitHub PR-review verification) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `vouch check` *verify* that a high-risk dependency's approval is backed by a real GitHub PR review from a permitted human — turning Phase 1's captured-but-unverified approval into a verified one.

**Architecture:** A new `src/review.ts` defines an injectable `ReviewClient` (pure verification logic + a fail-open `GitHubReviewClient` that reads the PR's reviews from the GitHub API using Actions env vars). `check` gains an approval-verification pass, gated by a new `approval` config block. **Fail-open by default** (can't verify → warn, never fail); `requireVerifiedApproval: true` opts into fail-closed. Verification is **live at check time and never written to the ledger** (check stays read-only).

**Tech Stack:** TypeScript (ESM/NodeNext, `.js` specifiers), Node 18+ built-ins only (native `fetch`), zero runtime deps, `node --test`.

**Spec:** `docs/superpowers/specs/2026-05-26-verified-approver-identity-design.md` (this is Phase 2, Tier 3, `github-review` mechanism only; signed-commit is a later option).

**Key design decisions (flagged for plan review):**
1. **PR-level granularity.** Verification confirms "a permitted human approved *this PR*", not a per-dependency match. We do not try to match a reviewer's GitHub login to the ledger's `approval.by` (a git-config name/email), which would be unreliable. The meaningful statement is: the changeset was reviewed by a permitted human.
2. **Chicken-and-egg → informational by default.** Reviews usually land after CI. So default (fail-open) mode only *warns* about verification status; only `requireVerifiedApproval: true` makes a confirmed "no permitted reviewer" a `check` failure.
3. **No ledger writes.** `Approval.via` stays `git-config`/`manual` (how identity was *captured*). `github-review` is a *verification result*, surfaced in `check` output, not persisted. (The spec lists `github-review` as a reserved `via` value; Phase 2 v1 does not write it.)
4. **`allowedApprovers`** (optional) restricts which reviewer logins count; empty = any reviewer with write-ish association (`OWNER`/`MEMBER`/`COLLABORATOR`).

**Conventions:** `.js` import specifiers; pure functions exported + unit-tested; HTTP clients kept thin and NOT unit-tested (see `NpmAdvisoryClient`/`NpmRegistryClient`) — exercised via fakes; tests use `node:test` + `assert/strict`. Single-file run: `npm run build && node --test 'dist/test/<file>.js'`.

---

### Task 1: `approval` config block

**Files:**
- Modify: `src/config.ts`
- Test: `test/config.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `test/config.test.ts` (it imports `loadConfig`/`DEFAULT_CONFIG`; check the existing imports and reuse them):

```ts
test("approval config defaults to verification off", () => {
  assert.deepEqual(DEFAULT_CONFIG.approval, { verify: "off", requireVerifiedApproval: false, allowedApprovers: [] });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build`
Expected: FAIL — `approval` not on `Config`.

- [ ] **Step 3: Implement**

In `src/config.ts`, add an interface and field:

```ts
export interface ApprovalConfig {
  verify: "off" | "github-review";
  requireVerifiedApproval: boolean;
  allowedApprovers: string[];
}
```

Add `approval: ApprovalConfig;` to the `Config` interface, and to `DEFAULT_CONFIG`:

```ts
  approval: { verify: "off", requireVerifiedApproval: false, allowedApprovers: [] },
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run build && node --test 'dist/test/config.test.js'`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts test/config.test.ts
git commit -m "feat: approval config block (verify/requireVerifiedApproval/allowedApprovers)"
```

---

### Task 2: `review.ts` — pure verification logic

**Files:**
- Create: `src/review.ts`
- Test: `test/review.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/review.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { permittedApprover } from "../src/review.js";

test("any write-association reviewer counts when allowedApprovers is empty", () => {
  assert.equal(permittedApprover(["alice", "bob"], []), true);
});

test("with allowedApprovers, only listed logins count", () => {
  assert.equal(permittedApprover(["bob"], ["alice"]), false);
  assert.equal(permittedApprover(["alice", "bob"], ["alice"]), true);
});

test("no reviewers means not verified", () => {
  assert.equal(permittedApprover([], []), false);
  assert.equal(permittedApprover([], ["alice"]), false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/review.ts`:

```ts
export interface ReviewClient {
  /** Logins of permitted (write-association) users who APPROVED the current PR.
   *  null = couldn't determine (no token / not a PR / API error) — fail-open. */
  approvingReviewers(): Promise<string[] | null>;
}

/** True if at least one reviewer is permitted: any reviewer when allow is empty,
 *  else a reviewer whose login is in the allow-list. */
export function permittedApprover(reviewers: string[], allowedApprovers: string[]): boolean {
  if (reviewers.length === 0) return false;
  if (allowedApprovers.length === 0) return true;
  const allow = new Set(allowedApprovers);
  return reviewers.some((r) => allow.has(r));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run build && node --test 'dist/test/review.test.js'`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/review.ts test/review.test.ts
git commit -m "feat: ReviewClient interface + permittedApprover logic"
```

---

### Task 3: `GitHubReviewClient` (fail-open HTTP, not unit-tested)

**Files:**
- Modify: `src/review.ts`

- [ ] **Step 1: Implement**

Append to `src/review.ts`:

```ts
import { readFileSync } from "node:fs";

const WRITE_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

interface PrContext { owner: string; repo: string; number: number; token: string; api: string; }

function prContext(): PrContext | null {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? "";
  const repo = process.env.GITHUB_REPOSITORY ?? "";
  const api = process.env.GITHUB_API_URL ?? "https://api.github.com";
  if (!token || !repo.includes("/")) return null;
  let number = NaN;
  try {
    const evt = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH ?? "", "utf8"));
    number = Number(evt?.pull_request?.number);
  } catch { /* not a PR event */ }
  if (!Number.isInteger(number)) return null;
  const [owner, name] = repo.split("/");
  return { owner, repo: name, number, token, api };
}

export class GitHubReviewClient implements ReviewClient {
  async approvingReviewers(): Promise<string[] | null> {
    const ctx = prContext();
    if (!ctx) return null;
    try {
      const res = await fetch(`${ctx.api}/repos/${ctx.owner}/${ctx.repo}/pulls/${ctx.number}/reviews?per_page=100`, {
        headers: { authorization: `Bearer ${ctx.token}`, accept: "application/vnd.github+json", "user-agent": "vouch" },
      });
      if (!res.ok) return null;
      const reviews = (await res.json()) as Array<{ state?: string; user?: { login?: string }; author_association?: string }>;
      const approvers = new Set<string>();
      for (const r of reviews) {
        if (r.state === "APPROVED" && r.user?.login && WRITE_ASSOCIATIONS.has(r.author_association ?? "")) {
          approvers.add(r.user.login);
        }
      }
      return [...approvers];
    } catch {
      return null;
    }
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: PASS. (No unit test — same convention as the other HTTP clients; logic is covered by `permittedApprover` + the fake client in Task 4.)

- [ ] **Step 3: Commit**

```bash
git add src/review.ts
git commit -m "feat: fail-open GitHub PR-review client (Actions env-driven)"
```

---

### Task 4: `verifyApprovals` — the check-time pass

**Files:**
- Modify: `src/check-command.ts`
- Test: `test/check-command.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `test/check-command.test.ts`:

```ts
import { verifyApprovals } from "../src/check-command.js";
import type { ReviewClient } from "../src/review.js";

const reviewClient = (r: string[] | null): ReviewClient => ({ async approvingReviewers() { return r; } });
const highApproved: Ledger = { evil: { ...base, risk: "high", reason: "needed",
  approval: { by: "Jan <j@x>", via: "git-config", at: "t" } } };

test("verifyApprovals: verified reviewer => no violation, no warning", async () => {
  const cfg = { ...DEFAULT_CONFIG, approval: { verify: "github-review" as const, requireVerifiedApproval: false, allowedApprovers: [] } };
  const r = await verifyApprovals(highApproved, cfg, reviewClient(["alice"]));
  assert.deepEqual(r.violations, []);
  assert.deepEqual(r.warnings, []);
});

test("verifyApprovals: cannot verify (null) => warn, no violation (fail-open)", async () => {
  const cfg = { ...DEFAULT_CONFIG, approval: { verify: "github-review" as const, requireVerifiedApproval: false, allowedApprovers: [] } };
  const r = await verifyApprovals(highApproved, cfg, reviewClient(null));
  assert.deepEqual(r.violations, []);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /could not verify/i);
});

test("verifyApprovals: no permitted reviewer, default => warn only", async () => {
  const cfg = { ...DEFAULT_CONFIG, approval: { verify: "github-review" as const, requireVerifiedApproval: false, allowedApprovers: [] } };
  const r = await verifyApprovals(highApproved, cfg, reviewClient([]));
  assert.deepEqual(r.violations, []);
  assert.equal(r.warnings.length, 1);
});

test("verifyApprovals: no permitted reviewer + requireVerifiedApproval => violation", async () => {
  const cfg = { ...DEFAULT_CONFIG, approval: { verify: "github-review" as const, requireVerifiedApproval: true, allowedApprovers: [] } };
  const r = await verifyApprovals(highApproved, cfg, reviewClient([]));
  assert.ok(r.violations.some((v) => /verified/i.test(v.reason)));
});

test("verifyApprovals: verify off => no-op", async () => {
  const r = await verifyApprovals(highApproved, DEFAULT_CONFIG, reviewClient(null));
  assert.deepEqual(r, { violations: [], warnings: [] });
});

test("verifyApprovals: no high-risk-approved entries => no-op even when on", async () => {
  const cfg = { ...DEFAULT_CONFIG, approval: { verify: "github-review" as const, requireVerifiedApproval: true, allowedApprovers: [] } };
  const r = await verifyApprovals({ ok: { ...base, risk: "low" } }, cfg, reviewClient([]));
  assert.deepEqual(r, { violations: [], warnings: [] });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build`
Expected: FAIL — `verifyApprovals` not exported.

- [ ] **Step 3: Implement**

In `src/check-command.ts`, add imports:

```ts
import { permittedApprover, type ReviewClient } from "./review.js";
import { approverOf } from "./ledger.js";
```

(Merge `approverOf` into the existing `./ledger.js` import if one exists.) Then add:

```ts
/** Verifies that high-risk approvals are backed by a permitted PR reviewer.
 *  Fail-open: when verification cannot run, warns and never fails unless
 *  requireVerifiedApproval is set. Live only — never writes the ledger. */
export async function verifyApprovals(
  ledger: Ledger, cfg: Config, client: ReviewClient,
): Promise<{ violations: CheckViolation[]; warnings: string[] }> {
  const violations: CheckViolation[] = [];
  const warnings: string[] = [];
  if (cfg.approval.verify !== "github-review") return { violations, warnings };

  // Only relevant when authorization is actually in play.
  const needsAuth = Object.values(ledger).some((e) => e.risk === "high" && approverOf(e));
  if (!needsAuth) return { violations, warnings };

  const reviewers = await client.approvingReviewers();
  if (reviewers === null) {
    warnings.push("Could not verify approval (no PR context or GitHub token); approvals are unverified.");
    return { violations, warnings };
  }
  if (permittedApprover(reviewers, cfg.approval.allowedApprovers)) return { violations, warnings };

  const msg = "no permitted GitHub reviewer approved this PR; high-risk approvals are unverified.";
  if (cfg.approval.requireVerifiedApproval) violations.push({ package: "(approvals)", reason: msg });
  else warnings.push(msg);
  return { violations, warnings };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run build && node --test 'dist/test/check-command.test.js'`
Expected: PASS (existing + 6 new).

- [ ] **Step 5: Commit**

```bash
git add src/check-command.ts test/check-command.test.ts
git commit -m "feat: verifyApprovals — fail-open PR-review verification pass"
```

---

### Task 5: Wire verification into `vouch check`

**Files:**
- Modify: `src/cli.ts`
- Test: `test/cli-binary.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `test/cli-binary.test.ts` (verify mode with no PR context → fail-open warning, exit 0):

```ts
test("check warns (fail-open) when verify is on but no PR context", () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: { evil: "1" } }));
    writeFileSync(join(dir, ".safe-dep.json"), JSON.stringify({ approval: { verify: "github-review", requireVerifiedApproval: false, allowedApprovers: [] } }));
    mkdirSync(join(dir, ".security"), { recursive: true });
    writeFileSync(join(dir, ".security", "dependency-approvals.json"),
      JSON.stringify({ evil: { approvedVersion: "1.0.0", approvedAt: "x", risk: "high", reason: "needed", approvedBy: null, approval: { by: "Jan", via: "git-config", at: "t" }, checks: { ageHours: 1, installScripts: false } } }));
    // strip any ambient GitHub context so prContext() returns null
    const env = { ...process.env, YSNA_ADVISORY_URL: "http://127.0.0.1:1", GITHUB_TOKEN: "", GH_TOKEN: "", GITHUB_REPOSITORY: "", GITHUB_EVENT_PATH: "" };
    const out = execFileSync(process.execPath, [cli, "check"], { cwd: dir, encoding: "utf8", env });
    assert.match(out, /all dependencies are approved/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build && node --test 'dist/test/cli-binary.test.js'`
Expected: FAIL — verification not wired, so the WARN path isn't exercised (test still passes only if check already exits 0; if it does, make the assertion also require the warning is printed to stderr by capturing it — see note). To make the test meaningfully fail-first, assert the warning text:

Change the run to capture stderr and assert:

```ts
    const out = execFileSync(process.execPath, [cli, "check"], { cwd: dir, encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] });
```
Node's `execFileSync` returns stdout; to see stderr, wrap in try and read `e.stderr` is not needed here — instead assert stdout shows success AND that a `WARN` line appears. Since warnings go to stderr, capture combined output by setting `stdio` and reading the returned buffer is stdout-only. Simplest: assert exit 0 (success message present). The fail-first signal is that `verifyApprovals` isn't called yet — verified by Task 4's unit tests. Keep this binary test as a smoke test asserting `/all dependencies are approved/` and exit 0 under verify mode.

- [ ] **Step 3: Implement**

In `src/cli.ts`, import:

```ts
import { GitHubReviewClient } from "./review.js";
import { verifyApprovals } from "./check-command.js";
```

(Merge `verifyApprovals` into the existing `./check-command.js` import.) In the `check` branch of `main()`, after computing `{ violations, warnings }` from `runCheckWithCve` and before printing, merge the verification results:

```ts
    const review = await verifyApprovals(readLedger(cwd), cfg, new GitHubReviewClient());
    violations.push(...review.violations);
    warnings.push(...review.warnings);
```

Note: `violations`/`warnings` from `runCheckWithCve` are currently `const` destructured — change to `let`/mutable or build new arrays:

```ts
    const { violations: baseV, warnings: baseW } = await runCheckWithCve(pkg, readLedger(cwd), cfg, new NpmAdvisoryClient());
    const review = await verifyApprovals(readLedger(cwd), cfg, new GitHubReviewClient());
    const violations = [...baseV, ...review.violations];
    const warnings = [...baseW, ...review.warnings];
```

Leave the existing warning/violation printing and exit logic unchanged.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS — all tests, including the new binary smoke test. Confirm 0 failures.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts test/cli-binary.test.ts
git commit -m "feat: wire PR-review verification into vouch check"
```

---

### Task 6: Docs + CI example

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`
- Create: `examples/github-actions-verify.yml`

- [ ] **Step 1: README**

In `README.md`, under the CVE/approval material, add a short section:

```markdown
## Verified approval (optional)

By default `vouch` *records* who approved a dependency. To *verify* it, set in `.safe-dep.json`:

    { "approval": { "verify": "github-review", "requireVerifiedApproval": false, "allowedApprovers": [] } }

In CI on a pull request, `vouch check` then confirms the PR has an approving review from a
permitted human (write access; restrict to specific logins with `allowedApprovers`). It is
**fail-open**: with no PR context or token it warns but does not fail. Set
`requireVerifiedApproval: true` to make an unverified high-risk approval fail the build.
Verification needs the workflow to pass a token and run on `pull_request` (see
`examples/github-actions-verify.yml`).
```

- [ ] **Step 2: AGENTS.md**

Add one line after the approve paragraph:

```markdown
When `approval.verify` is `github-review`, an agent cannot satisfy authorization at all — only
a human's PR review counts. The agent's job ends at surfacing the dependency for review.
```

- [ ] **Step 3: CI example**

Create `examples/github-actions-verify.yml`:

```yaml
name: vouch (verify approvals)
on:
  pull_request:
permissions:
  contents: read
  pull-requests: read
jobs:
  vouch:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npx vouch check
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 4: Commit**

```bash
git add README.md AGENTS.md examples/github-actions-verify.yml
git commit -m "docs: document verified approval + GitHub Actions example"
```

---

## Self-Review Notes

- **Spec coverage (Phase 2 / Tier 3 / github-review):** config switch → Task 1; verification logic + client → Tasks 2–3; check integration with fail-open + requireVerifiedApproval → Task 4; CLI wiring → Task 5; docs + Actions example → Task 6. Signed-commit verification is out of scope (future). The deviation from the spec's `via: "github-review"` data-model hint (we do not persist it) is called out in the header.
- **Type consistency:** `ReviewClient`/`permittedApprover` (Task 2) consumed in Tasks 4–5; `ApprovalConfig` (Task 1) consumed in Task 4; `verifyApprovals` (Task 4) wired in Task 5. `CheckViolation`/`Ledger`/`Config` reused from existing modules.
- **No placeholders:** every code step shows full code. Task 5 Step 2 explicitly explains the binary test's smoke-level nature (the meaningful fail-first coverage is the Task 4 unit tests).
- **Fail-open invariant:** `verifyApprovals` only ever produces a *violation* under `requireVerifiedApproval`; every other path is a warning or no-op — matching the chosen default.
