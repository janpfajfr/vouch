// src/installed.ts
import { realpathSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";

/** Injected fs surface — the resolver is testable with an in-memory tree. */
export interface ResolverDeps {
  realpath: (p: string) => string; // follow pnpm/yarn symlinks into the store; throws if missing
  readFile: (p: string) => string; // utf8; throws if missing
}

export interface VersionResolver {
  /** The version `name` resolves to as loaded from `workspaceDir`. null = not installed/unresolvable. */
  resolve(workspaceDir: string, name: string): string | null;
}

const PROTOCOL_RE = /^(workspace|link|file|catalog|git|github|https?):/i;

/** True for non-registry specifiers (internal/protocol ranges) — never reviewed/recorded. */
export function isProtocolRange(range: string): boolean {
  return PROTOCOL_RE.test(range.trim());
}

const defaultDeps: ResolverDeps = {
  realpath: realpathSync,
  readFile: (p) => readFileSync(p, "utf8"),
};

/** PM-agnostic resolver. Walks node_modules up from `workspaceDir` to `repoRoot`
 *  (Node's own resolution order) and reads the installed package's `version`.
 *  Pure file reads; no lockfile parsing, no subprocess. */
export function createVersionResolver(repoRoot: string, deps: ResolverDeps = defaultDeps): VersionResolver {
  return {
    resolve(workspaceDir, name) {
      let dir = workspaceDir;
      for (;;) {
        const linkPath = join(dir, "node_modules", name, "package.json"); // scoped: join keeps the "/"
        try {
          const real = deps.realpath(linkPath);          // follow pnpm .pnpm / yarn symlink
          const v = (JSON.parse(deps.readFile(real)) as { version?: unknown }).version;
          if (typeof v === "string") return v;
        } catch { /* not here — walk up */ }
        if (dir === repoRoot) return null;                // root node_modules already checked; stop
        const parent = dirname(dir);
        if (parent === dir) return null;                  // safety: hit fs root
        dir = parent;
      }
    },
  };
}
