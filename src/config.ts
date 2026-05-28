import { readFileSync } from "node:fs";
import { join } from "node:path";

export type PackageManager = "auto" | "pnpm" | "npm" | "yarn";

/** What `check` does for a version concern. "off" disables, "warn" surfaces, "block" fails CI. */
export type CheckMode = "warn" | "block" | "off";

/** Severity ranking for the npm advisory levels, low → critical. */
export const SEVERITY_RANK = ["low", "moderate", "high", "critical"] as const;
export type Severity = (typeof SEVERITY_RANK)[number];

export interface Config {
  minimumVersionAgeHours: number;
  warnVersionAgeHours: number;
  blockInstallScripts: boolean;
  requireCooldownConfigured: boolean;
  allowScopedPackages: string[];
  packageManager: PackageManager;
  versionDrift: CheckMode;
  requirePinned: CheckMode;
  /** What `vouch <pkg>` does on a known advisory at install time.
   *  "warn" (default): a note; "block": block at or above cveAtInstallMinSeverity; "off": skip. */
  cveAtInstall: CheckMode;
  /** Minimum severity that blocks when cveAtInstall is "block". Lower severities still warn. */
  cveAtInstallMinSeverity: Severity;
}

export const DEFAULT_CONFIG: Config = {
  minimumVersionAgeHours: 24,
  warnVersionAgeHours: 168,
  blockInstallScripts: true,
  requireCooldownConfigured: false,
  allowScopedPackages: [],
  packageManager: "auto",
  versionDrift: "warn",
  requirePinned: "off",
  cveAtInstall: "warn",
  cveAtInstallMinSeverity: "high",
};

export function loadConfig(cwd: string): Config {
  const path = join(cwd, ".safe-dep.json");
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return { ...DEFAULT_CONFIG };
  }
  let parsed: Partial<Config>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid .safe-dep.json: not valid JSON`);
  }
  const cfg = { ...DEFAULT_CONFIG, ...parsed };
  // Validate enum fields: a typo here (e.g. "blcok") would otherwise silently fall through
  // to a weaker mode, quietly downgrading a gate the author meant to block.
  checkEnum("versionDrift", cfg.versionDrift, CHECK_MODES);
  checkEnum("requirePinned", cfg.requirePinned, CHECK_MODES);
  checkEnum("cveAtInstall", cfg.cveAtInstall, CHECK_MODES);
  checkEnum("cveAtInstallMinSeverity", cfg.cveAtInstallMinSeverity, SEVERITY_RANK);
  checkEnum("packageManager", cfg.packageManager, PACKAGE_MANAGERS);
  return cfg;
}

const CHECK_MODES = ["warn", "block", "off"] as const;
const PACKAGE_MANAGERS = ["auto", "pnpm", "npm", "yarn"] as const;

function checkEnum(key: string, value: unknown, allowed: readonly string[]): void {
  if (!allowed.includes(value as string)) {
    throw new Error(`Invalid .safe-dep.json: "${key}" must be one of ${allowed.map((a) => `"${a}"`).join(", ")} (got ${JSON.stringify(value)})`);
  }
}

/** True if `name` matches any glob pattern in `patterns` (only `*` is special). */
export function isAllowlisted(name: string, patterns: string[]): boolean {
  return patterns.some((p) => {
    const escaped = p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(`^${escaped}$`).test(name);
  });
}
