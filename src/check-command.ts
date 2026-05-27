import type { Config } from "./config.js";
import type { Ledger } from "./ledger.js";
import { detectDrift, type AdvisoryClient } from "./advisories.js";
import { satisfiesRange, isExactPin } from "./semver.js";

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
      violations.push({ package: name, reason: "missing ledger entry" });
      continue;
    }
    if (entry.risk === "high" && (!entry.reason || entry.reason.trim() === "")) {
      violations.push({ package: name, reason: "high-risk decision needs a reason in the ledger so a reviewer can judge it." });
    }
  }
  return violations;
}

export interface VersionDrift { package: string; recorded: string; range: string; }

/** Direct deps whose recorded version no longer satisfies the package.json range.
 *  Compares against package.json ranges only (no lockfile). Unparseable ranges are
 *  skipped (satisfiesRange returns null) so they never produce a false drift. */
export function detectVersionDrift(pkg: PackageJsonLike, ledger: Ledger): VersionDrift[] {
  const ranges = { ...pkg.dependencies, ...pkg.devDependencies };
  const drift: VersionDrift[] = [];
  for (const [name, range] of Object.entries(ranges)) {
    const entry = ledger[name];
    if (!entry) continue; // unrecorded is already a violation in runCheck
    if (satisfiesRange(entry.approvedVersion, range) === false) {
      drift.push({ package: name, recorded: entry.approvedVersion, range });
    }
  }
  return drift;
}

export function versionDriftMessage(d: VersionDrift): string {
  return `recorded at ${d.recorded}, but package.json now requires "${d.range}" — re-record the version a human reviewed: vouch ${d.package}@${d.recorded} (or vouch ${d.package} for the latest).`;
}

export interface Unpinned { package: string; range: string; recorded: string; }

/** Recorded direct deps whose package.json range is not an exact pin.
 *  Skips unrecorded deps (already a violation in runCheck). */
export function detectUnpinned(pkg: PackageJsonLike, ledger: Ledger): Unpinned[] {
  const ranges = { ...pkg.dependencies, ...pkg.devDependencies };
  const out: Unpinned[] = [];
  for (const [name, range] of Object.entries(ranges)) {
    const entry = ledger[name];
    if (!entry) continue;
    if (!isExactPin(range)) out.push({ package: name, range, recorded: entry.approvedVersion });
  }
  return out;
}

export function unpinnedMessage(u: Unpinned): string {
  return `not pinned: package.json uses "${u.range}" — pin it to the recorded version so check tracks exactly what was reviewed: set "${u.package}": "${u.recorded}".`;
}

export async function runCheckWithCve(
  pkg: PackageJsonLike,
  ledger: Ledger,
  cfg: Config,
  client: AdvisoryClient,
): Promise<{ violations: CheckViolation[]; warnings: string[] }> {
  const violations = runCheck(pkg, ledger, cfg);
  const warnings: string[] = [];

  if (cfg.versionDrift !== "off") {
    for (const d of detectVersionDrift(pkg, ledger)) {
      if (cfg.versionDrift === "block") violations.push({ package: d.package, reason: versionDriftMessage(d) });
      else warnings.push(`${d.package} — ${versionDriftMessage(d)}`);
    }
  }

  if (cfg.requirePinned !== "off") {
    for (const u of detectUnpinned(pkg, ledger)) {
      if (cfg.requirePinned === "block") violations.push({ package: u.package, reason: unpinnedMessage(u) });
      else warnings.push(`${u.package} — ${unpinnedMessage(u)}`);
    }
  }

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
