import type { Config } from "./config.js";
import type { Ledger } from "./ledger.js";
import { detectDrift, type AdvisoryClient } from "./advisories.js";

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
        package: d.package,
        reason: `${d.package}@${version} gained ${a.id} (${a.severity}) since approval — re-approve: safe-add reapprove ${d.package} --approved-by "<you>"`,
      });
    }
  }
  return { violations, warnings };
}
