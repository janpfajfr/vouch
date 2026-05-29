import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PackageManager } from "./config.js";

export type PM = "pnpm" | "npm" | "yarn";

export function detectPM(cwd: string, configured: PackageManager): PM {
  if (configured !== "auto") return configured;
  // No signal at all (fresh repo) → npm, the Node baseline; safer than guessing pnpm.
  return detectPMFromSignals(cwd) ?? "npm";
}

/** Returns a confidently-detected PM (Corepack field or lockfile present) or null. Used by
 *  `vouch init` to decide whether to seed `packageManager` in the generated config. */
export function detectPMFromSignals(cwd: string): PM | null {
  const declared = readPackageManagerField(cwd);
  if (declared) return declared;
  if (existsSync(join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(cwd, "yarn.lock"))) return "yarn";
  if (existsSync(join(cwd, "package-lock.json"))) return "npm";
  return null;
}

function readPackageManagerField(cwd: string): PM | null {
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
    const value: unknown = pkg.packageManager;
    if (typeof value !== "string") return null;
    const name = value.split("@")[0];
    return name === "pnpm" || name === "npm" || name === "yarn" ? name : null;
  } catch {
    return null;
  }
}

export function installArgs(pm: PM, pkg: string, dev: boolean): string[] {
  const verb = pm === "npm" ? "install" : "add";
  return dev ? [verb, "-D", pkg] : [verb, pkg];
}

function fileHas(path: string, pattern: RegExp): boolean {
  try {
    return pattern.test(readFileSync(path, "utf8"));
  } catch {
    return false;
  }
}

export function cooldownConfigured(cwd: string, pm: PM): boolean {
  if (pm === "pnpm") {
    return (
      fileHas(join(cwd, "pnpm-workspace.yaml"), /minimumReleaseAge\s*:/) ||
      fileHas(join(cwd, ".npmrc"), /minimum-release-age\s*=/)
    );
  }
  if (pm === "yarn") return fileHas(join(cwd, ".yarnrc.yml"), /npmMinimalAgeGate\s*:/);
  return fileHas(join(cwd, ".npmrc"), /min-release-age\s*=/);
}
