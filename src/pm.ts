import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PackageManager } from "./config.js";

export type PM = "pnpm" | "npm" | "yarn";

export function detectPM(cwd: string, configured: PackageManager): PM {
  if (configured !== "auto") return configured;
  if (existsSync(join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(cwd, "yarn.lock"))) return "yarn";
  if (existsSync(join(cwd, "package-lock.json"))) return "npm";
  return "pnpm";
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
