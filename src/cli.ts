#!/usr/bin/env node
import { readFileSync, realpathSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { loadConfig, isAllowlisted } from "./config.js";
import { readLedger, writeLedger, upsertEntry, LEDGER_RELATIVE, type LedgerEntry, type Risk } from "./ledger.js";
import { checkVersionAge, checkInstallScripts, checkDeprecated, checkKnownCve, overallRisk, ageHours, DANGEROUS_SCRIPTS, type Finding } from "./checks.js";
import { detectPM, detectPMFromSignals, installArgs, cooldownConfigured, type PM } from "./pm.js";
import { createNpmRegistryClient, PackageNotFoundError, RegistryUnavailableError, type RegistryClient } from "./registry.js";
import { runCheckWorkspaces, type CheckViolation } from "./check-command.js";
import { createVersionResolver, type VersionResolver } from "./installed.js";
import { splitNameVersion, ledgerKey } from "./spec.js";
import { createNpmAdvisoryClient, type AdvisoryClient, type Advisory } from "./advisories.js";
import { gitIdentity } from "./identity.js";
import { wordmark, shouldShowWordmark, statusHeader, type OutputOpts } from "./art.js";
import { findRepoRoot, discoverWorkspaces, type WorkspacePackage } from "./workspaces.js";
import { runAdopt, countUnrecorded } from "./adopt-command.js";

/** Re-exported from spec.ts — the single '@' boundary. Kept here for back-compat of the CLI's test surface. */
export const parseSpec = splitNameVersion;

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

export function helpText(): string {
  return [
    "vouch — a dependency-decision ledger: every dependency is recorded, explained, and reviewable in the PR.",
    "",
    "Usage:",
    '  vouch <package> [-D] [--force-with-reason "<reason>"]   Review, install, and record a dependency',
    "  vouch check                                             CI gate: fail on unrecorded deps, unexplained high-risk, CVE drift, or version drift",
    '  vouch adopt [--reason "<why>"]                          Baseline the whole repo: record every installed, unrecorded dependency',
    '  vouch acknowledge <package> --reason "<why>"            Knowingly accept a dependency\'s current advisories (CVE drift)',
    "  vouch init                                              Bootstrap vouch.config.{js,mjs} with typed defaults (and detected packageManager)",
    "  vouch --help | --version",
    "",
    "Flags:",
    "  -D, --save-dev            Add as a devDependency",
    '  --force-with-reason "…"   Override a block, recording the reason in the ledger',
    '  --reason "<why>"          Why a risk is knowingly accepted (acknowledge)',
    "  --quiet                   Suppress the decorative ✦ vouch status marker",
    "",
    "Environment:",
    "  VOUCH_ADVISORY_URL        Override the npm advisory endpoint (enterprise mirrors/proxies)",
    "",
    "vouch records decisions; the PR/MR review is the approval. The ledger lives at",
    ".security/dependency-approvals.json and is meant to be committed.",
  ].join("\n");
}

export interface InitOptions {
  cwd: string;
  log: (s: string) => void;
  err: (s: string) => void;
}

/** Pick the right vouch.config extension for this project — .js if package.json
 *  declares `"type": "module"`, otherwise .mjs (always ESM, regardless of host project). */
function pickConfigFilename(cwd: string): "vouch.config.js" | "vouch.config.mjs" {
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
    return pkg.type === "module" ? "vouch.config.js" : "vouch.config.mjs";
  } catch {
    return "vouch.config.mjs";
  }
}

/** Is `vouch` resolvable in this project's node_modules? If yes, the import-form config
 *  works at runtime AND gives full editor types via the bundled .d.ts. If not, we write a
 *  JSDoc-typed plain export that loads with zero local install. */
function isVouchInstalled(cwd: string): boolean {
  return existsSync(join(cwd, "node_modules", "@vouchjs", "vouch"));
}

function settingsBlock(pm: PM | "auto"): string[] {
  return [
    `  packageManager: ${JSON.stringify(pm)},`,
    "  allowScopedPackages: [],",
    "",
    "  // Install-time gate",
    "  minimumVersionAgeHours: 24,",
    "  warnVersionAgeHours: 168,",
    "  blockInstallScripts: true,",
    "  requireCooldownConfigured: false,",
    "",
    "  // CI gate — `vouch check` (always version-aware: asserts the exact installed name@version was reviewed)",
    `  requirePinned: "off",            // "warn" | "off"`,
    "  checkPeerDependencies: false,    // also gate peerDependencies (prod/dev/optional always gated)",
    "",
    "  // CVE handling at add time",
    `  cveAtInstall: "warn",            // "warn" | "block" | "off"`,
    `  cveAtInstallMinSeverity: "high", // "low" | "moderate" | "high" | "critical"`,
  ];
}

function configFileContent(detectedPM: PM | null, hasVouch: boolean): string {
  const pm: PM | "auto" = detectedPM ?? "auto";
  const header = [
    "/**",
    " * vouch — dependency-decision ledger.",
    " * Defaults shown below. Delete keys you're happy with — vouch picks up future",
    " * defaults automatically. Change keys you're not happy with.",
    " * Full reference: https://github.com/janpfajfr/vouch#configuration",
    " */",
  ];
  const body = hasVouch ? [
    `import { defineConfig } from "@vouchjs/vouch";`,
    "",
    "export default defineConfig({",
    ...settingsBlock(pm),
    "});",
  ] : [
    `/** @type {import("@vouchjs/vouch").Config} */`,
    "export default {",
    ...settingsBlock(pm),
    "};",
  ];
  return [...header, ...body, ""].join("\n");
}

/** Bootstraps a typed vouch.config.{js,mjs} with all defaults shown + detected packageManager.
 *  If a vouch.config.* or .safe-dep.json already exists, reports and exits without overwriting —
 *  this command never clobbers an existing config. */
export async function runInit(opts: InitOptions): Promise<number> {
  const o = outputOpts();
  // Refuse to touch any existing typed config file or the legacy JSON.
  for (const name of ["vouch.config.ts", "vouch.config.mts", "vouch.config.mjs", "vouch.config.js", "vouch.config.cjs", ".safe-dep.json"]) {
    if (existsSync(join(opts.cwd, name))) {
      opts.log(statusHeader("info", "Already initialized", o));
      opts.log("");
      opts.log(`  Found existing ${name}; leaving it alone.`);
      opts.log("  To regenerate from scratch, delete it and run \`vouch init\` again.");
      return 0;
    }
  }

  const filename = pickConfigFilename(opts.cwd);
  const detectedPM = detectPMFromSignals(opts.cwd);
  const hasVouch = isVouchInstalled(opts.cwd);
  writeFileSync(join(opts.cwd, filename), configFileContent(detectedPM, hasVouch));
  opts.log(statusHeader("success", `Initialized ${filename}`, o));
  opts.log("");
  opts.log("  Every config key is written with its default — delete what you don't care about,");
  opts.log("  edit what you do.");
  if (hasVouch) {
    opts.log(`  vouch is installed in this project — \`import { defineConfig } from "@vouchjs/vouch"\` is wired up.`);
  } else {
    opts.log(`  vouch isn't installed locally; the config uses a JSDoc \`@type\` annotation so it loads without`);
    opts.log(`  a local install. Run \`npm install -D @vouchjs/vouch\` to light up editor autocomplete on this file.`);
  }
  if (detectedPM) opts.log(`  Detected packageManager: "${detectedPM}"`);
  else opts.log(`  No PM signal detected; packageManager left as "auto" (falls back to npm).`);

  // Workspace-aware nudge: count distinct unrecorded name@installed across all workspaces.
  try {
    const repoRoot = findRepoRoot(opts.cwd);
    const cfg = await loadConfig(repoRoot);
    const workspaces = discoverWorkspaces(repoRoot);
    const resolver = createVersionResolver(repoRoot);
    const ledger = readLedger(repoRoot);
    const { count, workspaceCount } = countUnrecorded(workspaces, ledger, resolver, cfg);
    if (count > 0) {
      const wsSuffix = workspaceCount > 1 ? ` across ${workspaceCount} workspaces` : "";
      opts.log(`  ${count} dependenc${count === 1 ? "y is" : "ies are"}${wsSuffix} unrecorded — run \`vouch adopt\` to record them all.`);
    }
  } catch { /* nudge is best-effort; never fail init */ }

  return 0;
}

/** Read + parse the project's package.json with clean, branded errors (no raw stack trace). */
function readPackageJson(cwd: string): { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; optionalDependencies?: Record<string, string>; peerDependencies?: Record<string, string> } {
  let raw: string;
  try {
    raw = readFileSync(join(cwd, "package.json"), "utf8");
  } catch {
    throw new Error("No package.json in the current directory.");
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Invalid package.json: not valid JSON.");
  }
}

function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
    return `vouch ${pkg.version}`;
  } catch {
    return "vouch (unknown version)";
  }
}

export interface Installer { install(pm: PM, args: string[]): Promise<number>; }

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
  ledgerDir?: string; // root-ledger location; defaults to cwd (single-package)
  log: (s: string) => void;
  err: (s: string) => void;
}

export async function runSafeAdd(opts: SafeAddOptions): Promise<number> {
  const ledgerDir = opts.ledgerDir ?? opts.cwd;
  const cfg = await loadConfig(ledgerDir);
  const { name, version } = parseSpec(opts.spec);

  let meta;
  try {
    meta = await opts.registry.fetchMetadata(name, version);
  } catch (e) {
    if (e instanceof PackageNotFoundError) { opts.err(`Package not found: ${name}`); return 1; }
    if (e instanceof RegistryUnavailableError) { opts.err(`${(e as Error).message} Refusing to install (fail-closed).`); return 1; }
    throw e;
  }

  const id = `${name}@${meta.version}`;
  const o = outputOpts();
  const notes: string[] = [];

  const blocking: string[] = [];
  const findings: Finding[] = [];
  if (isAllowlisted(name, cfg.allowScopedPackages)) {
    notes.push(`"${name}" matches allowScopedPackages; risk gate skipped.`);
  } else {
    findings.push(
      checkVersionAge(meta.publishedAt, opts.now(), cfg),
      checkInstallScripts(meta.scripts, cfg),
      checkDeprecated(meta.deprecated),
    );
  }

  // Advisory finding — fed into the same findings list so it shapes risk + routing. Evaluated
  // even when allowlisted (a known CVE on a trusted scope is still worth flagging).
  // Shape by cfg.cveAtInstall: "warn"→note, "block"→blocks at/above the severity threshold,
  // "off"→skip the fetch entirely. Fail-open: an unreachable service returns null and stays silent.
  // The same fetch doubles as the recorded advisory baseline (checks.advisories). When
  // cveAtInstall is "off" no fetch runs, so no baseline is recorded and the entry degrades to
  // "present-at-record" at check time — the safe direction (never a false "NEW since recorded").
  let recordedAdvisories: Advisory[] | undefined;
  if (opts.advisoryClient && cfg.cveAtInstall !== "off") {
    const live = await opts.advisoryClient.fetchBulk({ [name]: [meta.version] });
    const found = live?.[name] ?? [];
    if (live !== null) recordedAdvisories = found; // real baseline (possibly []); null = offline → omit
    findings.push(checkKnownCve(name, found, cfg));
  }
  for (const f of findings) {
    if (f.level === "block") blocking.push(f.message);
    else if (f.level === "warn") notes.push(f.message);
  }
  const risk: Risk = overallRisk(findings);

  if (blocking.length > 0 && !opts.force) {
    opts.err(statusHeader("warn", "Dependency needs review", o));
    opts.err("");
    opts.err(`  ${id}`);
    for (const b of blocking) opts.err(`  - ${b}`);
    for (const n of notes) opts.err(`  - ${n}`);
    opts.err("");
    opts.err("  Next:");
    opts.err(`    vouch ${opts.spec} --force-with-reason "<why this dependency is needed>"`);
    return 1;
  }

  const pm = detectPM(ledgerDir, cfg.packageManager);
  if (cfg.requireCooldownConfigured && !cooldownConfigured(ledgerDir, pm)) {
    notes.push(`${pm} has no release-age cooldown configured.`);
  }

  // We vetted meta.version (resolved from the registry), but the package manager
  // re-resolves opts.spec independently. For a bare name both resolve "latest", so
  // they normally match; a dist-tag moving in the gap is a small TOCTOU window. The
  // ledger records meta.version — the version we actually reviewed.
  const code = await opts.installer.install(pm, installArgs(pm, opts.spec, opts.dev));
  if (code !== 0) { opts.err(`Install failed (exit ${code}); ledger not written.`); return code; }

  const installScripts = (() => { const s = Object.fromEntries(DANGEROUS_SCRIPTS.filter(k => meta.scripts[k]).map(k => [k, meta.scripts[k]])); return Object.keys(s).length > 0 ? s : false as const; })();
  const checks: LedgerEntry["checks"] = { ageHours: ageHours(meta.publishedAt, opts.now()), installScripts };
  if (recordedAdvisories !== undefined) checks.advisories = recordedAdvisories;
  const entry: LedgerEntry = {
    name,
    version: meta.version,
    addedAt: opts.now().toISOString(),
    risk,
    reason: opts.force ?? null,
    addedBy: (opts.identity ?? (() => gitIdentity()))(),
    checks,
  };
  writeLedger(ledgerDir, upsertEntry(readLedger(ledgerDir), name, meta.version, entry));
  opts.log(statusHeader("success", "Recorded dependency decision", o));
  opts.log("");
  opts.log(`  ${id}`);
  opts.log(`  Ledger: ${join(ledgerDir, LEDGER_RELATIVE)}`);
  for (const n of notes) opts.log(`  - ${n}`);
  return 0;
}

export interface AcknowledgeOptions {
  pkg: string;            // "name" (resolve installed) or explicit "name@version"
  reason: string;
  identity: () => string | null;
  client: AdvisoryClient;
  now: () => Date;
  cwd: string;
  ledgerDir?: string; // root-ledger location; defaults to cwd (single-package)
  log: (s: string) => void;
  err: (s: string) => void;
  resolver?: VersionResolver; // injected in tests; defaults to the real resolver (node_modules walk + pnpm-lock fallback) rooted at ledgerDir
}

export async function runAcknowledge(opts: AcknowledgeOptions): Promise<number> {
  const ledgerDir = opts.ledgerDir ?? opts.cwd;
  const ledger = readLedger(ledgerDir);
  const { name, version } = splitNameVersion(opts.pkg);
  const resolver = opts.resolver ?? createVersionResolver(ledgerDir);
  const v = version ?? resolver.resolve(opts.cwd, name) ?? undefined;
  if (v === undefined) {
    opts.err(`Not installed and no explicit version for ${name} — try \`vouch acknowledge ${name}@<version>\`.`);
    return 1;
  }
  const entry = ledger[ledgerKey(name, v)];
  if (!entry) { opts.err(`Not in ledger: ${name}@${v}`); return 1; }
  const live = await opts.client.fetchBulk({ [name]: [v] });
  if (live === null) {
    opts.err(`Could not verify advisories for ${name}@${v} (offline or registry error); ledger unchanged.`);
    return 1;
  }
  const acknowledged = live[name] ?? [];
  const updated = { ...entry, cve: { acknowledged, acknowledgedBy: opts.identity(), acknowledgedAt: opts.now().toISOString(), reason: opts.reason } };
  writeLedger(ledgerDir, upsertEntry(ledger, name, v, updated));
  opts.log(`Acknowledged ${name}@${v}: ${acknowledged.length} advisor${acknowledged.length === 1 ? "y" : "ies"} accepted — "${opts.reason}".`);
  return 0;
}

/** The single boundary where output context is read from the environment.
 *  argv is injectable (defaults to process.argv) so it isn't hard-wired to global state. */
function outputOpts(argv: readonly string[] = process.argv): OutputOpts {
  return { isTTY: Boolean(process.stdout.isTTY), noColor: Boolean(process.env.NO_COLOR), quiet: argv.includes("--quiet") };
}

const PER_GROUP_CAP = 10;

/** Flat list (single-package) or grouped by workspace relPath (monorepo). */
function renderViolations(violations: CheckViolation[], multi: boolean, out: (s: string) => void): void {
  if (!multi) {
    for (const v of violations) out(`  - ${v.package}: ${v.reason}`);
    return;
  }
  const byWs = new Map<string, CheckViolation[]>();
  for (const v of violations) {
    const k = v.workspace ?? ".";
    (byWs.get(k) ?? byWs.set(k, []).get(k)!).push(v);
  }
  for (const ws of [...byWs.keys()].sort()) {
    out(`  ${ws}`);
    const vs = byWs.get(ws)!;
    for (const v of vs.slice(0, PER_GROUP_CAP)) out(`    - ${v.package}: ${v.reason}`);
    if (vs.length > PER_GROUP_CAP) out(`    …and ${vs.length - PER_GROUP_CAP} more — run \`vouch adopt\` to baseline all.`);
  }
}

/** Ready-to-run `vouch name@version` list for unrecorded deps (capped; nudges adopt). */
function renderNextHint(violations: CheckViolation[], workspaces: WorkspacePackage[], multi: boolean, out: (s: string) => void): void {
  const unrecorded = violations.filter((v) => /never reviewed/.test(v.reason));
  if (unrecorded.length === 0) { out("  Next: resolve each item above — the fix is shown on its line."); return; }

  const devByWs = new Map<string, Set<string>>();
  for (const w of workspaces) {
    const devs = new Set(Object.keys(w.pkg.devDependencies ?? {}));
    devByWs.set(w.relPath, devs);
  }

  out(multi
    ? "  Next — record the unrecorded dependencies (run inside the workspace, or `vouch adopt` to baseline all):"
    : `  Next — record the unrecorded dependenc${unrecorded.length === 1 ? "y" : "ies"}:`);

  for (const v of unrecorded.slice(0, PER_GROUP_CAP)) {
    const { name } = splitNameVersion(v.package);
    const rel = v.workspace ?? ".";
    const isDev = devByWs.get(rel)?.has(name) ?? false;
    const loc = multi ? `(${rel})  ` : "";
    out(`    ${loc}vouch ${v.package}${isDev ? " -D" : ""}`);
  }
  if (unrecorded.length > PER_GROUP_CAP) out(`    …and ${unrecorded.length - PER_GROUP_CAP} more — run \`vouch adopt\`.`);
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

  const args = argv.filter((a) => a !== "--quiet");
  const cmd = args[0];

  if (cmd === "--version" || cmd === "-V") { console.log(readVersion()); return 0; }
  if (cmd === "help" || cmd === "--help" || cmd === "-h") {
    // The wordmark is the one playful flourish, kept to --help. Normal output stays calm.
    if (shouldShowWordmark(o)) console.log(wordmark(o) + "\n");
    console.log(helpText());
    return 0;
  }

  if (cmd === "init") {
    return await runInit({ cwd, log: (s) => console.log(s), err: (s) => console.error(s) });
  }

  if (cmd === "check") {
    const repoRoot = findRepoRoot(cwd);
    const cfg = await loadConfig(repoRoot);
    const workspaces = discoverWorkspaces(repoRoot);
    if (workspaces.length === 0) { readPackageJson(repoRoot); } // force the fail-closed branded error
    const ledger = readLedger(repoRoot);
    const resolver = createVersionResolver(repoRoot);
    const { violations, warnings } = await runCheckWorkspaces(workspaces, ledger, cfg, createNpmAdvisoryClient(), resolver);
    const multi = workspaces.length > 1;

    if (violations.length === 0) {
      console.log(statusHeader("success", "Dependency review passed", o));
      console.log("");
      console.log(multi ? `  All dependencies are recorded across ${workspaces.length} workspaces.` : "  All dependencies are recorded.");
      for (const w of warnings) console.log(`  - ${w}`);
      return 0;
    }

    console.error(statusHeader("blocked", "Dependency review failed", o));
    console.error("");
    for (const w of warnings) console.error(`  - ${w}`);
    renderViolations(violations, multi, (s) => console.error(s));
    console.error("");
    renderNextHint(violations, workspaces, multi, (s) => console.error(s));
    return 1;
  }

  if (cmd === "acknowledge") {
    const rest = args.slice(1);
    const ri = rest.indexOf("--reason");
    const reason = ri >= 0 ? (rest[ri + 1] ?? "") : "";
    const skip = new Set(ri >= 0 ? [ri, ri + 1] : []);
    const pkg = rest.find((a, i) => !skip.has(i) && !a.startsWith("-"));
    if (!pkg) { console.error('Usage: vouch acknowledge <package> --reason "<why>"'); return 1; }
    if (reason.trim() === "" || reason.startsWith("-")) { console.error('acknowledge requires --reason "<why>" — the risk you are knowingly accepting.'); return 1; }
    const repoRoot = findRepoRoot(cwd);
    return runAcknowledge({ pkg, reason, identity: () => gitIdentity(), client: createNpmAdvisoryClient(), now: () => new Date(), cwd, ledgerDir: repoRoot, resolver: createVersionResolver(repoRoot), log: (s) => console.log(s), err: (s) => console.error(s) });
  }

  if (cmd === "adopt") {
    const rest = args.slice(1);
    const positional = rest.find((a) => !a.startsWith("-"));
    if (positional) { console.error(`adopt takes no package argument (got "${positional}"). It baselines the whole repo.`); return 1; }
    const ri = rest.indexOf("--reason");
    const reason = ri >= 0 ? (rest[ri + 1] ?? "") : "adopted: pre-existing dependency";
    if (ri >= 0 && (reason.trim() === "" || reason.startsWith("-"))) { console.error('adopt --reason requires a non-empty reason.'); return 1; }
    const repoRoot = findRepoRoot(cwd);
    const cfg = await loadConfig(repoRoot);
    const workspaces = discoverWorkspaces(repoRoot);
    if (workspaces.length === 0) { readPackageJson(repoRoot); }
    return runAdopt({
      reason, registry: createNpmRegistryClient(), advisoryClient: createNpmAdvisoryClient(),
      identity: () => gitIdentity(), now: () => new Date(), repoRoot, cfg, workspaces,
      resolver: createVersionResolver(repoRoot), log: (s) => console.log(s), err: (s) => console.error(s),
    });
  }

  const parsed = parseAddArgs(args);
  if (parsed.error === "no-package") { console.error(helpText()); return 1; }
  if (parsed.error) { console.error(parsed.error); return 1; }
  const { spec, dev, force } = parsed;
  // spec is always defined here (the error paths above exhaust the undefined case);
  // this guard exists only for TypeScript narrowing of AddArgs.spec.
  if (!spec) { console.error(helpText()); return 1; }

  const repoRoot = findRepoRoot(cwd);
  return runSafeAdd({
    spec, dev, force,
    registry: createNpmRegistryClient(),
    installer: realInstaller(),
    advisoryClient: createNpmAdvisoryClient(),
    identity: () => gitIdentity(),
    now: () => new Date(),
    cwd, ledgerDir: repoRoot,
    log: (s) => console.log(s),
    err: (s) => console.error(s),
  });
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${realpathSync(process.argv[1])}`;
if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((e) => {
      // Fail closed, but cleanly: a malformed ledger/package.json/config should read
      // as a branded error, never a raw Node stack trace.
      const o = outputOpts();
      console.error(statusHeader("blocked", "vouch error", o));
      console.error("");
      console.error(`  ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    });
}
