import { readFileSync } from "node:fs";
import { join } from "node:path";

export type PackageManager = "auto" | "pnpm" | "npm" | "yarn";

export interface ApprovalConfig {
  verify: "off" | "github-review";
  requireVerifiedApproval: boolean;
  allowedApprovers: string[];
}

export interface Config {
  minimumVersionAgeHours: number;
  warnVersionAgeHours: number;
  blockInstallScripts: boolean;
  requireApprovalForHighRisk: boolean;
  requireCooldownConfigured: boolean;
  allowScopedPackages: string[];
  packageManager: PackageManager;
  knownAlternatives: Record<string, string>;
  approval: ApprovalConfig;
}

export const DEFAULT_CONFIG: Config = {
  minimumVersionAgeHours: 24,
  warnVersionAgeHours: 168,
  blockInstallScripts: true,
  requireApprovalForHighRisk: true,
  requireCooldownConfigured: false,
  allowScopedPackages: [],
  packageManager: "auto",
  knownAlternatives: {},
  approval: { verify: "off", requireVerifiedApproval: false, allowedApprovers: [] },
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
  // Deep-merge the nested approval block so a partial override keeps the other defaults.
  return { ...DEFAULT_CONFIG, ...parsed, approval: { ...DEFAULT_CONFIG.approval, ...(parsed.approval ?? {}) } };
}

/** True if `name` matches any glob pattern in `patterns` (only `*` is special). */
export function isAllowlisted(name: string, patterns: string[]): boolean {
  return patterns.some((p) => {
    const escaped = p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(`^${escaped}$`).test(name);
  });
}
