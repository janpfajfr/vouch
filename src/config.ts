import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export type PackageManager = "auto" | "pnpm" | "npm" | "yarn";

/** What `check` does for a version concern. "off" disables, "warn" surfaces, "block" fails CI. */
export type CheckMode = "warn" | "block" | "off";

/** `requirePinned` is hygiene-only now (version-aware check absorbs its safety value). */
export type PinMode = "warn" | "off";

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
  /** @deprecated `check` is always version-aware now; this key is ignored and will be
   *  removed in a future minor. Accepted (and validated) during the deprecation window. */
  versionDrift?: CheckMode;
  /** Hygiene-only pin warning. "warn" surfaces unpinned recorded deps; "off" disables. */
  requirePinned: PinMode;
  /** Also gate peerDependencies in `vouch check`. Off by default: peers are usually
   *  host-provided contracts (a library declaring its required React, say), so gating
   *  them can create friction. optionalDependencies are always gated (they install). */
  checkPeerDependencies: boolean;
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
  requirePinned: "off",
  checkPeerDependencies: false,
  cveAtInstall: "warn",
  cveAtInstallMinSeverity: "high",
};

/** File names tried in order. The first one that exists wins; .safe-dep.json is the
 *  legacy fallback so existing repos keep working. */
export const CONFIG_CANDIDATES = [
  "vouch.config.ts",
  "vouch.config.mts",
  "vouch.config.mjs",
  "vouch.config.js",
  "vouch.config.cjs",
] as const;

export const LEGACY_JSON_CONFIG = ".safe-dep.json" as const;

export async function loadConfig(cwd: string): Promise<Config> {
  for (const name of CONFIG_CANDIDATES) {
    const filepath = join(cwd, name);
    if (!existsSync(filepath)) continue;
    let mod: { default?: unknown } & Record<string, unknown>;
    try {
      mod = await import(pathToFileURL(filepath).href);
    } catch (e) {
      const msg = (e as Error).message;
      if (/Cannot find package '@vouchjs\/vouch'/.test(msg)) {
        throw new Error(`Failed to load ${name}: vouch isn't installed in this project, so \`import { defineConfig } from "@vouchjs/vouch"\` can't resolve. Either:\n  - npm install -D @vouchjs/vouch  (then the import resolves, full editor types), or\n  - remove the import and use the JSDoc-typed plain export instead (delete ${name} and run \`vouch init\` again — it writes the no-import variant when vouch isn't installed).`);
      }
      if (name.endsWith(".ts") || name.endsWith(".mts")) {
        throw new Error(`Failed to load ${name}: Node ${process.version} can't load TypeScript natively. Use Node 23+ (or 22.6+ with --experimental-strip-types), or rename to .mjs/.js. Original: ${msg}`);
      }
      throw new Error(`Failed to load ${name}: ${msg}`);
    }
    if (mod.default === undefined || mod.default === null || typeof mod.default !== "object") {
      throw new Error(`Invalid ${name}: expected a default-exported config object (e.g. \`export default defineConfig({ ... })\`)`);
    }
    return mergeAndValidate(mod.default as Partial<Config>, name);
  }
  // Legacy JSON fallback.
  const jsonPath = join(cwd, LEGACY_JSON_CONFIG);
  if (!existsSync(jsonPath)) return { ...DEFAULT_CONFIG };
  let parsed: Partial<Config>;
  try {
    parsed = JSON.parse(readFileSync(jsonPath, "utf8"));
  } catch {
    throw new Error(`Invalid ${LEGACY_JSON_CONFIG}: not valid JSON`);
  }
  return mergeAndValidate(parsed, LEGACY_JSON_CONFIG);
}

function mergeAndValidate(parsed: Partial<Config>, source: string): Config {
  const { $schema: _ignored, ...rest } = parsed as Partial<Config> & { $schema?: unknown };
  const cfg = { ...DEFAULT_CONFIG, ...rest };
  // versionDrift is deprecated but still validated so a typo errors rather than silently
  // downgrading; only checked when the author actually set it.
  if (cfg.versionDrift !== undefined) checkEnum(source, "versionDrift", cfg.versionDrift, CHECK_MODES);
  // requirePinned no longer supports "block" — version-aware check makes it non-load-bearing.
  if ((cfg.requirePinned as string) === "block") {
    throw new Error(`Invalid ${source}: "requirePinned" no longer supports "block" — version-aware check makes pinning non-load-bearing for safety. Use "warn" or "off".`);
  }
  checkEnum(source, "requirePinned", cfg.requirePinned, PIN_MODES);
  checkEnum(source, "cveAtInstall", cfg.cveAtInstall, CHECK_MODES);
  checkEnum(source, "cveAtInstallMinSeverity", cfg.cveAtInstallMinSeverity, SEVERITY_RANK);
  checkEnum(source, "packageManager", cfg.packageManager, PACKAGE_MANAGERS);
  return cfg;
}

const CHECK_MODES = ["warn", "block", "off"] as const;
const PIN_MODES = ["warn", "off"] as const;
const PACKAGE_MANAGERS = ["auto", "pnpm", "npm", "yarn"] as const;

function checkEnum(source: string, key: string, value: unknown, allowed: readonly string[]): void {
  if (!allowed.includes(value as string)) {
    throw new Error(`Invalid ${source}: "${key}" must be one of ${allowed.map((a) => `"${a}"`).join(", ")} (got ${JSON.stringify(value)})`);
  }
}

/** True if `name` matches any glob pattern in `patterns` (only `*` is special). */
export function isAllowlisted(name: string, patterns: string[]): boolean {
  return patterns.some((p) => {
    const escaped = p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(`^${escaped}$`).test(name);
  });
}
