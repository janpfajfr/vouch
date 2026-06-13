import type { Config } from "./config.js";
import { SEVERITY_RANK, type Severity as CveSeverity } from "./config.js";
import type { Risk } from "./ledger.js";
import type { Advisory } from "./advisories.js";

export type Severity = "ok" | "warn" | "block";
export interface Finding { level: Severity; message: string; }

function sevRank(s: CveSeverity): number { return SEVERITY_RANK.indexOf(s); }

export const DANGEROUS_SCRIPTS = [
  "preinstall", "install", "postinstall", "prepare", "prepublish", "prepublishOnly",
] as const;

export function ageHours(publishedAt: Date | null, now: Date): number | null {
  if (!publishedAt) return null;
  return (now.getTime() - publishedAt.getTime()) / 3600_000;
}

export function checkVersionAge(publishedAt: Date | null, now: Date, cfg: Config): Finding {
  const h = ageHours(publishedAt, now);
  if (h === null) return { level: "warn", message: "Publish date unknown; cannot verify version age." };
  if (h < cfg.minimumVersionAgeHours) return { level: "block", message: `Version published only ${h.toFixed(1)}h ago (min ${cfg.minimumVersionAgeHours}h).` };
  if (h < cfg.warnVersionAgeHours) return { level: "warn", message: `Version is ${(h / 24).toFixed(1)} days old (warn under ${(cfg.warnVersionAgeHours / 24).toFixed(0)} days).` };
  return { level: "ok", message: `Version is ${(h / 24).toFixed(0)} days old.` };
}

export function checkInstallScripts(scripts: Record<string, string>, cfg: Config): Finding {
  const found = DANGEROUS_SCRIPTS.filter((s) => scripts[s]);
  if (found.length === 0) return { level: "ok", message: "No install-time scripts." };
  const level: Severity = cfg.blockInstallScripts ? "block" : "warn";
  return { level, message: `install-time script${found.length > 1 ? "s" : ""} detected: ${found.join(", ")}` };
}

export function checkDeprecated(deprecated: boolean): Finding {
  if (!deprecated) return { level: "ok", message: "Not deprecated." };
  return { level: "warn", message: "package is marked deprecated by its publisher" };
}

/** Turn a known-CVE list into a finding shaped by cveAtInstall + cveAtInstallMinSeverity.
 *  "off" or empty → ok. "warn" → warn for any. "block" → block iff any advisory ≥ threshold;
 *  below-threshold advisories still warn. */
export function checkKnownCve(pkg: string, found: Advisory[], cfg: Config): Finding {
  if (cfg.cveAtInstall === "off" || found.length === 0) return { level: "ok", message: "No known advisories." };
  const list = found.map((a) => `${a.id} (${a.severity})`).join(", ");
  const noun = found.length === 1 ? "advisory" : "advisories";
  if (cfg.cveAtInstall === "block") {
    const maxSev = found.reduce<CveSeverity>((m, a) => sevRank(a.severity) > sevRank(m) ? a.severity : m, "low");
    if (sevRank(maxSev) >= sevRank(cfg.cveAtInstallMinSeverity)) {
      return { level: "block", message: `known ${maxSev}-severity ${noun}: ${list}` };
    }
  }
  return { level: "warn", message: `known ${noun}: ${list} — \`check\` will block until acknowledged: vouch acknowledge ${pkg} --reason "<why>".` };
}

/** Gate on the packument-confirmed attestation fact. "off" → null (no finding, risk
 *  unaffected — mirrors cveAtInstall "off" skipping the advisory finding entirely). */
export function checkProvenance(attested: boolean, cfg: Config): Finding | null {
  if (cfg.requireProvenance === "off") return null;
  if (attested) return { level: "ok", message: "npm provenance attestation found." };
  const level: Severity = cfg.requireProvenance === "block" ? "block" : "warn";
  return { level, message: "no provenance attestation — version was not published with npm provenance." };
}

export function overallRisk(findings: Finding[]): Risk {
  if (findings.some((f) => f.level === "block")) return "high";
  if (findings.some((f) => f.level === "warn")) return "medium";
  return "low";
}
