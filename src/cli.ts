#!/usr/bin/env node
import { readFileSync, realpathSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { loadConfig, isAllowlisted } from "./config.js";
import { readLedger, writeLedger, upsertEntry, LEDGER_RELATIVE, type LedgerEntry, type Risk } from "./ledger.js";
import { checkVersionAge, checkInstallScripts, checkDeprecated, checkKnownCve, overallRisk, ageHours, DANGEROUS_SCRIPTS, type Finding } from "./checks.js";
import { detectPM, detectPMFromSignals, installArgs, cooldownConfigured, type PM } from "./pm.js";
import { NpmRegistryClient, PackageNotFoundError, RegistryUnavailableError, type RegistryClient } from "./registry.js";
import { runCheckWithCve } from "./check-command.js";
import { NpmAdvisoryClient, type AdvisoryClient } from "./advisories.js";
import { gitIdentity } from "./identity.js";
import { wordmark, shouldShowWordmark, statusHeader, type OutputOpts } from "./art.js";

export function parseSpec(spec: string): { name: string; version: string | undefined } {
  const at = spec.lastIndexOf("@");
  if (at > 0) return { name: spec.slice(0, at), version: spec.slice(at + 1) };
  return { name: spec, version: undefined };
}

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
    "  YSNA_ADVISORY_URL         Override the npm advisory endpoint (enterprise mirrors/proxies)",
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
  return existsSync(join(cwd, "node_modules", "vouch"));
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
    "  // CI gate — `vouch check`",
    `  versionDrift: "warn",            // "warn" | "block" | "off"`,
    `  requirePinned: "off",            // "warn" | "block" | "off"`,
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
    `import { defineConfig } from "vouch";`,
    "",
    "export default defineConfig({",
    ...settingsBlock(pm),
    "});",
  ] : [
    `/** @type {import("vouch").Config} */`,
    "export default {",
    ...settingsBlock(pm),
    "};",
  ];
  return [...header, ...body, ""].join("\n");
}

/** Bootstraps a typed vouch.config.{js,mjs} with all defaults shown + detected packageManager.
 *  If a vouch.config.* or .safe-dep.json already exists, reports and exits without overwriting —
 *  this command never clobbers an existing config. */
export function runInit(opts: InitOptions): number {
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
    opts.log(`  vouch is installed in this project — \`import { defineConfig } from "vouch"\` is wired up.`);
  } else {
    opts.log(`  vouch isn't installed locally; the config uses a JSDoc \`@type\` annotation so it loads without`);
    opts.log(`  a local install. Run \`npm install -D vouch\` to light up editor autocomplete on this file.`);
  }
  if (detectedPM) opts.log(`  Detected packageManager: "${detectedPM}"`);
  else opts.log(`  No PM signal detected; packageManager left as "auto" (falls back to npm).`);
  return 0;
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
  log: (s: string) => void;
  err: (s: string) => void;
}

export async function runSafeAdd(opts: SafeAddOptions): Promise<number> {
  const cfg = await loadConfig(opts.cwd);
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
  if (opts.advisoryClient && cfg.cveAtInstall !== "off") {
    const live = await opts.advisoryClient.fetchBulk({ [name]: [meta.version] });
    const found = live?.[name] ?? [];
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

  const pm = detectPM(opts.cwd, cfg.packageManager);
  if (cfg.requireCooldownConfigured && !cooldownConfigured(opts.cwd, pm)) {
    notes.push(`${pm} has no release-age cooldown configured.`);
  }

  const code = await opts.installer.install(pm, installArgs(pm, opts.spec, opts.dev));
  if (code !== 0) { opts.err(`Install failed (exit ${code}); ledger not written.`); return code; }

  const entry: LedgerEntry = {
    approvedVersion: meta.version,
    addedAt: opts.now().toISOString(),
    risk,
    reason: opts.force ?? null,
    addedBy: (opts.identity ?? (() => gitIdentity()))(),
    checks: { ageHours: ageHours(meta.publishedAt, opts.now()), installScripts: (() => { const s = Object.fromEntries(DANGEROUS_SCRIPTS.filter(k => meta.scripts[k]).map(k => [k, meta.scripts[k]])); return Object.keys(s).length > 0 ? s : false; })() },
  };
  writeLedger(opts.cwd, upsertEntry(readLedger(opts.cwd), name, entry));
  opts.log(statusHeader("success", "Recorded dependency decision", o));
  opts.log("");
  opts.log(`  ${id}`);
  opts.log(`  Ledger: ${LEDGER_RELATIVE}`);
  for (const n of notes) opts.log(`  - ${n}`);
  return 0;
}

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
    return runInit({ cwd, log: (s) => console.log(s), err: (s) => console.error(s) });
  }

  if (cmd === "check") {
    const cfg = await loadConfig(cwd);
    const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
    const ledger = readLedger(cwd);
    const { violations, warnings } = await runCheckWithCve(pkg, ledger, cfg, new NpmAdvisoryClient());
    if (violations.length === 0) {
      console.log(statusHeader("success", "Dependency review passed", o));
      console.log("");
      console.log("  All dependencies are recorded.");
      for (const w of warnings) console.log(`  - ${w}`);
      return 0;
    }
    console.error(statusHeader("blocked", "Dependency review failed", o));
    console.error("");
    for (const w of warnings) console.error(`  - ${w}`);
    for (const v of violations) console.error(`  - ${v.package}: ${v.reason}`);
    console.error("");
    console.error("  Next:");
    console.error("    vouch <package>");
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
    return runAcknowledge({ pkg, reason, identity: () => gitIdentity(), client: new NpmAdvisoryClient(), now: () => new Date(), cwd, log: (s) => console.log(s), err: (s) => console.error(s) });
  }

  const parsed = parseAddArgs(args);
  if (parsed.error === "no-package") { console.error(helpText()); return 1; }
  if (parsed.error) { console.error(parsed.error); return 1; }
  const { spec, dev, force } = parsed;
  // spec is always defined here (the error paths above exhaust the undefined case);
  // this guard exists only for TypeScript narrowing of AddArgs.spec.
  if (!spec) { console.error(helpText()); return 1; }

  return runSafeAdd({
    spec, dev, force,
    registry: new NpmRegistryClient(),
    installer: realInstaller(),
    advisoryClient: new NpmAdvisoryClient(),
    identity: () => gitIdentity(),
    now: () => new Date(),
    cwd,
    log: (s) => console.log(s),
    err: (s) => console.error(s),
  });
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${realpathSync(process.argv[1])}`;
if (invokedDirectly) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
