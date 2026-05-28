import type { Config } from "./config.js";
import type { Risk } from "./ledger.js";

export type Severity = "ok" | "warn" | "block";
export interface Finding { level: Severity; message: string; }

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

export function overallRisk(findings: Finding[]): Risk {
  if (findings.some((f) => f.level === "block")) return "high";
  if (findings.some((f) => f.level === "warn")) return "medium";
  return "low";
}
