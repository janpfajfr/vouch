# Approver Identity — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture the approver's identity automatically (from `git config`) via a real `vouch approve` command instead of a typed name or hand-edited JSON, and harden `--force-with-reason` so it can never silently record the wrong reason.

**Architecture:** Add an `Approval { by, via, at, ref? }` record to ledger entries (back-compatible with the existing `approvedBy` string). A new pure `src/identity.ts` derives `"Name <email>"` from `git config` behind an injectable runner. A new pure `parseAddArgs` makes the add-command argument parsing testable and order-robust. A new `runApprove` writes the approval; `check` reads the *effective* approver from either the new `approval` or the legacy `approvedBy`.

**Tech Stack:** TypeScript (ESM/NodeNext, `.js` import specifiers), Node 18+ built-ins only (`child_process` for git), zero runtime deps, `node --test`.

**Spec:** `docs/superpowers/specs/2026-05-26-verified-approver-identity-design.md` (Phase 1 only; verification = Phase 2; interactive TTY prompt = deferred Phase 1b).

**Conventions:** imports use `.js` extensions; pure functions are exported and unit-tested; command handlers (`runReapprove`, etc.) take injected `cwd`/`now`/`log`/`err` for testability; tests use `import { test } from "node:test"; import assert from "node:assert/strict";`. Single-file test run: `npm run build && node --test 'dist/test/<file>.js'`.

> **Base-branch note for the executor:** this plan edits `src/cli.ts` heavily. If PR #6 (help/version) is not yet merged into `main`, rebase onto `main` after it merges to avoid conflicts. Reference code by surrounding content (shown in each task), not line numbers.

---

### Task 1: `Approval` type + `approverOf` helper

**Files:**
- Modify: `src/ledger.ts`
- Test: `test/ledger.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

Create/append `test/ledger.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { approverOf, type LedgerEntry } from "../src/ledger.js";

const base: LedgerEntry = {
  approvedVersion: "1.0.0", approvedAt: "x", risk: "high", reason: "r",
  approvedBy: null, checks: { ageHours: 1, installScripts: false },
};

test("approverOf prefers the new approval record", () => {
  assert.equal(approverOf({ ...base, approval: { by: "Jan <j@x>", via: "git-config", at: "t" } }), "Jan <j@x>");
});

test("approverOf falls back to the legacy approvedBy", () => {
  assert.equal(approverOf({ ...base, approvedBy: "Alice" }), "Alice");
});

test("approverOf returns null when neither is set or is blank", () => {
  assert.equal(approverOf(base), null);
  assert.equal(approverOf({ ...base, approvedBy: "   " }), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build`
Expected: FAIL — `approverOf` and `Approval` not exported.

- [ ] **Step 3: Write the implementation**

In `src/ledger.ts`, add the type (after the `Risk` type):

```ts
export type ApprovalVia = "manual" | "git-config" | "signed-commit" | "github-review";

export interface Approval {
  by: string;
  via: ApprovalVia;
  at: string;        // ISO 8601
  ref?: string;      // commit SHA / PR review id (Phase 2)
}
```

Add `approval?: Approval;` to the `LedgerEntry` interface (alongside `approvedBy`). Then add at the end of the file:

```ts
/** The effective approver: the new approval record, else the legacy approvedBy, else null. */
export function approverOf(entry: LedgerEntry): string | null {
  const by = entry.approval?.by ?? entry.approvedBy;
  return by && by.trim() !== "" ? by : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test 'dist/test/ledger.test.js'`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ledger.ts test/ledger.test.ts
git commit -m "feat: Approval record on ledger entries + approverOf helper"
```

---

### Task 2: `src/identity.ts` — git-config identity

**Files:**
- Create: `src/identity.ts`
- Test: `test/identity.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/identity.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { gitIdentity } from "../src/identity.js";

const runner = (map: Record<string, string>) => (args: string[]): string => {
  const key = args.join(" ");
  if (key in map) return map[key];
  throw new Error(`unexpected: ${key}`);
};

test("formats name and email", () => {
  const id = gitIdentity(runner({ "config user.name": "Jan Pf", "config user.email": "j@x.io" }));
  assert.equal(id, "Jan Pf <j@x.io>");
});

test("name only when email missing", () => {
  const id = gitIdentity(runner({ "config user.name": "Jan Pf", "config user.email": "" }));
  assert.equal(id, "Jan Pf");
});

test("null when name is missing", () => {
  const id = gitIdentity(runner({ "config user.name": "", "config user.email": "j@x.io" }));
  assert.equal(id, null);
});

test("null when git throws (no git / not a repo)", () => {
  const id = gitIdentity(() => { throw new Error("not a git repo"); });
  assert.equal(id, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/identity.ts`:

```ts
import { execFileSync } from "node:child_process";

export type GitRunner = (args: string[]) => string;

const defaultRunner: GitRunner = (args) =>
  execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

/** "Name <email>" (or just "Name") from git config, or null if unavailable. */
export function gitIdentity(run: GitRunner = defaultRunner): string | null {
  try {
    const name = run(["config", "user.name"]).trim();
    if (!name) return null;
    const email = run(["config", "user.email"]).trim();
    return email ? `${name} <${email}>` : name;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test 'dist/test/identity.test.js'`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/identity.ts test/identity.test.ts
git commit -m "feat: derive approver identity from git config"
```

---

### Task 3: `parseAddArgs` — order-robust add-command parsing

**Files:**
- Modify: `src/cli.ts`
- Test: `test/cli.test.ts`

This extracts (and hardens) the add-command argument parsing currently inline in `main()`. It fixes the bug where `vouch --force-with-reason esbuild "x"` silently recorded the wrong reason.

- [ ] **Step 1: Write the failing test**

Append to `test/cli.test.ts`:

```ts
import { parseAddArgs } from "../src/cli.js";

test("parseAddArgs: package then reason (correct order)", () => {
  assert.deepEqual(parseAddArgs(["esbuild", "--force-with-reason", "needs build"]),
    { spec: "esbuild", dev: false, force: "needs build" });
});

test("parseAddArgs: -D marks devDependency", () => {
  assert.deepEqual(parseAddArgs(["lodash", "-D"]), { spec: "lodash", dev: true, force: null });
});

test("parseAddArgs: flag value is excluded from the package positional", () => {
  // '--force-with-reason esbuild' => reason is 'esbuild'; 'x' is then the (wrong) spec — but never esbuild
  const r = parseAddArgs(["--force-with-reason", "esbuild", "x"]);
  assert.equal(r.force, "esbuild");
  assert.equal(r.spec, "x");
});

test("parseAddArgs: more than one package positional is an error", () => {
  const r = parseAddArgs(["a", "b"]);
  assert.match(r.error ?? "", /extra argument/i);
});

test("parseAddArgs: no package yields the no-package marker", () => {
  assert.equal(parseAddArgs(["--force-with-reason", "x"]).error, "no-package");
});

test("parseAddArgs: empty or flag-like reason is rejected", () => {
  assert.match(parseAddArgs(["a", "--force-with-reason", "-D"]).error ?? "", /reason/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build`
Expected: FAIL — `parseAddArgs` not exported.

- [ ] **Step 3: Write the implementation**

In `src/cli.ts`, add this exported function (near `parseSpec`):

```ts
export interface AddArgs { spec?: string; dev: boolean; force: string | null; error?: string; }

export function parseAddArgs(args: string[]): AddArgs {
  const dev = args.includes("-D") || args.includes("--save-dev");
  const fi = args.indexOf("--force-with-reason");
  const force = fi >= 0 ? (args[fi + 1] ?? "") : null;
  const skip = new Set<number>(fi >= 0 ? [fi, fi + 1] : []);
  const positionals = args.filter((a, i) => !skip.has(i) && !a.startsWith("-"));
  if (positionals.length === 0) return { dev, force, error: "no-package" };
  if (positionals.length > 1) return { dev, force, spec: positionals[0], error: `unexpected extra argument: "${positionals[1]}"` };
  if (force !== null && (force.trim() === "" || force.startsWith("-"))) return { dev, force, spec: positionals[0], error: "--force-with-reason requires a non-empty reason." };
  return { spec: positionals[0], dev, force };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test 'dist/test/cli.test.js'`
Expected: PASS (existing + 6 new).

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts test/cli.test.ts
git commit -m "feat: order-robust parseAddArgs (no silently-wrong --force-with-reason)"
```

---

### Task 4: `runApprove` — the approve command logic

**Files:**
- Modify: `src/cli.ts`
- Test: `test/cli.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `test/cli.test.ts` (reuses the existing `seedLedger` helper from this file):

```ts
import { runApprove } from "../src/cli.js";

test("runApprove derives identity from git when no --approved-by is given", () => {
  const cwd = seedLedger({ risk: "high", reason: "needed" });
  try {
    const code = runApprove({ pkg: "lodash", approvedBy: null, identity: () => "Jan <j@x>",
      now: () => new Date("2026-05-26T00:00:00Z"), cwd, log: () => {}, err: () => {} });
    assert.equal(code, 0);
    const e = JSON.parse(readFileSync(join(cwd, ".security", "dependency-approvals.json"), "utf8")).lodash;
    assert.deepEqual(e.approval, { by: "Jan <j@x>", via: "git-config", at: "2026-05-26T00:00:00.000Z" });
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("runApprove uses an explicit --approved-by as manual", () => {
  const cwd = seedLedger({ risk: "high", reason: "needed" });
  try {
    const code = runApprove({ pkg: "lodash", approvedBy: "Alice", identity: () => null,
      now: () => new Date("2026-05-26T00:00:00Z"), cwd, log: () => {}, err: () => {} });
    assert.equal(code, 0);
    const e = JSON.parse(readFileSync(join(cwd, ".security", "dependency-approvals.json"), "utf8")).lodash;
    assert.equal(e.approval.by, "Alice");
    assert.equal(e.approval.via, "manual");
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("runApprove errors when identity cannot be determined and no name given", () => {
  const cwd = seedLedger({});
  try {
    const errs: string[] = [];
    const code = runApprove({ pkg: "lodash", approvedBy: null, identity: () => null,
      now: () => new Date(), cwd, log: () => {}, err: (s) => errs.push(s) });
    assert.equal(code, 1);
    assert.match(errs.join("\n"), /git config|--approved-by/i);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("runApprove errors on a package not in the ledger", () => {
  const cwd = seedLedger({});
  try {
    const code = runApprove({ pkg: "ghost", approvedBy: "Alice", identity: () => null,
      now: () => new Date(), cwd, log: () => {}, err: () => {} });
    assert.equal(code, 1);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build`
Expected: FAIL — `runApprove` not exported.

- [ ] **Step 3: Write the implementation**

In `src/cli.ts`, add the import for the Approval type and identity (extend existing `./ledger.js` import to include `type Approval`, and add):

```ts
import { gitIdentity } from "./identity.js";
```

Then add:

```ts
export interface ApproveOptions {
  pkg: string;
  approvedBy: string | null;     // explicit name, or null to auto-derive
  identity: () => string | null; // injected git identity
  now: () => Date;
  cwd: string;
  log: (s: string) => void;
  err: (s: string) => void;
}

export function runApprove(opts: ApproveOptions): number {
  const ledger = readLedger(opts.cwd);
  const entry = ledger[opts.pkg];
  if (!entry) { opts.err(`Not in ledger: ${opts.pkg}. Add it first with: vouch ${opts.pkg}`); return 1; }

  let by: string;
  let via: Approval["via"];
  if (opts.approvedBy && opts.approvedBy.trim() !== "") {
    by = opts.approvedBy.trim(); via = "manual";
  } else {
    const id = opts.identity();
    if (!id) { opts.err('Could not determine your identity from git config. Pass --approved-by "<name>".'); return 1; }
    by = id; via = "git-config";
  }

  const approval: Approval = { by, via, at: opts.now().toISOString() };
  writeLedger(opts.cwd, upsertEntry(ledger, opts.pkg, { ...entry, approval }));
  opts.log(`Approved ${opts.pkg} (by ${by}, via ${via}).`);
  return 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test 'dist/test/cli.test.js'`
Expected: PASS (existing + 4 new).

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts test/cli.test.ts
git commit -m "feat: runApprove records a git-derived or explicit approval"
```

---

### Task 5: `check` reads the effective approver

**Files:**
- Modify: `src/check-command.ts`
- Test: `test/check-command.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `test/check-command.test.ts`:

```ts
test("high-risk passes when approved via the new approval record", () => {
  const ledger: Ledger = { evil: { ...base, risk: "high", reason: "needed", approvedBy: null,
    approval: { by: "Jan <j@x>", via: "git-config", at: "t" } } };
  const v = runCheck({ dependencies: { evil: "1" } }, ledger, DEFAULT_CONFIG);
  assert.deepEqual(v, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test 'dist/test/check-command.test.js'`
Expected: FAIL — current code only checks `entry.approvedBy`, so it still reports a violation.

- [ ] **Step 3: Write the implementation**

In `src/check-command.ts`, import the helper:

```ts
import { approverOf, type Ledger } from "./ledger.js";
```

(Merge with the existing `./ledger.js` import if one is present.) Then replace the high-risk approval check:

```ts
      if (cfg.requireApprovalForHighRisk && (!entry.approvedBy || entry.approvedBy.trim() === "")) {
        violations.push({ package: name, reason: "high-risk entry needs approvedBy (a reason alone does not authorize)." });
      }
```

with:

```ts
      if (cfg.requireApprovalForHighRisk && !approverOf(entry)) {
        violations.push({ package: name, reason: "high-risk entry needs a human approver (run: vouch approve " + name + ")." });
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test 'dist/test/check-command.test.js'`
Expected: PASS (existing + 1 new). Existing high-risk tests still pass (they use `approvedBy`, which `approverOf` honors).

- [ ] **Step 5: Commit**

```bash
git add src/check-command.ts test/check-command.test.ts
git commit -m "feat: check accepts approval record or legacy approvedBy"
```

---

### Task 6: Wire `approve` + `parseAddArgs` into `main()`

**Files:**
- Modify: `src/cli.ts`
- Test: `test/cli-binary.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `test/cli-binary.test.ts`:

```ts
test("approve sets a git-config approver and check then passes", () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: { evil: "1" } }));
    mkdirSync(join(dir, ".security"), { recursive: true });
    writeFileSync(join(dir, ".security", "dependency-approvals.json"),
      JSON.stringify({ evil: { approvedVersion: "1.0.0", approvedAt: "x", risk: "high", reason: "needed", approvedBy: null, checks: { ageHours: 1, installScripts: false } } }));
    // a git identity must exist for the git-config path
    const env = { ...process.env, YSNA_ADVISORY_URL: "http://127.0.0.1:1", GIT_AUTHOR_NAME: "T", GIT_COMMITTER_NAME: "T" };
    execFileSync("git", ["init", "-q"], { cwd: dir });
    execFileSync("git", ["config", "user.name", "Tester"], { cwd: dir });
    execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: dir });
    const out = execFileSync(process.execPath, [cli, "approve", "evil"], { cwd: dir, encoding: "utf8", env });
    assert.match(out, /Approved evil/);
    // check now passes (exit 0)
    const checkOut = execFileSync(process.execPath, [cli, "check"], { cwd: dir, encoding: "utf8", env });
    assert.match(checkOut, /all dependencies are approved/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test 'dist/test/cli-binary.test.js'`
Expected: FAIL — `approve` is not a recognized command (it gets treated as a package to install).

- [ ] **Step 3: Write the implementation**

In `src/cli.ts` `main()`, add the `approve` branch immediately after the `reapprove` branch:

```ts
  if (cmd === "approve") {
    const rest = args.slice(1);
    const ai = rest.indexOf("--approved-by");
    const approvedBy = ai >= 0 ? (rest[ai + 1] ?? "") : null;
    const skip = new Set(ai >= 0 ? [ai, ai + 1] : []);
    const pkg = rest.find((a, i) => !skip.has(i) && !a.startsWith("-"));
    if (!pkg) { console.error('Usage: vouch approve <package> [--approved-by "<name>"]'); return 1; }
    if (approvedBy !== null && (approvedBy.trim() === "" || approvedBy.startsWith("-"))) { console.error('--approved-by needs a name value.'); return 1; }
    return runApprove({ pkg, approvedBy, identity: () => gitIdentity(), now: () => new Date(), cwd, log: (s) => console.log(s), err: (s) => console.error(s) });
  }
```

Then replace the inline add-argument parsing (the block computing `positionals`/`dev`/`fi`/`force`/`spec` and the `if (!spec)` / empty-reason guards) with a call to `parseAddArgs`:

```ts
  const parsed = parseAddArgs(args);
  if (parsed.error === "no-package") { console.error(helpText()); return 1; }
  if (parsed.error) { console.error(parsed.error); return 1; }
  const { spec, dev, force } = parsed;
```

Leave the subsequent `return runSafeAdd({ spec, dev, force, ... })` call intact. (If PR #6 is not merged, the `helpText()` reference comes from that PR; if building before it merges, substitute the existing usage string for the `no-package` case and reconcile on rebase.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — full suite, including the new binary test. Confirm 0 failures.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts
git commit -m "feat: wire 'approve' command and parseAddArgs into the CLI"
```

---

### Task 7: Documentation

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: Document `approve` in the README**

In `README.md`, add a row to the commands table:

```markdown
| `vouch approve <pkg> [--approved-by "<name>"]` | Record a human approver for a high-risk dependency (identity auto-derived from `git config`). |
```

And in the *Attribution vs authorization* section, add:

```markdown
Approve a high-risk dependency with `vouch approve <pkg>` — it records your identity from
`git config` (or an explicit `--approved-by "<name>"`), so authorization is a real command,
not a hand-edited JSON field. (Whether that approval is *verified* — signed commit or
authenticated PR review — is Phase 2; see the design spec.)
```

- [ ] **Step 2: Update AGENTS.md**

In `AGENTS.md`, after the existing high-risk paragraph, add:

```markdown
To authorize a high-risk dependency, a human runs `vouch approve <pkg>` (which records their
git identity) — an agent MUST NOT run `approve` on a human's behalf. Authorization is a human
act; the agent's job is to surface the decision, not to make it.
```

- [ ] **Step 3: Commit**

```bash
git add README.md AGENTS.md
git commit -m "docs: document the vouch approve command"
```

---

## Self-Review Notes

- **Spec coverage (Phase 1):** `Approval` data model with `via` → Task 1; git-config identity (Tier 1) → Task 2; `vouch approve` command (closes the no-CLI-to-approve gap) → Tasks 4 & 6; `--force-with-reason` hardening → Task 3; `check` honoring the new approval → Task 5; docs → Task 7. **Deferred deliberately:** interactive TTY prompt (Tier 2) → Phase 1b; all verification (Tier 3) → Phase 2. These are called out in the spec and the plan header, not silently dropped.
- **Type consistency:** `Approval` (`by`/`via`/`at`/`ref?`) defined in Task 1 is used identically in Tasks 4 and 6; `approverOf` (Task 1) is consumed in Task 5; `parseAddArgs`/`AddArgs` (Task 3) is consumed in Task 6; `runApprove`/`ApproveOptions` (Task 4) is wired in Task 6.
- **No placeholders:** every code step shows complete code. The only conditional is the `helpText()` reference in Task 6, explicitly tied to PR #6's merge state with a stated fallback.
- **Back-compat:** `approvedBy` is never removed; `approverOf` reads either source, so existing ledgers and existing high-risk tests keep passing.
