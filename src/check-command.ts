import type { Config } from "./config.js";
import { approverOf, type Ledger } from "./ledger.js";
import { detectDrift, type AdvisoryClient } from "./advisories.js";
import { permittedApprover, type ReviewClient } from "./review.js";

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
      violations.push({ package: name, reason: "no ledger entry — was it added without vouch?" });
      continue;
    }
    if (entry.risk === "high") {
      if (!entry.reason || entry.reason.trim() === "") {
        violations.push({ package: name, reason: "high-risk entry missing a reason." });
      }
      if (cfg.requireApprovalForHighRisk && !approverOf(entry)) {
        violations.push({ package: name, reason: "high-risk entry needs a human approver (run: vouch approve " + name + ")." });
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
        reason: `${d.package}@${version} gained ${a.id} (${a.severity}) since approval — re-approve: vouch reapprove ${d.package} --approved-by "<you>"`,
      });
    }
  }
  return { violations, warnings };
}

/** Verifies that high-risk approvals are backed by a permitted PR reviewer.
 *  Fail-open: when verification cannot run, warns and never fails unless
 *  requireVerifiedApproval is set. Live only — never writes the ledger. */
export async function verifyApprovals(
  ledger: Ledger, cfg: Config, client: ReviewClient,
): Promise<{ violations: CheckViolation[]; warnings: string[] }> {
  const violations: CheckViolation[] = [];
  const warnings: string[] = [];
  if (cfg.approval.verify !== "github-review") return { violations, warnings };

  const needsAuth = Object.values(ledger).some((e) => e.risk === "high" && approverOf(e));
  if (!needsAuth) return { violations, warnings };

  const reviewers = await client.approvingReviewers();
  if (reviewers === null) {
    warnings.push("Could not verify approval (no PR context or GitHub token); approvals are unverified.");
    return { violations, warnings };
  }
  if (permittedApprover(reviewers, cfg.approval.allowedApprovers)) return { violations, warnings };

  const msg = "no permitted GitHub reviewer approved this PR; high-risk approvals are unverified.";
  if (cfg.approval.requireVerifiedApproval) violations.push({ package: "(approvals)", reason: msg });
  else warnings.push(msg);
  return { violations, warnings };
}
