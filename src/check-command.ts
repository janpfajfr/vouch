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
