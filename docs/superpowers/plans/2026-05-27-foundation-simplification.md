# Foundation Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reshape `vouch` from an "approval/authorization" tool into a *dependency-decision ledger* — it records decisions so PR/MR reviewers approve them consciously; it does not pretend to be the approval itself.

**Architecture:** Remove the approval-identity model (the `vouch approve` command, `approvedBy`-as-authorization, the entire GitHub PR-review verification subsystem, and the `approval` config block). Keep the ledger, the add flow, the risk checks, and CVE-drift detection. CVE drift stays a **hard CI failure**; the only surviving recovery command is the renamed `vouch acknowledge <pkg> --reason "…"`, scoped strictly to CVE/risk drift. Capture `addedBy` (git identity, *attribution only*) at add time.

**Tech Stack:** TypeScript (Node 18+ built-ins, zero runtime deps), `node:test` + `node:assert`, `tsc` build to `dist/`.

**The three states `check` enforces:** Recorded (OK) · Unrecorded (BLOCKED) · Needs-review (BLOCKED — high-risk without a reason, or CVE drift since the decision was recorded).

---

## Naming decisions (locked for this plan)

- Ledger field `approvedBy` → **`addedBy`** (who ran the command; attribution, not authorization).
- Ledger field `approvedAt` → **`addedAt`** (matches the foundation doc's example).
- Ledger field `approvedVersion` → **kept as-is** (the foundation doc keeps it; renaming is extra churn for no clarity gain).
- Ledger filename `.security/dependency-approvals.json` → **kept** (the foundation doc references it unchanged; renaming breaks every existing repo).
- Command `vouch reapprove … --approved-by` → **`vouch acknowledge <pkg> --reason "…"`** (CVE/risk drift only).
- Command `vouch approve` → **removed**.

## Non-goals (explicitly out of scope)

- **Version-drift detection** (recorded version ≠ `package.json` version). The foundation doc lists it as a future "needs-review" state, but it is *additive*, not part of this simplification. Track separately.
- Renaming `approvedVersion` or the ledger file.
- Any new config surface.

## File map

| File | Change |
|------|--------|
| `src/ledger.ts` | Remove `Approval`, `ApprovalVia`, `approverOf`; rename `approvedBy`→`addedBy`, `approvedAt`→`addedAt`; drop `approval?`; add `reason` to `CveSnapshot` |
| `src/config.ts` | Remove `ApprovalConfig`, the `approval` field + its deep-merge, and `requireApprovalForHighRisk` |
| `src/check-command.ts` | Drop `verifyApprovals` + the `ReviewClient` import; simplify `runCheck` (high-risk needs a reason, no approver); update CVE-drift message to say `acknowledge` |
| `src/review.ts` | **Delete** |
| `src/cli.ts` | Capture `addedBy` on add; remove `runApprove`/`approve`; rename `runReapprove`→`runAcknowledge` (`--reason`); rewrite `check` (no verification); update help + install-time CVE note |
| `src/identity.ts` | **Keep** (now used for `addedBy` + `acknowledgedBy`) |
| `test/review.test.ts` | **Delete** |
| `test/check-command.test.ts` | Remove verifyApprovals + approver tests; keep/adjust the rest |
| `test/cli.test.ts`, `test/ledger.test.ts`, `test/config.test.ts`, `test/cli-binary.test.ts`, `test/advisories.test.ts` | Update field/command references |
| `README.md` | Remove "Verified approval" section; update command table + field names |
| `AGENTS.md` | Replace approve/verify guidance with record + acknowledge guidance |
| `docs/threat-model.md` | Trim verification-specific gaps; keep the attribution-vs-authorization framing |
| `examples/github-actions-verify.yml` | Replace with a plain `examples/github-actions-check.yml` (just `vouch check`) |

---

## Task 1: Ledger types — record, don't approve

**Files:**
- Modify: `src/ledger.ts`
- Test: `test/ledger.test.ts`

- [ ] **Step 1: Update the failing test first**

Open `test/ledger.test.ts` and replace any test referencing `approvedBy`, `approvedAt`, `approval`, or `approverOf` with the new shape. Add this test:

```ts
test("round-trips an entry using addedBy/addedAt", () => {
  const dir = mkdtempSync(join(tmpdir(), "vouch-ledger-"));
  const entry = {
    approvedVersion: "1.0.0",
    addedAt: "2026-05-27T10:00:00.000Z",
    addedBy: "Jan Pfajfr <jan@example.com>",
    risk: "high" as const,
    reason: "needed for bundling",
    checks: { ageHours: 100, installScripts: false as const },
  };
  writeLedger(dir, { esbuild: entry });
  assert.deepEqual(readLedger(dir).esbuild, entry);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsc --noEmit` then `node --test test/ledger.test.ts`
Expected: TYPE ERROR / FAIL — `addedBy`/`addedAt` are not on `LedgerEntry`.

- [ ] **Step 3: Rewrite the types**

In `src/ledger.ts`, delete `ApprovalVia`, `Approval`, and `approverOf`. Update `CveSnapshot` and `LedgerEntry`:

```ts
export type Risk = "low" | "medium" | "high";

export type CveSeverity = "low" | "moderate" | "high" | "critical";

export interface AcknowledgedAdvisory {
  id: string;
  severity: CveSeverity;
}

export interface CveSnapshot {
  acknowledged: AcknowledgedAdvisory[]; // human-signed-off set, sorted by id
  acknowledgedBy: string | null;        // git identity of who acknowledged (attribution)
  acknowledgedAt: string;               // ISO 8601
  reason: string;                       // why the risk was knowingly accepted
}

export interface LedgerEntry {
  approvedVersion: string;
  addedAt: string;
  risk: Risk;
  reason: string | null;
  addedBy: string | null;
  checks: { ageHours: number | null; installScripts: Record<string, string> | false };
  cve?: CveSnapshot;
}
```

Leave `readLedger`, `writeLedger`, `upsertEntry`, `LEDGER_RELATIVE`, `ledgerPath` unchanged.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx tsc --noEmit test/ledger.test.ts` (expect remaining errors only in *other* files) then `node --test test/ledger.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ledger.ts test/ledger.test.ts
git commit -m "refactor: ledger records addedBy/addedAt; drop Approval/approverOf"
```

---

## Task 2: Config — drop the approval surface

**Files:**
- Modify: `src/config.ts`
- Test: `test/config.test.ts`

- [ ] **Step 1: Update tests first**

In `test/config.test.ts`, delete every test referencing `approval`, `verify`, `requireVerifiedApproval`, `allowedApprovers`, or `requireApprovalForHighRisk`. Add:

```ts
test("loadConfig has no approval block and no requireApprovalForHighRisk", () => {
  const dir = mkdtempSync(join(tmpdir(), "vouch-cfg-"));
  const cfg = loadConfig(dir);
  assert.ok(!("approval" in cfg));
  assert.ok(!("requireApprovalForHighRisk" in cfg));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/config.test.ts`
Expected: FAIL — `approval`/`requireApprovalForHighRisk` still present.

- [ ] **Step 3: Rewrite config**

In `src/config.ts`, delete the `ApprovalConfig` interface. Update `Config`, `DEFAULT_CONFIG`, and `loadConfig`:

```ts
export interface Config {
  minimumVersionAgeHours: number;
  warnVersionAgeHours: number;
  blockInstallScripts: boolean;
  requireCooldownConfigured: boolean;
  allowScopedPackages: string[];
  packageManager: PackageManager;
  knownAlternatives: Record<string, string>;
}

export const DEFAULT_CONFIG: Config = {
  minimumVersionAgeHours: 24,
  warnVersionAgeHours: 168,
  blockInstallScripts: true,
  requireCooldownConfigured: false,
  allowScopedPackages: [],
  packageManager: "auto",
  knownAlternatives: {},
};

export function loadConfig(cwd: string): Config {
  const path = join(cwd, ".safe-dep.json");
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return { ...DEFAULT_CONFIG };
  }
  let parsed: Partial<Config>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid .safe-dep.json: not valid JSON`);
  }
  return { ...DEFAULT_CONFIG, ...parsed };
}
```

Leave `isAllowlisted` unchanged.

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test test/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts test/config.test.ts
git commit -m "refactor: drop approval config block and requireApprovalForHighRisk"
```

---

## Task 3: check-command — three states, no verification

**Files:**
- Modify: `src/check-command.ts`
- Test: `test/check-command.test.ts`

- [ ] **Step 1: Update tests first**

In `test/check-command.test.ts`: delete every `verifyApprovals: …` test and the import of `verifyApprovals`/review fakes. Delete the "high-risk … approvedBy …" and "approval not required …" tests. Keep the no-entry, devDependencies, high-risk-without-reason, and all `runCheckWithCve` tests, but change CVE assertions from `/reapprove/i` to `/acknowledge/i`. Add:

```ts
test("high-risk with a reason passes (recorded + explained)", () => {
  const ledger = { esbuild: { approvedVersion: "1.0.0", addedAt: "t", addedBy: "Jan", risk: "high" as const, reason: "bundler", checks: { ageHours: 1, installScripts: false as const } } };
  const v = runCheck({ dependencies: { esbuild: "^1.0.0" } }, ledger, DEFAULT_CONFIG);
  assert.equal(v.length, 0);
});

test("high-risk without a reason is BLOCKED (needs review)", () => {
  const ledger = { esbuild: { approvedVersion: "1.0.0", addedAt: "t", addedBy: "Jan", risk: "high" as const, reason: null, checks: { ageHours: 1, installScripts: false as const } } };
  const v = runCheck({ dependencies: { esbuild: "^1.0.0" } }, ledger, DEFAULT_CONFIG);
  assert.ok(v.some((x) => /reason/i.test(x.reason)));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/check-command.test.ts`
Expected: FAIL — `verifyApprovals`/`approverOf` references no longer exist; CVE message still says `reapprove`.

- [ ] **Step 3: Rewrite check-command**

Replace `src/check-command.ts` entirely:

```ts
import type { Config } from "./config.js";
import type { Ledger } from "./ledger.js";
import { detectDrift, type AdvisoryClient } from "./advisories.js";

export interface PackageJsonLike {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export interface CheckViolation { package: string; reason: string; }

export function runCheck(pkg: PackageJsonLike, ledger: Ledger, _cfg: Config): CheckViolation[] {
  const names = [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ];
  const violations: CheckViolation[] = [];
  for (const name of names) {
    const entry = ledger[name];
    if (!entry) {
      violations.push({ package: name, reason: "not in the ledger — record it: vouch " + name });
      continue;
    }
    if (entry.risk === "high" && (!entry.reason || entry.reason.trim() === "")) {
      violations.push({ package: name, reason: "high-risk decision needs a reason in the ledger so a reviewer can judge it." });
    }
  }
  return violations;
}

export async function runCheckWithCve(
  pkg: PackageJsonLike,
  ledger: Ledger,
  cfg: Config,
  client: AdvisoryClient,
): Promise<{ violations: CheckViolation[]; warnings: string[] }> {
  const violations = runCheck(pkg, ledger, cfg);
  const warnings: string[] = [];

  const names = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})];
  const pkgVersions: Record<string, string[]> = {};
  for (const name of names) {
    const entry = ledger[name];
    if (entry) pkgVersions[name] = [entry.approvedVersion];
  }

  const live = await client.fetchBulk(pkgVersions);
  if (live === null) {
    if (Object.keys(pkgVersions).length > 0) {
      warnings.push("Could not verify advisories (offline or registry error); CVE drift was not checked.");
    }
    return { violations, warnings };
  }

  for (const d of detectDrift(ledger, live)) {
    const version = ledger[d.package]?.approvedVersion ?? "?";
    for (const a of d.newAdvisories) {
      violations.push({
        package: `${d.package}@${version}`,
        reason: cveDriftMessage(d.package, a.id, a.severity),
      });
    }
  }
  return { violations, warnings };
}

/** The three honest paths, rendered as a block so CI output is actionable. */
export function cveDriftMessage(pkg: string, id: string, severity: string): string {
  return [
    `gained ${id} (${severity}) since it was recorded.`,
    "",
    "  Options:",
    `  1. Fix:     vouch ${pkg}@<patched-version>`,
    `  2. Remove:  remove ${pkg} from package.json`,
    `  3. Accept:  vouch acknowledge ${pkg} --reason "<why this is acceptable>"`,
  ].join("\n");
}
```

This makes `vouch check` print (`cli.ts` already does `BLOCKED: ${package} — ${reason}`):

```text
BLOCKED: lodash@4.17.21 — gained GHSA-xxxx-yyyy (moderate) since it was recorded.

  Options:
  1. Fix:     vouch lodash@<patched-version>
  2. Remove:  remove lodash from package.json
  3. Accept:  vouch acknowledge lodash --reason "<why this is acceptable>"
```

> Matches the requested Fix/Remove/Accept format. The only cosmetic difference from the
> example is the ` — ` package separator, kept so CVE violations render consistently with the
> unrecorded / unexplained-high-risk violations on the same `check` run.

Add a focused test for the message shape in `test/check-command.test.ts`:

```ts
test("CVE drift message lists fix / remove / acknowledge options", async () => {
  const ledger = { lodash: { approvedVersion: "4.17.21", addedAt: "t", addedBy: "Jan", risk: "low" as const, reason: null, checks: { ageHours: 1, installScripts: false as const } } };
  const client = { fetchBulk: async () => ({ "lodash@4.17.21": [{ id: "GHSA-x", severity: "moderate" as const }] }) };
  const r = await runCheckWithCve({ dependencies: { lodash: "^4.17.21" } }, ledger, DEFAULT_CONFIG, client);
  const v = r.violations.find((x) => x.package.startsWith("lodash@"));
  assert.match(v.reason, /1\. Fix:/);
  assert.match(v.reason, /3\. Accept:.*acknowledge lodash/);
});
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test test/check-command.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/check-command.ts test/check-command.test.ts
git commit -m "refactor: check is record/unrecorded/needs-review; drop verifyApprovals"
```

---

## Task 4: Delete the review subsystem

**Files:**
- Delete: `src/review.ts`, `test/review.test.ts`

- [ ] **Step 1: Delete both files**

```bash
git rm src/review.ts test/review.test.ts
```

- [ ] **Step 2: Confirm nothing else imports them**

Run: `grep -rn "review.js\|review.ts\|ReviewClient\|verifyApprovals\|permittedApprover\|GitHubReviewClient" src test`
Expected: only matches inside `src/cli.ts` (fixed in Task 5). If anything else appears, fix it now.

- [ ] **Step 3: Commit**

```bash
git commit -m "refactor: remove GitHub PR-review verification subsystem"
```

---

## Task 5: CLI — capture addedBy, remove approve, rename to acknowledge

**Files:**
- Modify: `src/cli.ts`
- Test: `test/cli.test.ts`

- [ ] **Step 1: Update/add tests first**

In `test/cli.test.ts`: delete all `runApprove`/`ApproveOptions` tests. Rename `runReapprove` tests to `runAcknowledge` and switch the option from `approvedBy` to `reason` + injected `identity`. Add these:

```ts
test("runSafeAdd records addedBy from the injected git identity", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vouch-add-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: {} }));
  await runSafeAdd({
    spec: "ms", dev: false, force: null,
    registry: fakeRegistry("ms", "2.1.3"),
    installer: { install: async () => 0 },
    identity: () => "Jan Pfajfr <jan@example.com>",
    now: () => new Date("2026-05-27T10:00:00Z"),
    cwd: dir, log: () => {}, err: () => {},
  });
  assert.equal(readLedger(dir).ms.addedBy, "Jan Pfajfr <jan@example.com>");
});

test("runAcknowledge requires a reason and records git identity + advisories", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vouch-ack-"));
  writeLedger(dir, { lodash: { approvedVersion: "4.17.20", addedAt: "t", addedBy: "Jan", risk: "low", reason: null, checks: { ageHours: 1, installScripts: false } } });
  const code = await runAcknowledge({
    pkg: "lodash", reason: "dev-only, path unreachable",
    identity: () => "Jan Pfajfr <jan@example.com>",
    client: { fetchBulk: async () => ({ lodash: [{ id: "GHSA-x", severity: "high" }] }) },
    now: () => new Date("2026-05-27T10:00:00Z"),
    cwd: dir, log: () => {}, err: () => {},
  });
  assert.equal(code, 0);
  const cve = readLedger(dir).lodash.cve;
  assert.equal(cve?.reason, "dev-only, path unreachable");
  assert.equal(cve?.acknowledgedBy, "Jan Pfajfr <jan@example.com>");
  assert.equal(cve?.acknowledged.length, 1);
});
```

Ensure `runSafeAdd`, `runAcknowledge`, `readLedger`, `writeLedger`, and your `fakeRegistry` helper are imported in the test.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/cli.test.ts`
Expected: FAIL — `runAcknowledge` undefined; `runSafeAdd` has no `identity` option.

- [ ] **Step 3: Edit imports and `runSafeAdd`**

In `src/cli.ts`:

Replace the imports block lines for ledger/check/review:

```ts
import { readLedger, writeLedger, upsertEntry, type LedgerEntry } from "./ledger.js";
import { runCheckWithCve } from "./check-command.js";
import { NpmAdvisoryClient, type AdvisoryClient } from "./advisories.js";
import { gitIdentity } from "./identity.js";
```

(Remove the `Risk, type Approval` extras, the `verifyApprovals` import, and the `./review.js` import. Keep `type Risk` — it's still used; import it: `import { ..., type Risk } from "./ledger.js";` — add `Risk` back to that import list.)

Add `identity` to `SafeAddOptions`:

```ts
export interface SafeAddOptions {
  spec: string;
  dev: boolean;
  force: string | null;
  registry: RegistryClient;
  installer: Installer;
  advisoryClient?: AdvisoryClient;
  identity?: () => string | null;
  now: () => Date;
  cwd: string;
  log: (s: string) => void;
  err: (s: string) => void;
}
```

In `runSafeAdd`, change the install-time CVE note and the ledger entry:

```ts
      opts.log(`note: \`check\` will block until a human acknowledges this — run: vouch acknowledge ${name} --reason "<why>" (or upgrade to a patched version).`);
```

```ts
  const entry: LedgerEntry = {
    approvedVersion: meta.version,
    addedAt: opts.now().toISOString(),
    risk,
    reason: opts.force ?? null,
    addedBy: (opts.identity ?? (() => gitIdentity()))(),
    checks: { ageHours: ageHours(meta.publishedAt, opts.now()), installScripts: (() => { const s = Object.fromEntries(DANGEROUS_SCRIPTS.filter(k => meta.scripts[k]).map(k => [k, meta.scripts[k]])); return Object.keys(s).length > 0 ? s : false; })() },
  };
```

- [ ] **Step 4: Replace `runReapprove` with `runAcknowledge`**

Delete `ReapproveOptions` + `runReapprove` and `ApproveOptions` + `runApprove`. Add:

```ts
export interface AcknowledgeOptions {
  pkg: string;
  reason: string;
  identity: () => string | null;
  client: AdvisoryClient;
  now: () => Date;
  cwd: string;
  log: (s: string) => void;
  err: (s: string) => void;
}

export async function runAcknowledge(opts: AcknowledgeOptions): Promise<number> {
  const ledger = readLedger(opts.cwd);
  const entry = ledger[opts.pkg];
  if (!entry) { opts.err(`Not in ledger: ${opts.pkg}`); return 1; }

  const live = await opts.client.fetchBulk({ [opts.pkg]: [entry.approvedVersion] });
  if (live === null) {
    opts.err(`Could not verify advisories for ${opts.pkg} (offline or registry error); ledger unchanged.`);
    return 1;
  }

  const acknowledged = live[opts.pkg] ?? [];
  const updated = { ...entry, cve: { acknowledged, acknowledgedBy: opts.identity(), acknowledgedAt: opts.now().toISOString(), reason: opts.reason } };
  writeLedger(opts.cwd, upsertEntry(ledger, opts.pkg, updated));
  opts.log(`Acknowledged ${opts.pkg}: ${acknowledged.length} advisor${acknowledged.length === 1 ? "y" : "ies"} accepted — "${opts.reason}".`);
  return 0;
}
```

- [ ] **Step 5: Rewrite `check`, the command router, help text, and `runSafeAdd` call site**

Replace the `check` block in `main`:

```ts
  if (cmd === "check") {
    const cfg = loadConfig(cwd);
    const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
    const ledger = readLedger(cwd);
    const { violations, warnings } = await runCheckWithCve(pkg, ledger, cfg, new NpmAdvisoryClient());
    for (const w of warnings) console.error(`WARN: ${w}`);
    if (violations.length === 0) { console.log("Dependency review: all dependencies are recorded."); return 0; }
    for (const v of violations) console.error(`BLOCKED: ${v.package} — ${v.reason}`);
    return 1;
  }
```

Delete the `approve` command block. Replace the `reapprove` block:

```ts
  if (cmd === "acknowledge") {
    const rest = args.slice(1);
    const ri = rest.indexOf("--reason");
    const reason = ri >= 0 ? (rest[ri + 1] ?? "") : "";
    const skip = new Set(ri >= 0 ? [ri, ri + 1] : []);
    const pkg = rest.find((a, i) => !skip.has(i) && !a.startsWith("-"));
    if (!pkg) { console.error('Usage: vouch acknowledge <package> --reason "<why>"'); return 1; }
    if (reason.trim() === "" || reason.startsWith("-")) { console.error('acknowledge requires --reason "<why>" — the risk you are knowingly accepting.'); return 1; }
    return runAcknowledge({ pkg, reason, identity: () => gitIdentity(), client: new NpmAdvisoryClient(), now: () => new Date(), cwd, log: (s) => console.log(s), err: (s) => console.error(s) });
  }
```

Update `helpText()`:

```ts
export function helpText(): string {
  return [
    "vouch — a dependency-decision ledger: every dependency is recorded, explained, and reviewable in the PR.",
    "",
    "Usage:",
    '  vouch <package> [-D] [--force-with-reason "<reason>"]   Review, install, and record a dependency',
    "  vouch check                                             CI gate: fail on unrecorded deps, unexplained high-risk, or CVE drift",
    '  vouch acknowledge <package> --reason "<why>"            Knowingly accept a dependency\'s current advisories (CVE drift)',
    "  vouch --help | --version",
    "",
    "Flags:",
    "  -D, --save-dev            Add as a devDependency",
    '  --force-with-reason "…"   Override a block, recording the reason in the ledger',
    '  --reason "<why>"          Why a risk is knowingly accepted (acknowledge)',
    "  --quiet                   Suppress the wordmark banner",
    "",
    "Environment:",
    "  YSNA_ADVISORY_URL         Override the npm advisory endpoint (enterprise mirrors/proxies)",
    "",
    "vouch records decisions; the PR/MR review is the approval. The ledger lives at",
    ".security/dependency-approvals.json and is meant to be committed.",
  ].join("\n");
}
```

In the `runSafeAdd({ … })` call site in `main`, add `identity: () => gitIdentity(),` to the options object.

- [ ] **Step 6: Run it to verify it passes**

Run: `npx tsc --noEmit && node --test test/cli.test.ts`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/cli.ts test/cli.test.ts
git commit -m "feat: capture addedBy on add; replace approve/reapprove with acknowledge"
```

---

## Task 6: Sweep remaining test references

**Files:**
- Modify: `test/cli-binary.test.ts`, `test/advisories.test.ts` (and any other file flagged below)

- [ ] **Step 1: Find every stale reference**

Run: `grep -rn "approvedBy\|approvedAt\b\|reapprove\|vouch approve\|verifyApprovals\|requireApprovalForHighRisk\|approval" test`
Expected: a short list. For each: rename `approvedBy`→`addedBy`, `approvedAt`→`addedAt`, `reapprove`→`acknowledge`, and update CLI-binary expectations (help text no longer mentions `approve`; `check` success line is now "all dependencies are recorded.").

- [ ] **Step 2: Apply the edits**

Edit each flagged file so its fixtures use `addedBy`/`addedAt` and its assertions match the new help/check strings. In `test/cli-binary.test.ts`, update any assertion on help output or the `check` success message accordingly.

- [ ] **Step 3: Run the full suite**

Run: `node --test`
Expected: PASS — 0 failures. Note the new total (it will drop from 117 as verification tests are gone).

- [ ] **Step 4: Commit**

```bash
git add test
git commit -m "test: align fixtures and CLI assertions with the record-only model"
```

---

## Task 7: Docs — reframe as a decision ledger

**Files:**
- Modify: `README.md`, `AGENTS.md`, `docs/threat-model.md`
- Replace: `examples/github-actions-verify.yml` → `examples/github-actions-check.yml`

- [ ] **Step 1: README**

Remove the entire "## Verified approval (optional)" section. In the command table, drop the `approve` and `reapprove` rows; replace with one row: `` | `vouch acknowledge <pkg> --reason "<why>"` | Knowingly accept a dependency's current advisories (CVE drift). | ``. Replace any `approvedBy` mention with `addedBy` and reframe the surrounding sentence as *recorded attribution*, not authorization. Ensure the top tagline and "What it is not" reflect: **vouch records decisions; the PR/MR review is the approval.** Update the CVE section's recovery step 3 to use `vouch acknowledge <pkg> --reason "<why>"`.

- [ ] **Step 2: AGENTS.md**

Replace the approve/verify paragraphs (the `vouch approve`, `approval.verify`, and `reapprove` guidance) with:

```markdown
`vouch` records a decision; it does not grant approval. An agent records a dependency with
`vouch <pkg>` (explaining *why* first) — the recorded `addedBy` is attribution, not
authorization. The actual approval is the human's PR/MR review. An agent MUST NOT mark a
risky dependency as acceptable on a human's behalf.

If `check` reports that a dependency gained a CVE since it was recorded, the agent MUST NOT
silently accept it with `vouch acknowledge`. Surface it to a human, who fixes it, removes it,
or — judging the risk acceptable — runs `vouch acknowledge <pkg> --reason "<why>"`, which is
visible in the PR diff.
```

- [ ] **Step 3: threat-model.md**

Reduce to two trust tiers (the third no longer exists in the tool): Tier 1 — `addedBy` attribution (self-asserted); Tier 2 — provenance (the committed, reviewed ledger entry). State that **authorization lives entirely on the platform PR/MR review — vouch does not attempt to verify it**. Delete the "Verified approval" trust row, the four "known gaps" about PR-review verification, and the `allowedApprovers`/`requireVerifiedApproval` deployment advice. Keep: the one-sentence framing, what vouch defends, what it does not (humanness behind a credential), and the branch-protection recommendation.

- [ ] **Step 4: Replace the example workflow**

```bash
git rm examples/github-actions-verify.yml
```

Create `examples/github-actions-check.yml`:

```yaml
name: vouch
on: [pull_request]
jobs:
  vouch:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npx vouch check
```

- [ ] **Step 5: Commit**

```bash
git add README.md AGENTS.md docs/threat-model.md examples/
git commit -m "docs: reframe vouch as a decision ledger; PR review is the approval"
```

---

## Task 8: Whole-feature verification

**Files:** none (verification only)

- [ ] **Step 1: Build + full suite**

Run: `npm run build && node --test`
Expected: build clean, 0 test failures.

- [ ] **Step 2: Grep for any surviving old vocabulary in shipped code/docs**

Run: `grep -rn "vouch approve\|reapprove\|verifyApprovals\|allowedApprovers\|requireVerifiedApproval\|approvedBy" src docs README.md AGENTS.md examples`
Expected: no matches (a match in a dated plan/spec under `docs/superpowers/` is fine — those are historical).

- [ ] **Step 3: Live smoke in the demo repo**

```bash
npm run build   # global vouch is symlinked to this repo
cd ../ysna-demo
vouch --help              # no approve/reapprove; shows acknowledge
vouch check               # blocks unrecorded deps; success line says "recorded"
cd -
```
Expected: help shows the trimmed command set; `check` behaves as the three-state model describes.

- [ ] **Step 4: Final commit / branch**

Confirm the working tree is clean (`git status`). The branch is ready for a PR titled "Foundation simplification — vouch records, the PR review approves."

---

## Self-review notes

- **Spec coverage:** cut `vouch approve` (T5), `approvedBy`-as-authorization → `addedBy` attribution (T1, T5), GitHub review verification (T3, T4), `allowedApprovers`/approval config (T2); CVE drift stays a hard block with `vouch acknowledge --reason` (T3, T5); kept ledger/add/check/age/install-script/alternatives/CVE-warning/CVE-drift/CI/README/AGENTS (untouched or reframed). All "Replace with" items from the foundation doc are covered.
- **Type consistency:** `addedBy`/`addedAt` used identically across T1/T5/T6; `CveSnapshot.reason` defined in T1 and written in T5; `runAcknowledge`/`AcknowledgeOptions` names match between T5 definition and T5 router + T6 tests.
- **Out of scope, by decision:** version-drift detection; `approvedVersion` and ledger-filename renames.
