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
