#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { loadConfig, isAllowlisted } from "./config.js";
import { readLedger, writeLedger, upsertEntry, type LedgerEntry, type Risk } from "./ledger.js";
import { checkVersionAge, checkInstallScripts, overallRisk, ageHours, DANGEROUS_SCRIPTS, type Finding } from "./checks.js";
import { findAlternatives } from "./alternatives.js";
import { detectPM, installArgs, cooldownConfigured, type PM } from "./pm.js";
import { NpmRegistryClient, PackageNotFoundError, RegistryUnavailableError, type RegistryClient } from "./registry.js";
import { runCheckWithCve } from "./check-command.js";
import { NpmAdvisoryClient, type AdvisoryClient } from "./advisories.js";
import { gitIdentity } from "./identity.js";
import { wordmark, blockBanner, shouldShowWordmark, type OutputOpts } from "./art.js";

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

function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
    return `vouch ${pkg.version}`;
  } catch {
    return "vouch (unknown version)";
  }
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
  advisoryClient?: AdvisoryClient;
  identity?: () => string | null;
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

  const allowlisted = isAllowlisted(name, cfg.allowScopedPackages);

  let risk: Risk = "low";
  let blocked = false;
  if (allowlisted) {
    opts.log(`note: "${name}" matches allowScopedPackages; skipping risk gate.`);
  } else {
    const findings: Finding[] = [
      checkVersionAge(meta.publishedAt, opts.now(), cfg),
      checkInstallScripts(meta.scripts, cfg),
    ];
    for (const f of findings) if (f.level !== "ok") opts.log(`${f.level.toUpperCase()}: ${f.message}`);
    risk = overallRisk(findings);
    blocked = findings.some((f) => f.level === "block");
  }

  // Surface known advisories at install time so `check` is never the first messenger.
  // Informational only (warn, not block) and fail-open: an unreachable service is silent.
  if (opts.advisoryClient) {
    const live = await opts.advisoryClient.fetchBulk({ [name]: [meta.version] });
    const found = live?.[name] ?? [];
    if (found.length > 0) {
      const list = found.map((a) => `${a.id} (${a.severity})`).join(", ");
      opts.log(`WARN: ${name}@${meta.version} has known ${found.length === 1 ? "advisory" : "advisories"}: ${list}.`);
      opts.log(`note: \`check\` will block until a human acknowledges this — run: vouch acknowledge ${name} --reason "<why>" (or upgrade to a patched version).`);
    }
  }

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
    addedAt: opts.now().toISOString(),
    risk,
    reason: opts.force ?? null,
    addedBy: (opts.identity ?? (() => gitIdentity()))(),
    checks: { ageHours: ageHours(meta.publishedAt, opts.now()), installScripts: (() => { const s = Object.fromEntries(DANGEROUS_SCRIPTS.filter(k => meta.scripts[k]).map(k => [k, meta.scripts[k]])); return Object.keys(s).length > 0 ? s : false; })() },
  };
  writeLedger(opts.cwd, upsertEntry(readLedger(opts.cwd), name, entry));
  opts.log("Decision: allowed.");
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
  if (shouldShowWordmark(o)) process.stdout.write(wordmark(o) + "\n");

  const args = argv.filter((a) => a !== "--quiet");
  const cmd = args[0];

  if (cmd === "--version" || cmd === "-V") { console.log(readVersion()); return 0; }
  if (cmd === "help" || cmd === "--help" || cmd === "-h") { console.log(helpText()); return 0; }

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
