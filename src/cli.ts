#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { loadConfig, isAllowlisted } from "./config.js";
import { readLedger, writeLedger, upsertEntry, type LedgerEntry, type Risk, type Approval } from "./ledger.js";
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
    "vouch — a dependency-governance gate that records who vouched for each dependency.",
    "",
    "Usage:",
    '  vouch <package> [-D] [--force-with-reason "<reason>"]   Review, install, and record a dependency',
    "  vouch check                                             CI gate: fail on unreviewed deps or unacknowledged CVEs",
    '  vouch approve <package> [--approved-by "<name>"]        Record a human approver for a high-risk dependency',
    '  vouch reapprove <package> --approved-by "<name>"        Acknowledge a dependency\'s current advisories',
    "  vouch --help | --version",
    "",
    "Flags:",
    "  -D, --save-dev            Add as a devDependency",
    '  --force-with-reason "…"   Override a block, recording the reason (attribution, not authorization)',
    '  --approved-by "<name>"    Human authorization recorded in the ledger (reapprove)',
    "  --quiet                   Suppress the wordmark banner",
    "",
    "Environment:",
    "  YSNA_ADVISORY_URL         Override the npm advisory endpoint (enterprise mirrors/proxies)",
    "",
    "The approval ledger lives at .security/dependency-approvals.json and is meant to be committed.",
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
      opts.log(`note: \`check\` will block until a human acknowledges this — run: vouch reapprove ${name} --approved-by "<name>" (or upgrade to a patched version).`);
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
    approvedAt: opts.now().toISOString(),
    risk,
    reason: opts.force ?? null,
    approvedBy: null,
    checks: { ageHours: ageHours(meta.publishedAt, opts.now()), installScripts: (() => { const s = Object.fromEntries(DANGEROUS_SCRIPTS.filter(k => meta.scripts[k]).map(k => [k, meta.scripts[k]])); return Object.keys(s).length > 0 ? s : false; })() },
  };
  writeLedger(opts.cwd, upsertEntry(readLedger(opts.cwd), name, entry));
  opts.log("Decision: allowed.");
  return 0;
}

export interface ReapproveOptions {
  pkg: string;
  approvedBy: string;
  client: AdvisoryClient;
  now: () => Date;
  cwd: string;
  log: (s: string) => void;
  err: (s: string) => void;
}

export async function runReapprove(opts: ReapproveOptions): Promise<number> {
  const ledger = readLedger(opts.cwd);
  const entry = ledger[opts.pkg];
  if (!entry) { opts.err(`Not in ledger: ${opts.pkg}`); return 1; }

  const live = await opts.client.fetchBulk({ [opts.pkg]: [entry.approvedVersion] });
  if (live === null) {
    opts.err(`Could not verify advisories for ${opts.pkg} (offline or registry error); ledger unchanged.`);
    return 1;
  }

  const acknowledged = live[opts.pkg] ?? [];
  const updated = { ...entry, cve: { acknowledged, acknowledgedBy: opts.approvedBy, acknowledgedAt: opts.now().toISOString() } };
  writeLedger(opts.cwd, upsertEntry(ledger, opts.pkg, updated));
  opts.log(`Re-approved ${opts.pkg}: acknowledged ${acknowledged.length} advisor${acknowledged.length === 1 ? "y" : "ies"} (by ${opts.approvedBy}).`);
  return 0;
}

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
    const { violations, warnings } = await runCheckWithCve(pkg, readLedger(cwd), cfg, new NpmAdvisoryClient());
    for (const w of warnings) console.error(`WARN: ${w}`);
    if (violations.length === 0) { console.log("Dependency review: all dependencies are approved."); return 0; }
    for (const v of violations) console.error(`BLOCKED: ${v.package} — ${v.reason}`);
    return 1;
  }

  if (cmd === "reapprove") {
    const rest = args.slice(1);
    const ai = rest.indexOf("--approved-by");
    const approvedBy = ai >= 0 ? (rest[ai + 1] ?? "") : "";
    const skip = new Set(ai >= 0 ? [ai, ai + 1] : []);
    const pkg = rest.find((a, i) => !skip.has(i) && !a.startsWith("-"));
    if (!pkg) { console.error('Usage: vouch reapprove <package> --approved-by "<name>"'); return 1; }
    if (approvedBy.trim() === "" || approvedBy.startsWith("-")) { console.error("reapprove requires --approved-by \"<name>\" (authorization, not attribution)."); return 1; }
    return runReapprove({ pkg, approvedBy, client: new NpmAdvisoryClient(), now: () => new Date(), cwd, log: (s) => console.log(s), err: (s) => console.error(s) });
  }

  if (cmd === "approve") {
    const rest = args.slice(1);
    const ai = rest.indexOf("--approved-by");
    const approvedBy = ai >= 0 ? (rest[ai + 1] ?? "") : null;
    const skip = new Set(ai >= 0 ? [ai, ai + 1] : []);
    const pkg = rest.find((a, i) => !skip.has(i) && !a.startsWith("-"));
    if (!pkg) { console.error('Usage: vouch approve <package> [--approved-by "<name>"]'); return 1; }
    if (approvedBy !== null && (approvedBy.trim() === "" || approvedBy.startsWith("-"))) { console.error("--approved-by needs a name value."); return 1; }
    return runApprove({ pkg, approvedBy, identity: () => gitIdentity(), now: () => new Date(), cwd, log: (s) => console.log(s), err: (s) => console.error(s) });
  }

  const parsed = parseAddArgs(args);
  if (parsed.error === "no-package") { console.error(helpText()); return 1; }
  if (parsed.error) { console.error(parsed.error); return 1; }
  const { spec, dev, force } = parsed;
  if (!spec) { console.error(helpText()); return 1; }

  return runSafeAdd({
    spec, dev, force,
    registry: new NpmRegistryClient(),
    installer: realInstaller(),
    advisoryClient: new NpmAdvisoryClient(),
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
