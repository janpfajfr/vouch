import { execFileSync } from "node:child_process";

export type GitRunner = (args: string[]) => string;

const defaultRunner: GitRunner = (args) =>
  execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

/** "Name <email>" (or just "Name") from git config, or null if unavailable. */
export function gitIdentity(run: GitRunner = defaultRunner): string | null {
  try {
    const name = run(["config", "user.name"]).trim();
    if (!name) return null;
    const email = run(["config", "user.email"]).trim();
    return email ? `${name} <${email}>` : name;
  } catch {
    return null;
  }
}
