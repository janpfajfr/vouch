// src/installed.ts
import { realpathSync, readFileSync } from "node:fs";
import { join, dirname, relative, sep } from "node:path";

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

/** Walk node_modules up from workspaceDir to repoRoot; first installed package.json#version wins. */
function walkNodeModules(repoRoot: string, workspaceDir: string, name: string, deps: ResolverDeps): string | null {
  let dir = workspaceDir;
  for (;;) {
    const linkPath = join(dir, "node_modules", name, "package.json"); // scoped: join keeps the "/"
    try {
      const real = deps.realpath(linkPath);
      const v = (JSON.parse(deps.readFile(real)) as { version?: unknown }).version;
      if (typeof v === "string") return v;
    } catch { /* not here — walk up */ }
    if (dir === repoRoot) return null;        // root node_modules already checked; stop
    const parent = dirname(dir);
    if (parent === dir) return null;          // safety: hit fs root
    dir = parent;
  }
}

function unquote(s: string): string {
  return s.replace(/^['"]/, "").replace(/['"]$/, "");
}

/** repoRoot-relative POSIX path of a workspace dir; "." for the root importer. */
function importerKey(repoRoot: string, workspaceDir: string): string {
  const rel = relative(repoRoot, workspaceDir).split(sep).join("/");
  return rel === "" ? "." : rel;
}

/** Read a dep's resolved version from a pnpm-lock.yaml v9 `importers:` block. Narrow
 *  hand-rolled scan (no YAML dep). Returns the plain semver (peer/hash suffix after the
 *  first "(" stripped) or null. */
export function pnpmLockVersion(lock: string, importerRel: string, name: string): string | null {
  const lines = lock.split("\n");
  let i = 0;
  while (i < lines.length && !/^importers:\s*$/.test(lines[i])) i++;
  if (i >= lines.length) return null;
  for (i++; i < lines.length; i++) {
    const line = lines[i];
    if (/^\S/.test(line)) return null;                      // left the importers: section → not found
    const m = /^  (\S[^:]*?):\s*$/.exec(line);              // 2-space importer key (ending right after ":")
    if (!m || unquote(m[1].trim()) !== importerRel) continue;
    // inside the target importer block
    let currentDep: string | null = null;
    for (i++; i < lines.length; i++) {
      const l = lines[i];
      if (/^\S/.test(l) || /^ {2}\S/.test(l)) return null;  // next importer / top-level key → dep not in this block
      const dep = /^ {6}('?[^':]+'?):\s*$/.exec(l);          // 6-space dep name (scoped names may be quoted)
      if (dep) { currentDep = unquote(dep[1].trim()); continue; }
      const ver = /^ {8}version:\s*(.+)$/.exec(l);           // 8-space version
      if (ver && currentDep === name) return ver[1].trim().split("(")[0].trim();
    }
    return null;
  }
  return null;
}

/** PM-agnostic resolver. Prefers the node_modules walk (what actually loads); falls back to
 *  the pnpm-lock.yaml importer entry when the walk can't find it (e.g. a pnpm workspace with
 *  no local node_modules). Pure file reads; no subprocess. */
export function createVersionResolver(repoRoot: string, deps: ResolverDeps = defaultDeps): VersionResolver {
  let lockCache: string | null | undefined; // undefined = not read yet; null = absent/unreadable
  const readLock = (): string | null => {
    if (lockCache === undefined) {
      try { lockCache = deps.readFile(join(repoRoot, "pnpm-lock.yaml")); } catch { lockCache = null; }
    }
    return lockCache;
  };
  return {
    resolve(workspaceDir, name) {
      const walked = walkNodeModules(repoRoot, workspaceDir, name, deps);
      if (walked !== null) return walked;                   // prefer the actually-installed version
      const lock = readLock();
      if (lock !== null) {
        const v = pnpmLockVersion(lock, importerKey(repoRoot, workspaceDir), name);
        if (v) return v;
      }
      return null;
    },
  };
}
