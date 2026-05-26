# you-shall-not-add Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a zero-runtime-dependency CLI that gates npm dependency additions through a committed approval ledger and a CI `check` that fails when a dependency entered the repo unreviewed.

**Architecture:** Pure-logic modules (config, ledger, checks, alternatives, pm, art, check-command) with no I/O side effects, plus thin I/O adapters (registry fetch, package-manager installer) injected into a `cli.ts` orchestrator. `safe-add` reviews → installs → writes the ledger (after success). `check` reads `package.json` against the ledger and exits non-zero on violations. TypeScript compiled to ESM JS; tests run on Node's built-in `node:test`.

**Tech Stack:** TypeScript (dev-only compiler), Node 18+ natives (`fetch`, `node:fs`, `node:child_process`, `node:test`, `node:assert`). Zero runtime dependencies. ESM (`"type": "module"`, `NodeNext`).

**Conventions:** Every commit message ends with the trailer `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` (omitted from the commands below for brevity — add it). TS source uses `.js` import extensions (required by `NodeNext`). Tests live in `test/` mirroring `src/`, compiled to `dist/test/`, run via `node --test dist/test`.

**Spec:** `docs/superpowers/specs/2026-05-23-you-shall-not-add-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `package.json` | zero deps, `bin` entries, scripts | 
| `tsconfig.json` | ESM/NodeNext build config |
| `src/config.ts` | load `.safe-dep.json`, merge defaults |
| `src/ledger.ts` | read/write/upsert/validate the approval ledger |
| `src/checks.ts` | version-age + install-script findings, risk rollup |
| `src/pm.ts` | package-manager detection, install args, cooldown detection |
| `src/alternatives.ts` | built-in + already-present alternative lookup |
| `src/registry.ts` | npm metadata fetch + normalization (I/O adapter) |
| `src/art.ts` | ASCII/ANSI art + TTY/`NO_COLOR`/`--quiet` rules |
| `src/check-command.ts` | CI check logic (package.json vs ledger) |
| `src/cli.ts` | arg parsing + orchestration, injects registry & installer |
| `assets/banner.svg` | README header (fantasy + 80s palette) |
| `examples/pre-commit.sh`, `examples/pre-push.sh` | local hook callers |
| `.github/workflows/dependency-security.yml`, `.gitlab-ci.yml` | shipped CI examples |
| `AGENTS.md`, `README.md`, `.safe-dep.json`, `.security/dependency-approvals.json` | docs/config |

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `test/smoke.test.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "you-shall-not-add",
  "version": "0.1.0",
  "description": "A Gandalf-style dependency-governance gate for Node.js projects and coding agents.",
  "type": "module",
  "bin": {
    "safe-add": "dist/src/cli.js",
    "you-shall-not-add": "dist/src/cli.js"
  },
  "files": ["dist/src", "assets"],
  "engines": { "node": ">=18" },
  "scripts": {
    "build": "tsc",
    "test": "tsc && node --test dist/test",
    "prepublishOnly": "npm run build"
  },
  "dependencies": {},
  "devDependencies": {
    "typescript": "^5.5.0",
    "@types/node": "^22.0.0"
  },
  "license": "MIT"
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rootDir": ".",
    "outDir": "dist",
    "strict": true,
    "declaration": false,
    "skipLibCheck": true,
    "esModuleInterop": true
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Create `.gitignore`**

```
node_modules/
dist/
```

- [ ] **Step 4: Write a smoke test at `test/smoke.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

test("smoke", () => {
  assert.equal(1 + 1, 2);
});
```

- [ ] **Step 5: Install dev deps and run**

Run: `npm install && npm test`
Expected: build succeeds, smoke test PASSES (`tests 1`, `pass 1`).

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.json .gitignore test/smoke.test.ts package-lock.json
git commit -m "chore: scaffold zero-dep TS project with node:test"
```

---

## Task 2: Config loader

**Files:**
- Create: `src/config.ts`, `test/config.test.ts`

- [ ] **Step 1: Write failing test `test/config.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, DEFAULT_CONFIG } from "../src/config.js";

test("returns defaults when no config file", () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-"));
  try {
    assert.deepEqual(loadConfig(dir), DEFAULT_CONFIG);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("merges file over defaults", () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-"));
  try {
    writeFileSync(join(dir, ".safe-dep.json"), JSON.stringify({ minimumVersionAgeHours: 48, packageManager: "npm" }));
    const cfg = loadConfig(dir);
    assert.equal(cfg.minimumVersionAgeHours, 48);
    assert.equal(cfg.packageManager, "npm");
    assert.equal(cfg.blockInstallScripts, true); // default preserved
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("throws on malformed JSON", () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-"));
  try {
    writeFileSync(join(dir, ".safe-dep.json"), "{ not json");
    assert.throws(() => loadConfig(dir), /\.safe-dep\.json/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `../src/config.js`.

- [ ] **Step 3: Implement `src/config.ts`**

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type PackageManager = "auto" | "pnpm" | "npm" | "yarn";

export interface Config {
  minimumVersionAgeHours: number;
  warnVersionAgeHours: number;
  blockInstallScripts: boolean;
  requireApprovalForHighRisk: boolean;
  requireCooldownConfigured: boolean;
  allowScopedPackages: string[];
  packageManager: PackageManager;
  knownAlternatives: Record<string, string>;
}

export const DEFAULT_CONFIG: Config = {
  minimumVersionAgeHours: 24,
  warnVersionAgeHours: 168,
  blockInstallScripts: true,
  requireApprovalForHighRisk: true,
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

- [ ] **Step 4: Run, verify pass**

Run: `npm test`
Expected: PASS (3 config tests).

- [ ] **Step 5: Commit**

```bash
git add src/config.ts test/config.test.ts
git commit -m "feat: config loader with defaults and merge"
```

---

## Task 3: Ledger read/write/upsert

**Files:**
- Create: `src/ledger.ts`, `test/ledger.test.ts`

- [ ] **Step 1: Write failing test `test/ledger.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLedger, writeLedger, upsertEntry, LedgerEntry } from "../src/ledger.js";

const entry: LedgerEntry = {
  approvedVersion: "4.17.21",
  approvedAt: "2026-05-23T10:00:00Z",
  risk: "low",
  reason: null,
  approvedBy: null,
  checks: { ageHours: 900, installScripts: false },
};

test("readLedger returns {} when file missing", () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-"));
  try {
    assert.deepEqual(readLedger(dir), {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("write then read round-trips", () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-"));
  try {
    writeLedger(dir, { lodash: entry });
    assert.deepEqual(readLedger(dir), { lodash: entry });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("upsertEntry adds without mutating input", () => {
  const before = {};
  const after = upsertEntry(before, "lodash", entry);
  assert.deepEqual(after, { lodash: entry });
  assert.deepEqual(before, {});
});

test("readLedger throws on malformed file", () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-"));
  try {
    writeFileSync(join(dir, ".security", "dependency-approvals.json"), "x", { flag: "w" });
    assert.throws(() => readLedger(dir));
  } catch (e) {
    // mkdir needed first; create dir then file
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
});
```

- [ ] **Step 2: Fix the malformed-file test to create the directory first**

Replace the fourth test with:

```ts
test("readLedger throws on malformed file", () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-"));
  try {
    mkdirSync(join(dir, ".security"), { recursive: true });
    writeFileSync(join(dir, ".security", "dependency-approvals.json"), "{ bad");
    assert.throws(() => readLedger(dir), /dependency-approvals/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

And add `mkdirSync` to the imports: `import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";` (remove unused `readFileSync`).

- [ ] **Step 3: Run, verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `../src/ledger.js`.

- [ ] **Step 4: Implement `src/ledger.ts`**

```ts
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

export type Risk = "low" | "medium" | "high";

export interface LedgerEntry {
  approvedVersion: string;
  approvedAt: string;
  risk: Risk;
  reason: string | null;
  approvedBy: string | null;
  checks: { ageHours: number | null; installScripts: boolean };
}

export type Ledger = Record<string, LedgerEntry>;

export const LEDGER_RELATIVE = join(".security", "dependency-approvals.json");

export function ledgerPath(cwd: string): string {
  return join(cwd, LEDGER_RELATIVE);
}

export function readLedger(cwd: string): Ledger {
  let raw: string;
  try {
    raw = readFileSync(ledgerPath(cwd), "utf8");
  } catch {
    return {};
  }
  try {
    return JSON.parse(raw) as Ledger;
  } catch {
    throw new Error(`Invalid ${LEDGER_RELATIVE}: not valid JSON`);
  }
}

export function writeLedger(cwd: string, ledger: Ledger): void {
  const path = ledgerPath(cwd);
  mkdirSync(dirname(path), { recursive: true });
  const sorted: Ledger = {};
  for (const key of Object.keys(ledger).sort()) sorted[key] = ledger[key];
  writeFileSync(path, JSON.stringify(sorted, null, 2) + "\n");
}

export function upsertEntry(ledger: Ledger, name: string, entry: LedgerEntry): Ledger {
  return { ...ledger, [name]: entry };
}
```

- [ ] **Step 5: Run, verify pass**

Run: `npm test`
Expected: PASS (4 ledger tests).

- [ ] **Step 6: Commit**

```bash
git add src/ledger.ts test/ledger.test.ts
git commit -m "feat: ledger read/write/upsert with sorted output"
```

---

## Task 4: Checks (version age, install scripts, risk rollup)

**Files:**
- Create: `src/checks.ts`, `test/checks.test.ts`

- [ ] **Step 1: Write failing test `test/checks.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkVersionAge, checkInstallScripts, overallRisk, DANGEROUS_SCRIPTS } from "../src/checks.js";
import { DEFAULT_CONFIG } from "../src/config.js";

const now = new Date("2026-05-23T00:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000);

test("age < 24h blocks", () => {
  const f = checkVersionAge(hoursAgo(2), now, DEFAULT_CONFIG);
  assert.equal(f.level, "block");
});

test("age between 24h and 7d warns", () => {
  const f = checkVersionAge(hoursAgo(48), now, DEFAULT_CONFIG);
  assert.equal(f.level, "warn");
});

test("age >= 7d is ok", () => {
  const f = checkVersionAge(hoursAgo(24 * 30), now, DEFAULT_CONFIG);
  assert.equal(f.level, "ok");
});

test("unknown publish date warns, never silently ok", () => {
  const f = checkVersionAge(null, now, DEFAULT_CONFIG);
  assert.equal(f.level, "warn");
});

test("install script blocks when blockInstallScripts true", () => {
  const f = checkInstallScripts({ postinstall: "node x.js" }, DEFAULT_CONFIG);
  assert.equal(f.level, "block");
  assert.match(f.message, /postinstall/);
});

test("non-lifecycle scripts are ignored", () => {
  const f = checkInstallScripts({ test: "node --test", build: "tsc" }, DEFAULT_CONFIG);
  assert.equal(f.level, "ok");
});

test("DANGEROUS_SCRIPTS lists the six lifecycle hooks", () => {
  assert.deepEqual([...DANGEROUS_SCRIPTS].sort(), [
    "install", "postinstall", "preinstall", "prepare", "prepublish", "prepublishOnly",
  ].sort());
});

test("overallRisk: block->high, warn->medium, none->low", () => {
  assert.equal(overallRisk([{ level: "block", message: "" }]), "high");
  assert.equal(overallRisk([{ level: "warn", message: "" }]), "medium");
  assert.equal(overallRisk([{ level: "ok", message: "" }]), "low");
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `../src/checks.js`.

- [ ] **Step 3: Implement `src/checks.ts`**

```ts
import type { Config } from "./config.js";
import type { Risk } from "./ledger.js";

export type Severity = "ok" | "warn" | "block";
export interface Finding { level: Severity; message: string; }

export const DANGEROUS_SCRIPTS = [
  "preinstall", "install", "postinstall", "prepare", "prepublish", "prepublishOnly",
] as const;

export function ageHours(publishedAt: Date | null, now: Date): number | null {
  if (!publishedAt) return null;
  return (now.getTime() - publishedAt.getTime()) / 3600_000;
}

export function checkVersionAge(publishedAt: Date | null, now: Date, cfg: Config): Finding {
  const h = ageHours(publishedAt, now);
  if (h === null) return { level: "warn", message: "Publish date unknown; cannot verify version age." };
  if (h < cfg.minimumVersionAgeHours) return { level: "block", message: `Version published only ${h.toFixed(1)}h ago (min ${cfg.minimumVersionAgeHours}h).` };
  if (h < cfg.warnVersionAgeHours) return { level: "warn", message: `Version is ${(h / 24).toFixed(1)} days old (warn under ${(cfg.warnVersionAgeHours / 24).toFixed(0)} days).` };
  return { level: "ok", message: `Version is ${(h / 24).toFixed(0)} days old.` };
}

export function checkInstallScripts(scripts: Record<string, string>, cfg: Config): Finding {
  const found = DANGEROUS_SCRIPTS.filter((s) => scripts[s]);
  if (found.length === 0) return { level: "ok", message: "No install-time scripts." };
  const level: Severity = cfg.blockInstallScripts ? "block" : "warn";
  return { level, message: `Package has install-time scripts: ${found.join(", ")}.` };
}

export function overallRisk(findings: Finding[]): Risk {
  if (findings.some((f) => f.level === "block")) return "high";
  if (findings.some((f) => f.level === "warn")) return "medium";
  return "low";
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test`
Expected: PASS (8 checks tests).

- [ ] **Step 5: Commit**

```bash
git add src/checks.ts test/checks.test.ts
git commit -m "feat: version-age and install-script checks with risk rollup"
```

---

## Task 5: Package-manager detection, install args, cooldown detection

**Files:**
- Create: `src/pm.ts`, `test/pm.test.ts`

- [ ] **Step 1: Write failing test `test/pm.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectPM, installArgs, cooldownConfigured } from "../src/pm.js";

function withDir(files: Record<string, string>, fn: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "ysna-"));
  try {
    for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("detects pnpm by lockfile", () => withDir({ "pnpm-lock.yaml": "" }, (d) => assert.equal(detectPM(d, "auto"), "pnpm")));
test("detects yarn by lockfile", () => withDir({ "yarn.lock": "" }, (d) => assert.equal(detectPM(d, "auto"), "yarn")));
test("detects npm by lockfile", () => withDir({ "package-lock.json": "" }, (d) => assert.equal(detectPM(d, "auto"), "npm")));
test("defaults to pnpm when none", () => withDir({}, (d) => assert.equal(detectPM(d, "auto"), "pnpm")));
test("explicit config overrides detection", () => withDir({ "yarn.lock": "" }, (d) => assert.equal(detectPM(d, "npm"), "npm")));

test("install args, runtime and dev", () => {
  assert.deepEqual(installArgs("pnpm", "lodash", false), ["add", "lodash"]);
  assert.deepEqual(installArgs("pnpm", "lodash", true), ["add", "-D", "lodash"]);
  assert.deepEqual(installArgs("npm", "lodash", true), ["install", "-D", "lodash"]);
  assert.deepEqual(installArgs("yarn", "lodash", true), ["add", "-D", "lodash"]);
});

test("cooldownConfigured true when pnpm minimumReleaseAge set", () =>
  withDir({ "pnpm-workspace.yaml": "minimumReleaseAge: 1440\n" }, (d) => assert.equal(cooldownConfigured(d, "pnpm"), true)));
test("cooldownConfigured false when absent", () =>
  withDir({ "pnpm-workspace.yaml": "packages:\n  - x\n" }, (d) => assert.equal(cooldownConfigured(d, "pnpm"), false)));
```

- [ ] **Step 2: Run, verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `../src/pm.js`.

- [ ] **Step 3: Implement `src/pm.ts`**

```ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PackageManager } from "./config.js";

export type PM = "pnpm" | "npm" | "yarn";

export function detectPM(cwd: string, configured: PackageManager): PM {
  if (configured !== "auto") return configured;
  if (existsSync(join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(cwd, "yarn.lock"))) return "yarn";
  if (existsSync(join(cwd, "package-lock.json"))) return "npm";
  return "pnpm";
}

export function installArgs(pm: PM, pkg: string, dev: boolean): string[] {
  const verb = pm === "npm" ? "install" : "add";
  return dev ? [verb, "-D", pkg] : [verb, pkg];
}

function fileHas(path: string, pattern: RegExp): boolean {
  try {
    return pattern.test(readFileSync(path, "utf8"));
  } catch {
    return false;
  }
}

export function cooldownConfigured(cwd: string, pm: PM): boolean {
  if (pm === "pnpm") {
    return (
      fileHas(join(cwd, "pnpm-workspace.yaml"), /minimumReleaseAge\s*:/) ||
      fileHas(join(cwd, ".npmrc"), /minimum-release-age\s*=/)
    );
  }
  if (pm === "yarn") return fileHas(join(cwd, ".yarnrc.yml"), /npmMinimalAgeGate\s*:/);
  return fileHas(join(cwd, ".npmrc"), /min-release-age\s*=/);
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test`
Expected: PASS (9 pm tests).

- [ ] **Step 5: Commit**

```bash
git add src/pm.ts test/pm.test.ts
git commit -m "feat: package-manager detection, install args, cooldown detection"
```

---

## Task 6: Alternatives engine

**Files:**
- Create: `src/alternatives.ts`, `test/alternatives.test.ts`

- [ ] **Step 1: Write failing test `test/alternatives.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { findAlternatives } from "../src/alternatives.js";

test("suggests Node built-in for uuid", () => {
  const alts = findAlternatives("uuid", [], {});
  assert.ok(alts.some((a) => a.type === "builtin" && /randomUUID/.test(a.message)));
});

test("suggests existing dep when equivalent already present", () => {
  const alts = findAlternatives("lodash", ["remeda"], {});
  assert.ok(alts.some((a) => a.type === "existing" && /remeda/.test(a.message)));
});

test("no existing suggestion when equivalent not installed", () => {
  const alts = findAlternatives("lodash", ["express"], {});
  assert.equal(alts.filter((a) => a.type === "existing").length, 0);
});

test("config override adds a builtin-style note", () => {
  const alts = findAlternatives("moment", [], { moment: "Prefer date-fns or Intl APIs" });
  assert.ok(alts.some((a) => /date-fns/.test(a.message)));
});

test("unknown package yields no alternatives", () => {
  assert.deepEqual(findAlternatives("some-unique-thing", [], {}), []);
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `../src/alternatives.js`.

- [ ] **Step 3: Implement `src/alternatives.ts`**

```ts
export interface Alternative { type: "builtin" | "existing"; message: string; }

const BUILTINS: Record<string, string> = {
  uuid: "Node has crypto.randomUUID() built in.",
  "node-fetch": "Node 18+ has a global fetch().",
  "left-pad": "Use String.prototype.padStart().",
  rimraf: "Use fs.rm(path, { recursive: true, force: true }).",
};

const EQUIVALENTS: Record<string, string[]> = {
  lodash: ["remeda", "es-toolkit"],
  moment: ["date-fns", "dayjs"],
  axios: ["ky", "ofetch"],
};

export function findAlternatives(
  pkg: string,
  existingDeps: string[],
  overrides: Record<string, string>,
): Alternative[] {
  const out: Alternative[] = [];
  if (BUILTINS[pkg]) out.push({ type: "builtin", message: BUILTINS[pkg] });
  if (overrides[pkg]) out.push({ type: "builtin", message: overrides[pkg] });
  const installed = (EQUIVALENTS[pkg] ?? []).filter((e) => existingDeps.includes(e));
  for (const e of installed) out.push({ type: "existing", message: `Project already uses "${e}"; prefer it unless "${pkg}" is required.` });
  return out;
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test`
Expected: PASS (5 alternatives tests).

- [ ] **Step 5: Commit**

```bash
git add src/alternatives.ts test/alternatives.test.ts
git commit -m "feat: alternatives engine (built-ins + already-present)"
```

---

## Task 7: Art module (TTY/NO_COLOR/quiet-aware)

**Files:**
- Create: `src/art.ts`, `test/art.test.ts`

- [ ] **Step 1: Write failing test `test/art.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldShowWordmark, wordmark, blockBanner } from "../src/art.js";

test("wordmark hidden when not a TTY", () => {
  assert.equal(shouldShowWordmark({ isTTY: false, noColor: false, quiet: false }), false);
});
test("wordmark hidden when quiet", () => {
  assert.equal(shouldShowWordmark({ isTTY: true, noColor: false, quiet: true }), false);
});
test("wordmark shown on interactive terminal", () => {
  assert.equal(shouldShowWordmark({ isTTY: true, noColor: false, quiet: false }), true);
});
test("wordmark returns non-empty string text", () => {
  assert.ok(wordmark({ isTTY: true, noColor: true, quiet: false }).length > 0);
});
test("block banner always returns the catchphrase, even non-TTY", () => {
  const b = blockBanner({ isTTY: false, noColor: true, quiet: true });
  assert.match(b, /YOU SHALL NOT PASS/);
});
test("no ANSI escape codes when noColor is set", () => {
  const b = blockBanner({ isTTY: true, noColor: true, quiet: false });
  assert.doesNotMatch(b, /\x1b\[/);
});
test("ANSI escape codes present when color allowed on TTY", () => {
  const b = blockBanner({ isTTY: true, noColor: false, quiet: false });
  assert.match(b, /\x1b\[/);
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `../src/art.js`.

- [ ] **Step 3: Implement `src/art.ts`**

```ts
export interface OutputOpts { isTTY: boolean; noColor: boolean; quiet: boolean; }

const MAGENTA = "\x1b[35m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

function color(s: string, code: string, opts: OutputOpts): string {
  if (opts.noColor || !opts.isTTY) return s;
  return code + s + RESET;
}

export function shouldShowWordmark(opts: OutputOpts): boolean {
  return opts.isTTY && !opts.quiet;
}

const WORDMARK_TEXT = [
  "  __  _____  _   _   ____  _  _   _   _    _    _  _  ___ _____ ",
  " |  \\/  / _ \\| | | | / ___|| || | /_\\ | |  | |  | \\| |/ _ \\_   _|",
  " | |\\/| | (_) | |_| | \\___ \\ __ |/ _ \\| |__| |__| .  | (_) || |  ",
  " |_|  |_|\\___/ \\___/  |____/_||_/_/ \\_\\____|____|_|\\_|\\___/ |_|  ",
  "          you-shall-not-add — review before it enters the repo",
].join("\n");

export function wordmark(opts: OutputOpts): string {
  return color(WORDMARK_TEXT, CYAN, opts);
}

const GATE = [
  "          .:*~*:._.:*~*:._.:*~*:.",
  "         |   ⛰  THE GATE OF MORIA  ⛰   |",
  "         |                              |",
  "         |      YOU SHALL NOT PASS      |",
  "          ':*~*:._.:*~*:._.:*~*:.'",
].join("\n");

export function blockBanner(opts: OutputOpts): string {
  return color(GATE, MAGENTA, opts);
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test`
Expected: PASS (7 art tests).

- [ ] **Step 5: Commit**

```bash
git add src/art.ts test/art.test.ts
git commit -m "feat: TTY/NO_COLOR-aware ASCII art and block banner"
```

---

## Task 8: Check command (CI enforcement logic)

**Files:**
- Create: `src/check-command.ts`, `test/check-command.test.ts`

- [ ] **Step 1: Write failing test `test/check-command.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { runCheck } from "../src/check-command.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import type { Ledger } from "../src/ledger.js";

const base = { approvedVersion: "1.0.0", approvedAt: "x", reason: null, approvedBy: null, checks: { ageHours: 1, installScripts: false } };

test("fails when a dependency has no ledger entry", () => {
  const v = runCheck({ dependencies: { lodash: "^4" } }, {}, DEFAULT_CONFIG);
  assert.equal(v.length, 1);
  assert.equal(v[0].package, "lodash");
  assert.match(v[0].reason, /no ledger entry/i);
});

test("passes when every dep is in the ledger", () => {
  const ledger: Ledger = { lodash: { ...base, risk: "low" } };
  const v = runCheck({ dependencies: { lodash: "^4" } }, ledger, DEFAULT_CONFIG);
  assert.deepEqual(v, []);
});

test("checks devDependencies too", () => {
  const v = runCheck({ devDependencies: { typescript: "^5" } }, {}, DEFAULT_CONFIG);
  assert.equal(v.length, 1);
  assert.equal(v[0].package, "typescript");
});

test("high-risk without reason fails", () => {
  const ledger: Ledger = { evil: { ...base, risk: "high", reason: null, approvedBy: "alice" } };
  const v = runCheck({ dependencies: { evil: "1" } }, ledger, DEFAULT_CONFIG);
  assert.ok(v.some((x) => /reason/i.test(x.reason)));
});

test("high-risk with reason but no approvedBy fails when approval required", () => {
  const ledger: Ledger = { evil: { ...base, risk: "high", reason: "needed", approvedBy: null } };
  const v = runCheck({ dependencies: { evil: "1" } }, ledger, DEFAULT_CONFIG);
  assert.ok(v.some((x) => /approv/i.test(x.reason)));
});

test("high-risk with reason and approvedBy passes", () => {
  const ledger: Ledger = { evil: { ...base, risk: "high", reason: "needed", approvedBy: "alice" } };
  const v = runCheck({ dependencies: { evil: "1" } }, ledger, DEFAULT_CONFIG);
  assert.deepEqual(v, []);
});

test("approval not required when requireApprovalForHighRisk is false", () => {
  const cfg = { ...DEFAULT_CONFIG, requireApprovalForHighRisk: false };
  const ledger: Ledger = { evil: { ...base, risk: "high", reason: "needed", approvedBy: null } };
  const v = runCheck({ dependencies: { evil: "1" } }, ledger, cfg);
  assert.deepEqual(v, []);
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `../src/check-command.js`.

- [ ] **Step 3: Implement `src/check-command.ts`**

```ts
import type { Config } from "./config.js";
import type { Ledger } from "./ledger.js";

export interface PackageJsonLike {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export interface CheckViolation { package: string; reason: string; }

export function runCheck(pkg: PackageJsonLike, ledger: Ledger, cfg: Config): CheckViolation[] {
  const names = [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ];
  const violations: CheckViolation[] = [];
  for (const name of names) {
    const entry = ledger[name];
    if (!entry) {
      violations.push({ package: name, reason: "no ledger entry — was it added without safe-add?" });
      continue;
    }
    if (entry.risk === "high") {
      if (!entry.reason || entry.reason.trim() === "") {
        violations.push({ package: name, reason: "high-risk entry missing a reason." });
      }
      if (cfg.requireApprovalForHighRisk && (!entry.approvedBy || entry.approvedBy.trim() === "")) {
        violations.push({ package: name, reason: "high-risk entry needs approvedBy (a reason alone does not authorize)." });
      }
    }
  }
  return violations;
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test`
Expected: PASS (7 check-command tests).

- [ ] **Step 5: Commit**

```bash
git add src/check-command.ts test/check-command.test.ts
git commit -m "feat: check command enforces ledger coverage and high-risk approval"
```

---

## Task 9: Registry client (I/O adapter)

**Files:**
- Create: `src/registry.ts`, `test/registry.test.ts`

- [ ] **Step 1: Write failing test `test/registry.test.ts`**

Tests the pure `normalizeMetadata` function against a fixture (no network).

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeMetadata, PackageNotFoundError } from "../src/registry.js";

const fixture = {
  "dist-tags": { latest: "4.17.21" },
  versions: {
    "4.17.21": {
      name: "lodash",
      version: "4.17.21",
      scripts: { test: "echo" },
      repository: { url: "git+https://github.com/lodash/lodash.git" },
      license: "MIT",
    },
  },
  time: { "4.17.21": "2021-02-20T15:42:16.891Z" },
};

test("normalizes latest version", () => {
  const m = normalizeMetadata("lodash", undefined, fixture);
  assert.equal(m.version, "4.17.21");
  assert.equal(m.hasRepository, true);
  assert.equal(m.hasLicense, true);
  assert.deepEqual(m.scripts, { test: "echo" });
  assert.ok(m.publishedAt instanceof Date);
});

test("resolves an explicit version", () => {
  const m = normalizeMetadata("lodash", "4.17.21", fixture);
  assert.equal(m.version, "4.17.21");
});

test("throws PackageNotFoundError for missing version", () => {
  assert.throws(() => normalizeMetadata("lodash", "9.9.9", fixture), PackageNotFoundError);
});

test("missing time yields null publishedAt", () => {
  const noTime = { ...fixture, time: {} };
  const m = normalizeMetadata("lodash", undefined, noTime);
  assert.equal(m.publishedAt, null);
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `../src/registry.js`.

- [ ] **Step 3: Implement `src/registry.ts`**

```ts
export interface PackageMetadata {
  name: string;
  version: string;
  publishedAt: Date | null;
  scripts: Record<string, string>;
  hasRepository: boolean;
  hasLicense: boolean;
  deprecated: boolean;
}

export interface RegistryClient {
  fetchMetadata(name: string, versionSpec?: string): Promise<PackageMetadata>;
}

export class PackageNotFoundError extends Error {}
export class RegistryUnavailableError extends Error {}

interface RawDoc {
  "dist-tags"?: Record<string, string>;
  versions?: Record<string, any>;
  time?: Record<string, string>;
}

export function normalizeMetadata(name: string, versionSpec: string | undefined, doc: RawDoc): PackageMetadata {
  const version = versionSpec ?? doc["dist-tags"]?.latest;
  if (!version) throw new PackageNotFoundError(`No version resolved for ${name}`);
  const v = doc.versions?.[version];
  if (!v) throw new PackageNotFoundError(`Version ${version} not found for ${name}`);
  const timeStr = doc.time?.[version];
  return {
    name,
    version,
    publishedAt: timeStr ? new Date(timeStr) : null,
    scripts: v.scripts ?? {},
    hasRepository: Boolean(v.repository),
    hasLicense: Boolean(v.license),
    deprecated: Boolean(v.deprecated),
  };
}

export class NpmRegistryClient implements RegistryClient {
  async fetchMetadata(name: string, versionSpec?: string): Promise<PackageMetadata> {
    let res: Response;
    try {
      res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`);
    } catch {
      throw new RegistryUnavailableError(`Could not reach the npm registry for ${name}.`);
    }
    if (res.status === 404) throw new PackageNotFoundError(`Package not found: ${name}`);
    if (!res.ok) throw new RegistryUnavailableError(`Registry returned ${res.status} for ${name}.`);
    const doc = (await res.json()) as RawDoc;
    return normalizeMetadata(name, versionSpec, doc);
  }
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test`
Expected: PASS (4 registry tests).

- [ ] **Step 5: Commit**

```bash
git add src/registry.ts test/registry.test.ts
git commit -m "feat: registry client with pure metadata normalization"
```

---

## Task 10: CLI orchestration

**Files:**
- Create: `src/cli.ts`, `test/cli.test.ts`

The orchestrator exposes a testable `runSafeAdd` with injected `registry`, `installer`, `now`, and `cwd`, plus a `main()` that wires real implementations. Package spec parsing (`name`, `name@version`, `@scope/pkg`, `@scope/pkg@version`) is a pure helper.

- [ ] **Step 1: Write failing test `test/cli.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSafeAdd, parseSpec } from "../src/cli.js";
import { readLedger } from "../src/ledger.js";
import type { RegistryClient, PackageMetadata } from "../src/registry.js";

function fakeRegistry(meta: Partial<PackageMetadata>): RegistryClient {
  return {
    async fetchMetadata(name) {
      return { name, version: "1.0.0", publishedAt: new Date("2020-01-01"), scripts: {}, hasRepository: true, hasLicense: true, deprecated: false, ...meta };
    },
  };
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "ysna-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "host", dependencies: {} }));
  return dir;
}

test("parseSpec handles plain, versioned, and scoped names", () => {
  assert.deepEqual(parseSpec("lodash"), { name: "lodash", version: undefined });
  assert.deepEqual(parseSpec("lodash@4.17.21"), { name: "lodash", version: "4.17.21" });
  assert.deepEqual(parseSpec("@scope/pkg"), { name: "@scope/pkg", version: undefined });
  assert.deepEqual(parseSpec("@scope/pkg@1.2.3"), { name: "@scope/pkg", version: "1.2.3" });
});

test("safe (old, no scripts) package installs and writes ledger", async () => {
  const dir = setup();
  try {
    const calls: string[][] = [];
    const code = await runSafeAdd({
      spec: "lodash", dev: false, force: null,
      registry: fakeRegistry({}),
      installer: { async install(_pm, args) { calls.push(args); return 0; } },
      now: () => new Date("2026-05-23"), cwd: dir, log: () => {}, err: () => {},
    });
    assert.equal(code, 0);
    assert.deepEqual(calls[0], ["add", "lodash"]);
    const ledger = readLedger(dir);
    assert.equal(ledger.lodash.risk, "low");
    assert.equal(ledger.lodash.approvedVersion, "1.0.0");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("blocked package (install script) does NOT install or write ledger, exits 1", async () => {
  const dir = setup();
  try {
    let installed = false;
    const code = await runSafeAdd({
      spec: "evil", dev: false, force: null,
      registry: fakeRegistry({ scripts: { postinstall: "x" } }),
      installer: { async install() { installed = true; return 0; } },
      now: () => new Date("2026-05-23"), cwd: dir, log: () => {}, err: () => {},
    });
    assert.equal(code, 1);
    assert.equal(installed, false);
    assert.deepEqual(readLedger(dir), {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--force-with-reason allows a blocked package and records high risk + reason", async () => {
  const dir = setup();
  try {
    const code = await runSafeAdd({
      spec: "evil", dev: false, force: "needed for bugfix",
      registry: fakeRegistry({ scripts: { postinstall: "x" } }),
      installer: { async install() { return 0; } },
      now: () => new Date("2026-05-23"), cwd: dir, log: () => {}, err: () => {},
    });
    assert.equal(code, 0);
    const e = readLedger(dir).evil;
    assert.equal(e.risk, "high");
    assert.equal(e.reason, "needed for bugfix");
    assert.equal(e.approvedBy, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ledger is NOT written when install fails", async () => {
  const dir = setup();
  try {
    const code = await runSafeAdd({
      spec: "lodash", dev: false, force: null,
      registry: fakeRegistry({}),
      installer: { async install() { return 7; } },
      now: () => new Date("2026-05-23"), cwd: dir, log: () => {}, err: () => {},
    });
    assert.equal(code, 7);
    assert.deepEqual(readLedger(dir), {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `../src/cli.js`.

- [ ] **Step 3: Implement `src/cli.ts`**

```ts
#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { loadConfig } from "./config.js";
import { readLedger, writeLedger, upsertEntry, type LedgerEntry } from "./ledger.js";
import { checkVersionAge, checkInstallScripts, overallRisk, ageHours, type Finding } from "./checks.js";
import { findAlternatives } from "./alternatives.js";
import { detectPM, installArgs, cooldownConfigured, type PM } from "./pm.js";
import { NpmRegistryClient, PackageNotFoundError, RegistryUnavailableError, type RegistryClient } from "./registry.js";
import { runCheck } from "./check-command.js";
import { wordmark, blockBanner, shouldShowWordmark, type OutputOpts } from "./art.js";

export function parseSpec(spec: string): { name: string; version: string | undefined } {
  const at = spec.lastIndexOf("@");
  if (at > 0) return { name: spec.slice(0, at), version: spec.slice(at + 1) };
  return { name: spec, version: undefined };
}

function existingDeps(cwd: string): string[] {
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
    return [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})];
  } catch {
    return [];
  }
}

export interface Installer { install(pm: PM, args: string[]): Promise<number>; }

export interface SafeAddOptions {
  spec: string;
  dev: boolean;
  force: string | null;
  registry: RegistryClient;
  installer: Installer;
  now: () => Date;
  cwd: string;
  log: (s: string) => void;
  err: (s: string) => void;
}

export async function runSafeAdd(opts: SafeAddOptions): Promise<number> {
  const cfg = loadConfig(opts.cwd);
  const { name, version } = parseSpec(opts.spec);

  for (const alt of findAlternatives(name, existingDeps(opts.cwd), cfg.knownAlternatives)) {
    opts.log(`note: ${alt.message}`);
  }

  let meta;
  try {
    meta = await opts.registry.fetchMetadata(name, version);
  } catch (e) {
    if (e instanceof PackageNotFoundError) { opts.err(`Package not found: ${name}`); return 1; }
    if (e instanceof RegistryUnavailableError) { opts.err(`${(e as Error).message} Refusing to install (fail-closed).`); return 1; }
    throw e;
  }

  const findings: Finding[] = [
    checkVersionAge(meta.publishedAt, opts.now(), cfg),
    checkInstallScripts(meta.scripts, cfg),
  ];
  for (const f of findings) if (f.level !== "ok") opts.log(`${f.level.toUpperCase()}: ${f.message}`);

  const risk = overallRisk(findings);
  const blocked = findings.some((f) => f.level === "block");

  if (blocked && !opts.force) {
    opts.err(blockBanner(outputOpts()));
    opts.err(`Decision: blocked. Re-run with --force-with-reason "<reason>" to override.`);
    return 1;
  }

  const pm = detectPM(opts.cwd, cfg.packageManager);
  if (cfg.requireCooldownConfigured && !cooldownConfigured(opts.cwd, pm)) {
    opts.log(`WARN: ${pm} has no release-age cooldown configured.`);
  }

  const code = await opts.installer.install(pm, installArgs(pm, opts.spec, opts.dev));
  if (code !== 0) { opts.err(`Install failed (exit ${code}); ledger not written.`); return code; }

  const entry: LedgerEntry = {
    approvedVersion: meta.version,
    approvedAt: opts.now().toISOString(),
    risk,
    reason: opts.force ?? null,
    approvedBy: null,
    checks: { ageHours: ageHours(meta.publishedAt, opts.now()), installScripts: Object.keys(meta.scripts).length > 0 && checkInstallScripts(meta.scripts, cfg).level !== "ok" },
  };
  writeLedger(opts.cwd, upsertEntry(readLedger(opts.cwd), name, entry));
  opts.log("Decision: allowed.");
  return 0;
}

function outputOpts(): OutputOpts {
  return { isTTY: Boolean(process.stdout.isTTY), noColor: Boolean(process.env.NO_COLOR), quiet: process.argv.includes("--quiet") };
}

function realInstaller(): Installer {
  return {
    install(pm, args) {
      return new Promise((resolve) => {
        const child = spawn(pm, args, { stdio: "inherit" });
        child.on("close", (code) => resolve(code ?? 1));
        child.on("error", () => resolve(1));
      });
    },
  };
}

async function main(argv: string[]): Promise<number> {
  const cwd = process.cwd();
  const o = outputOpts();
  if (shouldShowWordmark(o)) process.stdout.write(wordmark(o) + "\n");

  const args = argv.filter((a) => a !== "--quiet");
  const cmd = args[0];

  if (cmd === "check") {
    const cfg = loadConfig(cwd);
    const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
    const violations = runCheck(pkg, readLedger(cwd), cfg);
    if (violations.length === 0) { console.log("Dependency review: all dependencies are approved."); return 0; }
    for (const v of violations) console.error(`BLOCKED: ${v.package} — ${v.reason}`);
    return 1;
  }

  const positionals = args.filter((a) => !a.startsWith("-"));
  const dev = args.includes("-D") || args.includes("--save-dev");
  const fi = args.indexOf("--force-with-reason");
  const force = fi >= 0 ? (args[fi + 1] ?? "") : null;
  const spec = positionals[0];
  if (!spec) { console.error("Usage: safe-add <package> [-D] [--force-with-reason \"<reason>\"]\n       safe-add check"); return 1; }
  if (force !== null && force.trim() === "") { console.error("--force-with-reason requires a non-empty reason."); return 1; }

  return runSafeAdd({
    spec, dev, force,
    registry: new NpmRegistryClient(),
    installer: realInstaller(),
    now: () => new Date(),
    cwd,
    log: (s) => console.log(s),
    err: (s) => console.error(s),
  });
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test`
Expected: PASS (all cli tests + full suite green).

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts test/cli.test.ts
git commit -m "feat: CLI orchestration for safe-add and check"
```

---

## Task 11: CLI smoke test against the built binary

**Files:**
- Create: `test/cli-binary.test.ts`

- [ ] **Step 1: Write test that runs the built `check` against a fixture repo**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const cli = resolve("dist/src/cli.js");

test("check exits 1 on unreviewed dependency", () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: { lodash: "^4" } }));
    assert.throws(() => execFileSync(process.execPath, [cli, "check"], { cwd: dir, stdio: "pipe" }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check exits 0 when ledger covers deps", () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: { lodash: "^4" } }));
    mkdirSync(join(dir, ".security"), { recursive: true });
    writeFileSync(
      join(dir, ".security", "dependency-approvals.json"),
      JSON.stringify({ lodash: { approvedVersion: "4.17.21", approvedAt: "x", risk: "low", reason: null, approvedBy: null, checks: { ageHours: 1, installScripts: false } } }),
    );
    const out = execFileSync(process.execPath, [cli, "check"], { cwd: dir, encoding: "utf8" });
    assert.match(out, /all dependencies are approved/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run, verify pass**

Run: `npm test`
Expected: PASS (both binary tests; full suite green).

- [ ] **Step 3: Commit**

```bash
git add test/cli-binary.test.ts
git commit -m "test: end-to-end check command against built binary"
```

---

## Task 12: Repo content — config, ledger seed, AGENTS.md, README, banner

**Files:**
- Create: `.safe-dep.json`, `.security/dependency-approvals.json`, `AGENTS.md`, `assets/banner.svg`; rewrite `README.md`

- [ ] **Step 1: Create `.safe-dep.json`**

```json
{
  "minimumVersionAgeHours": 24,
  "warnVersionAgeHours": 168,
  "blockInstallScripts": true,
  "requireApprovalForHighRisk": true,
  "requireCooldownConfigured": false,
  "allowScopedPackages": [],
  "packageManager": "auto",
  "knownAlternatives": {
    "moment": "Prefer date-fns or the Intl APIs."
  }
}
```

- [ ] **Step 2: Seed the ledger `.security/dependency-approvals.json`**

```json
{}
```

- [ ] **Step 3: Create `AGENTS.md`**

```md
# Agent Dependency Rules

Agents MUST NOT run:

- `npm install <package>` / `npm install`
- `pnpm add <package>`
- `yarn add <package>`
- `bun add <package>`

Instead, agents MUST use:

    npx you-shall-not-add <package>        # alias: safe-add <package>
    npx you-shall-not-add <package> -D     # dev dependency

Before adding a dependency, the agent MUST explain:

1. Why the dependency is needed.
2. Why existing dependencies cannot solve it.
3. Whether a Node.js / browser built-in can solve it.
4. Whether the package runs install-time scripts.
5. Whether the version is old enough.
6. What risk the dependency introduces.

If `safe-add` blocks the package, the agent MUST NOT bypass it with
`--force-with-reason` to merely silence the gate. A `reason` is attribution, not
authorization: a high-risk dependency only passes CI once a human adds
`approvedBy` to its ledger entry. The agent should instead propose a safer
alternative.
```

- [ ] **Step 4: Create `assets/banner.svg`** (fantasy gate + 80s palette)

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="220" viewBox="0 0 800 220" role="img" aria-label="you-shall-not-add">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2b0a4a"/>
      <stop offset="1" stop-color="#0b0220"/>
    </linearGradient>
    <linearGradient id="sun" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ff2e97"/>
      <stop offset="1" stop-color="#ff8a3d"/>
    </linearGradient>
  </defs>
  <rect width="800" height="220" fill="url(#sky)"/>
  <circle cx="400" cy="150" r="80" fill="url(#sun)"/>
  <g stroke="#00e5ff" stroke-width="1.5" opacity="0.6">
    <line x1="0" y1="170" x2="800" y2="170"/>
    <line x1="0" y1="190" x2="800" y2="190"/>
    <line x1="0" y1="215" x2="800" y2="215"/>
    <line x1="400" y1="170" x2="120" y2="220"/>
    <line x1="400" y1="170" x2="680" y2="220"/>
  </g>
  <rect x="330" y="70" width="140" height="100" fill="none" stroke="#00e5ff" stroke-width="3"/>
  <text x="400" y="48" text-anchor="middle" font-family="monospace" font-size="34" fill="#ff2e97" font-weight="bold">you-shall-not-add</text>
  <text x="400" y="128" text-anchor="middle" font-family="monospace" font-size="14" fill="#e6e6e6">YOU SHALL NOT PASS</text>
</svg>
```

- [ ] **Step 5: Rewrite `README.md`**

```md
# you-shall-not-add

![banner](assets/banner.svg)

A Gandalf-style **dependency-governance gate** for Node.js projects and coding agents.

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
```

- [ ] **Step 6: Commit**

```bash
git add .safe-dep.json .security/dependency-approvals.json AGENTS.md assets/banner.svg README.md
git commit -m "docs: config, ledger seed, AGENTS.md, README, SVG banner"
```

---

## Task 13: CI examples and local hooks

**Files:**
- Create: `.github/workflows/dependency-security.yml`, `.gitlab-ci.yml`, `examples/pre-commit.sh`, `examples/pre-push.sh`

- [ ] **Step 1: Create `.github/workflows/dependency-security.yml`**

```yaml
name: Dependency Security
on:
  pull_request:
    paths:
      - "package.json"
      - "pnpm-lock.yaml"
      - "yarn.lock"
      - "package-lock.json"
      - ".safe-dep.json"
      - ".security/dependency-approvals.json"
jobs:
  dependency-security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npx you-shall-not-add check
```

- [ ] **Step 2: Create `.gitlab-ci.yml`**

```yaml
dependency-security:
  image: node:22
  rules:
    - changes:
        - package.json
        - pnpm-lock.yaml
        - yarn.lock
        - package-lock.json
        - .safe-dep.json
        - .security/dependency-approvals.json
  script:
    - npx you-shall-not-add check
```

- [ ] **Step 3: Create `examples/pre-commit.sh`**

```sh
#!/bin/sh
# Copy to .git/hooks/pre-commit and chmod +x.
# Fails the commit if any dependency lacks a ledger entry.
npx you-shall-not-add check || {
  echo "you-shall-not-add: unreviewed dependency. Use safe-add, or add an approval."
  exit 1
}
```

- [ ] **Step 4: Create `examples/pre-push.sh`**

```sh
#!/bin/sh
# Copy to .git/hooks/pre-push and chmod +x.
npx you-shall-not-add check || exit 1
```

- [ ] **Step 5: Commit**

```bash
chmod +x examples/pre-commit.sh examples/pre-push.sh
git add .github/workflows/dependency-security.yml .gitlab-ci.yml examples/pre-commit.sh examples/pre-push.sh
git commit -m "ci: GitHub + GitLab examples and local git hooks"
```

---

## Task 14: Final verification

- [ ] **Step 1: Full build + test**

Run: `npm run build && npm test`
Expected: build clean, all tests PASS.

- [ ] **Step 2: Verify zero runtime dependencies**

Run: `node -e "const p=require('./package.json');console.log(Object.keys(p.dependencies||{}).length)"`
Expected: prints `0`.

- [ ] **Step 3: Manually exercise the built CLI**

Run: `node dist/src/cli.js check` (in a temp dir with a package.json containing an unreviewed dep)
Expected: prints `BLOCKED: ...` and exits non-zero.

- [ ] **Step 4: Self-review against the spec**

Confirm: ledger written only after install success (Task 10 test), `reason` vs `approvedBy` split enforced (Task 8 tests), age check demoted to explanation + cooldown verification (Tasks 4/5), block banner always shown / wordmark TTY-gated (Task 7), GitHub + GitLab examples present (Task 13).

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "chore: final verification fixes"
```
```
