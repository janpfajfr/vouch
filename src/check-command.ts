// src/check-command.ts
import type { Config } from "./config.js";
import type { Ledger } from "./ledger.js";
import { detectDrift, type AdvisoryClient, type DriftKind } from "./advisories.js";
import { isExactPin } from "./semver.js";
import { ledgerKey } from "./spec.js";
import { isProtocolRange, type VersionResolver } from "./installed.js";
import type { WorkspacePackage } from "./workspaces.js";

export interface PackageJsonLike {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

export interface CheckViolation { package: string; reason: string; workspace?: string; }

/** Direct dependencies as a name → range map — the single place that enumerates
 *  package.json deps, so every check sees the same set. Prod, dev, and optional always;
 *  peerDependencies only when cfg.checkPeerDependencies is set. */
export function directDeps(pkg: PackageJsonLike, cfg?: { checkPeerDependencies: boolean }): Record<string, string> {
  return {
    ...pkg.dependencies,
    ...pkg.devDependencies,
    ...pkg.optionalDependencies,
    ...(cfg?.checkPeerDependencies ? pkg.peerDependencies : {}),
  };
}

/** Version-aware check for a single package. Resolves each declared dep's installed
 *  version (skipping protocol ranges) and looks up `name@version` in the ledger. */
export function checkPackage(
  pkg: PackageJsonLike,
  workspaceDir: string,
  relPath: string,
  ledger: Ledger,
  resolver: VersionResolver,
  cfg: Config,
): CheckViolation[] {
  const violations: CheckViolation[] = [];
  for (const [name, range] of Object.entries(directDeps(pkg, cfg))) {
    if (isProtocolRange(range)) continue; // internal/non-registry edge — not reviewed
    const installed = resolver.resolve(workspaceDir, name);
    if (installed === null) {
      violations.push({ workspace: relPath, package: name, reason: "declared but not installed — run your package manager's install." });
      continue;
    }
    const entry = ledger[ledgerKey(name, installed)];
    if (!entry) {
      violations.push({ workspace: relPath, package: `${name}@${installed}`, reason: `this exact version was never reviewed — vouch ${name}@${installed}` });
      continue;
    }
    if (entry.risk === "high" && (!entry.reason || entry.reason.trim() === "")) {
      violations.push({ workspace: relPath, package: `${name}@${installed}`, reason: "high-risk decision needs a reason in the ledger so a reviewer can judge it." });
    }
  }
  return violations;
}

/** Single-package check (cwd). Plan 2 adds a workspace-aware aggregator over checkPackage. */
export function runCheck(pkg: PackageJsonLike, workspaceDir: string, ledger: Ledger, resolver: VersionResolver, cfg: Config): CheckViolation[] {
  return checkPackage(pkg, workspaceDir, ".", ledger, resolver, cfg);
}

export interface Unpinned { package: string; range: string; recorded: string; workspace?: string; }

/** Recorded direct deps whose package.json range is not an exact pin. Skips protocol
 *  ranges (never exact pins) and unrecorded/uninstalled deps. */
export function detectUnpinned(
  pkg: PackageJsonLike,
  workspaceDir: string,
  relPath: string,
  ledger: Ledger,
  resolver: VersionResolver,
  cfg: Config,
): Unpinned[] {
  const out: Unpinned[] = [];
  for (const [name, range] of Object.entries(directDeps(pkg, cfg))) {
    if (isProtocolRange(range)) continue;
    const installed = resolver.resolve(workspaceDir, name);
    if (installed === null) continue;
    if (!ledger[ledgerKey(name, installed)]) continue; // unrecorded is already a violation
    if (!isExactPin(range)) out.push({ workspace: relPath, package: name, range, recorded: installed });
  }
  return out;
}

export function unpinnedMessage(u: Unpinned): string {
  return `not pinned: package.json uses "${u.range}" — pin it to the recorded version so check tracks exactly what was reviewed: set "${u.package}": "${u.recorded}".`;
}

export async function runCheckWithCve(
  pkg: PackageJsonLike,
  workspaceDir: string,
  ledger: Ledger,
  cfg: Config,
  client: AdvisoryClient,
  resolver: VersionResolver,
): Promise<{ violations: CheckViolation[]; warnings: string[] }> {
  const violations = runCheck(pkg, workspaceDir, ledger, resolver, cfg);
  const warnings: string[] = [];

  if (cfg.versionDrift !== undefined && cfg.versionDrift !== "off") {
    warnings.push("versionDrift is no longer used — check is always version-aware now (the config key is ignored and will be removed in a future release).");
  }

  if (cfg.requirePinned !== "off") {
    for (const u of detectUnpinned(pkg, workspaceDir, ".", ledger, resolver, cfg)) {
      warnings.push(`${u.package} — ${unpinnedMessage(u)}`);
    }
  }

  // Installed-version map for both the CVE query and drift keying. NOTE: this re-resolves
  // versions already resolved in runCheck/checkPackage — fine for single-package; if it shows
  // up under Plan 2's per-workspace fan-out, memoize the resolver by (workspaceDir, name) per
  // run (spec §14).
  const installed: Record<string, string> = {};
  for (const [name, range] of Object.entries(directDeps(pkg, cfg))) {
    if (isProtocolRange(range)) continue;
    const v = resolver.resolve(workspaceDir, name);
    if (v !== null) installed[name] = v;
  }
  const pkgVersions: Record<string, string[]> = {};
  for (const [name, v] of Object.entries(installed)) pkgVersions[name] = [v];

  const live = await client.fetchBulk(pkgVersions);
  if (live === null) {
    if (Object.keys(pkgVersions).length > 0) {
      warnings.push("Could not verify advisories (offline or registry error); CVE drift was not checked.");
    }
    return { violations, warnings };
  }

  for (const d of detectDrift(ledger, live, installed)) {
    const version = installed[d.package] ?? "?";
    for (const a of d.newAdvisories) {
      violations.push({ package: `${d.package}@${version}`, reason: cveDriftMessage(d.package, a.id, a.severity, a.kind) });
    }
  }
  return { violations, warnings };
}

/** The three honest paths, rendered as a block so CI output is actionable.
 *  `kind` shapes the opening line: an advisory present when recorded vs genuine drift. */
export function cveDriftMessage(pkg: string, id: string, severity: string, kind: DriftKind): string {
  const headline = kind === "new-since-record"
    ? `${id} (${severity}) — NEW advisory since it was recorded.`
    : `${id} (${severity}) — known when recorded, not yet acknowledged.`;
  return [
    headline,
    "",
    "  Options:",
    `  1. Fix:     vouch ${pkg}@<patched-version>`,
    `  2. Remove:  remove ${pkg} from package.json`,
    `  3. Accept:  vouch acknowledge ${pkg} --reason "<why this is acceptable>"`,
  ].join("\n");
}

/** Workspace-aware check: fan `checkPackage` over every workspace, run one combined CVE
 *  pass over the union of installed versions, and attribute each finding to its workspace.
 *  Reuses the single-package primitives unchanged. */
export async function runCheckWorkspaces(
  workspaces: WorkspacePackage[],
  ledger: Ledger,
  cfg: Config,
  client: AdvisoryClient,
  resolver: VersionResolver,
): Promise<{ violations: CheckViolation[]; warnings: string[] }> {
  const violations: CheckViolation[] = [];
  const warnings: string[] = [];

  if (cfg.versionDrift !== undefined && cfg.versionDrift !== "off") {
    warnings.push("versionDrift is no longer used — check is always version-aware now (the config key is ignored and will be removed in a future release).");
  }

  const unionVersions: Record<string, Set<string>> = {};
  const perWs: Array<{ relPath: string; installed: Record<string, string> }> = [];

  for (const w of workspaces) {
    violations.push(...checkPackage(w.pkg, w.dir, w.relPath, ledger, resolver, cfg));
    const installed: Record<string, string> = {};
    for (const [name, range] of Object.entries(directDeps(w.pkg, cfg))) {
      if (isProtocolRange(range)) continue;
      const v = resolver.resolve(w.dir, name);
      if (v !== null) { installed[name] = v; (unionVersions[name] ??= new Set()).add(v); }
    }
    perWs.push({ relPath: w.relPath, installed });
    if (cfg.requirePinned !== "off") {
      const prefix = w.relPath === "." ? "" : `(${w.relPath}) `;
      for (const u of detectUnpinned(w.pkg, w.dir, w.relPath, ledger, resolver, cfg)) {
        warnings.push(`${prefix}${u.package} — ${unpinnedMessage(u)}`);
      }
    }
  }

  const pkgVersions: Record<string, string[]> = {};
  for (const [name, set] of Object.entries(unionVersions)) pkgVersions[name] = [...set];

  const live = await client.fetchBulk(pkgVersions);
  if (live === null) {
    if (Object.keys(pkgVersions).length > 0) warnings.push("Could not verify advisories (offline or registry error); CVE drift was not checked.");
    return { violations, warnings };
  }

  const seenDrift = new Set<string>();
  for (const { relPath, installed } of perWs) {
    for (const d of detectDrift(ledger, live, installed)) {
      const version = installed[d.package];
      for (const a of d.newAdvisories) {
        const dedupKey = `${d.package}@${version}::${a.id}`;
        if (seenDrift.has(dedupKey)) continue;
        seenDrift.add(dedupKey);
        violations.push({ workspace: relPath, package: `${d.package}@${version}`, reason: cveDriftMessage(d.package, a.id, a.severity, a.kind) });
      }
    }
  }
  return { violations, warnings };
}
