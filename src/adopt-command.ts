// src/adopt-command.ts
import type { Config } from "./config.js";
import { readLedger, writeLedger, upsertEntry, type Ledger, type LedgerEntry, type Risk } from "./ledger.js";
import { ledgerKey } from "./spec.js";
import { directDeps } from "./check-command.js";
import { isProtocolRange, type VersionResolver } from "./installed.js";
import type { WorkspacePackage } from "./workspaces.js";
import { checkVersionAge, checkInstallScripts, checkDeprecated, overallRisk, ageHours, DANGEROUS_SCRIPTS, type Finding } from "./checks.js";
import type { RegistryClient } from "./registry.js";
import type { AdvisoryClient, Advisory as AdvisoryRef } from "./advisories.js";

export interface AdoptOptions {
  reason: string;
  registry: RegistryClient;
  advisoryClient?: AdvisoryClient;
  identity: () => string | null;
  now: () => Date;
  repoRoot: string;
  cfg: Config;
  workspaces: WorkspacePackage[];
  resolver: VersionResolver;
  log: (s: string) => void;
  err: (s: string) => void;
  concurrency?: number;
}

interface Candidate { name: string; version: string; }

/** Run each item through `fn` with at most `limit` in flight (hand-rolled, zero deps). */
async function pool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) { const i = next++; results[i] = await fn(items[i]); }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, worker));
  return results;
}

/** Distinct unrecorded `name@installed` across all workspaces (for the init nudge). */
export function countUnrecorded(
  workspaces: WorkspacePackage[], ledger: Ledger, resolver: VersionResolver, cfg: Config,
): { count: number; workspaceCount: number } {
  const unrecorded = new Set<string>();
  for (const w of workspaces) {
    for (const [name, range] of Object.entries(directDeps(w.pkg, cfg))) {
      if (isProtocolRange(range)) continue;
      const v = resolver.resolve(w.dir, name);
      if (v === null) continue;
      const key = ledgerKey(name, v);
      if (!ledger[key]) unrecorded.add(key);
    }
  }
  // workspaceCount = total workspaces scanned (used for the init nudge's "across N workspaces" phrasing).
  return { count: unrecorded.size, workspaceCount: workspaces.length };
}

export async function runAdopt(opts: AdoptOptions): Promise<number> {
  const ledger = readLedger(opts.repoRoot);
  const now = opts.now();

  const candidates = new Map<string, Candidate>(); // key = name@version
  const skipped: Array<{ relPath: string; name: string }> = [];
  for (const w of opts.workspaces) {
    for (const [name, range] of Object.entries(directDeps(w.pkg, opts.cfg))) {
      if (isProtocolRange(range)) continue;
      const version = opts.resolver.resolve(w.dir, name);
      if (version === null) { skipped.push({ relPath: w.relPath, name }); continue; }
      const key = ledgerKey(name, version);
      if (ledger[key]) continue;            // already recorded — never clobber
      if (!candidates.has(key)) candidates.set(key, { name, version });
    }
  }

  const addedBy = opts.identity();
  const list = [...candidates.values()];

  // One bulk advisory fetch for all candidates, used both to baseline each entry
  // (checks.advisories) and for the summary count. null = offline/unconfigured →
  // no baseline recorded (entries omit the field; check treats them as legacy).
  let liveByName: Record<string, AdvisoryRef[]> | null = null;
  if (opts.advisoryClient) {
    const pkgVersions: Record<string, string[]> = {};
    for (const c of list) (pkgVersions[c.name] ??= []).push(c.version);
    liveByName = await opts.advisoryClient.fetchBulk(pkgVersions);
  }

  const built = await pool(list, opts.concurrency ?? 8, async (c): Promise<{ entry: LedgerEntry } | null> => {
    let meta;
    try {
      meta = await opts.registry.fetchMetadata(c.name, c.version);
    } catch (e) {
      opts.err(`Skipped ${c.name}@${c.version}: ${(e as Error).message}`);
      return null;
    }
    const findings: Finding[] = [
      checkVersionAge(meta.publishedAt, now, opts.cfg),
      checkInstallScripts(meta.scripts, opts.cfg),
      checkDeprecated(meta.deprecated),
    ];
    const risk: Risk = overallRisk(findings);
    const installScripts = (() => {
      const s = Object.fromEntries(DANGEROUS_SCRIPTS.filter((k) => meta.scripts[k]).map((k) => [k, meta.scripts[k]]));
      return Object.keys(s).length > 0 ? s : false as const;
    })();
    const checks: LedgerEntry["checks"] = { ageHours: ageHours(meta.publishedAt, now), installScripts };
    if (liveByName !== null) checks.advisories = liveByName[c.name] ?? [];
    const entry: LedgerEntry = {
      name: c.name, version: c.version, addedAt: now.toISOString(), risk,
      reason: opts.reason, addedBy, checks,
    };
    return { entry };
  });

  let merged = ledger;
  let highRisk = 0;
  const recorded: Array<{ name: string; version: string }> = [];
  for (const r of built) {
    if (!r) continue;
    merged = upsertEntry(merged, r.entry.name, r.entry.version, r.entry);
    if (r.entry.risk === "high") highRisk++;
    recorded.push({ name: r.entry.name, version: r.entry.version });
  }
  if (recorded.length > 0) writeLedger(opts.repoRoot, merged);

  // Summary count reuses the same fetch: packages (by name) with at least one advisory.
  let advisoryCount: number | null = null;
  if (liveByName !== null && recorded.length > 0) {
    const recordedNames = new Set(recorded.map((r) => r.name));
    advisoryCount = Object.entries(liveByName).filter(([name, a]) => recordedNames.has(name) && a.length > 0).length;
  }

  printSummary(opts, recorded.length, highRisk, skipped, advisoryCount);
  return 0;
}

function printSummary(
  opts: AdoptOptions, recorded: number, highRisk: number,
  skipped: Array<{ relPath: string; name: string }>, advisoryCount: number | null,
): void {
  const wsCount = opts.workspaces.length;
  const wsSuffix = wsCount > 1 ? ` across ${wsCount} workspaces` : "";
  opts.log(`Adopted ${recorded} dependenc${recorded === 1 ? "y" : "ies"}${wsSuffix}`);
  opts.log("");
  opts.log(`  Recorded ${recorded}${highRisk > 0 ? ` (${highRisk} high-risk)` : ""}.`);
  if (skipped.length > 0) {
    const list = skipped.map((s) => (wsCount > 1 ? `${s.relPath} ${s.name}` : s.name)).join(", ");
    opts.log(`  Skipped ${skipped.length} (declared but not installed): ${list}.`);
  }
  if (advisoryCount !== null && advisoryCount > 0) {
    opts.log(`  ${advisoryCount} ha${advisoryCount === 1 ? "s" : "ve"} a known advisory — run \`vouch check\` to surface them.`);
  }
}
