import { readFileSync } from "node:fs";
import { join } from "node:path";

export type PackageManager = "auto" | "pnpm" | "npm" | "yarn";

/** What `check` does when a recorded version no longer satisfies the package.json range. */
export type VersionDriftMode = "warn" | "block" | "off";

export interface Config {
  minimumVersionAgeHours: number;
  warnVersionAgeHours: number;
  blockInstallScripts: boolean;
  requireCooldownConfigured: boolean;
  allowScopedPackages: string[];
  packageManager: PackageManager;
  knownAlternatives: Record<string, string>;
  versionDrift: VersionDriftMode;
}

export const DEFAULT_CONFIG: Config = {
  minimumVersionAgeHours: 24,
  warnVersionAgeHours: 168,
  blockInstallScripts: true,
  requireCooldownConfigured: false,
  allowScopedPackages: [],
  packageManager: "auto",
  knownAlternatives: {},
  versionDrift: "warn",
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
  return { ...DEFAULT_CONFIG, ...parsed };
}

/** True if `name` matches any glob pattern in `patterns` (only `*` is special). */
export function isAllowlisted(name: string, patterns: string[]): boolean {
  return patterns.some((p) => {
    const escaped = p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(`^${escaped}$`).test(name);
  });
}
