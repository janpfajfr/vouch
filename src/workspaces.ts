// src/workspaces.ts
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, relative, sep } from "node:path";
import type { PackageJsonLike } from "./check-command.js";

/** Translate a workspace glob to an anchored RegExp over a POSIX relative path.
 *  Supports only what real workspace globs use: `*` (one segment), `**` (zero+ segments),
 *  `/` literal, and literal paths. No `?`, `[...]`, `{a,b}`, extglobs. */
export function globToRegExp(glob: string): RegExp {
  let re = glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&"); // escape specials EXCEPT * and /
  // Tokenize the `**` forms first so the single-`*` pass can't corrupt them, then expand.
  re = re
    .replace(/\*\*\//g, " A") // **/  → zero-or-more leading segments
    .replace(/\/\*\*/g, " B") // /**  → zero-or-more trailing segments
    .replace(/\*\*/g, " C")   // **   → any
    .replace(/\*/g, "[^/]*")       // *    → one segment
    .replace(/ A/g, "(?:.*/)?")
    .replace(/ B/g, "(?:/.*)?")
    .replace(/ C/g, ".*");
  return new RegExp(`^${re}$`);
}

/** A relative POSIX path is a member iff it matches ≥1 non-`!` glob AND 0 `!` globs. */
export function matchesWorkspaceGlobs(relPath: string, globs: string[]): boolean {
  let included = false;
  for (const g of globs) {
    if (g.startsWith("!")) {
      if (globToRegExp(g.slice(1)).test(relPath)) return false;
    } else if (globToRegExp(g).test(relPath)) {
      included = true;
    }
  }
  return included;
}

/** One discovered package. */
export interface WorkspacePackage {
  dir: string;        // absolute directory containing package.json
  relPath: string;    // POSIX path relative to repoRoot; "." for the root package
  name: string | null;
  pkg: PackageJsonLike & { name?: string };
}

/** Minimal dir entry (matches node:fs Dirent's surface we use). */
export interface DirEntry { name: string; isDirectory(): boolean; }

/** Injected fs surface — the whole module is testable with an in-memory tree. */
export interface DiscoveryDeps {
  readFile: (path: string) => string; // throws on missing
  readdir: (path: string) => DirEntry[];
  exists: (path: string) => boolean;
}

const defaultDeps: DiscoveryDeps = {
  readFile: (p) => readFileSync(p, "utf8"),
  readdir: (p) => readdirSync(p, { withFileTypes: true }),
  exists: (p) => existsSync(p),
};

/** Parse the `packages:` block of pnpm-workspace.yaml (block sequence OR flow array).
 *  All other top-level keys (catalog, catalogs, minimumReleaseAge, …) are ignored. */
export function __parsePnpmPackages(yaml: string): string[] {
  const lines = yaml.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^packages:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const trailing = m[1].trim();
    const globs: string[] = [];
    if (trailing.startsWith("[")) {
      const inner = trailing.replace(/^\[/, "").replace(/\].*$/, "");
      for (const part of inner.split(",")) { const v = stripItem(part); if (v) globs.push(v); }
    } else {
      for (let j = i + 1; j < lines.length; j++) {
        const line = lines[j];
        if (/^\s*$/.test(line)) continue;             // blank
        const item = /^\s+-\s+(.*)$/.exec(line);
        if (item) { const v = stripItem(item[1]); if (v) globs.push(v); continue; }
        if (/^\S/.test(line)) break;                  // next top-level key
        break;                                        // unrecognized indented line → stop
      }
    }
    return globs;
  }
  return [];
}

function stripItem(s: string): string {
  let v = s.trim();
  if (!/^['"]/.test(v)) v = v.replace(/\s+#.*$/, "").trim(); // drop unquoted trailing comment
  v = v.replace(/^['"]/, "").replace(/['"]$/, "").replace(/^\[/, "").replace(/\]$/, "").trim();
  return v;
}

/** Read workspace globs from a parsed package.json (npm array / yarn object form). */
export function __pkgWorkspaceGlobs(pkg: unknown): string[] {
  const ws = (pkg as { workspaces?: unknown } | null)?.workspaces;
  if (Array.isArray(ws)) return ws as string[];
  if (ws && typeof ws === "object" && Array.isArray((ws as { packages?: unknown }).packages)) {
    return (ws as { packages: string[] }).packages;
  }
  return [];
}

function readPkg(dir: string, deps: DiscoveryDeps): (PackageJsonLike & { name?: string }) | null {
  try { return JSON.parse(deps.readFile(join(dir, "package.json"))); } catch { return null; }
}

/** Walk up from cwd to the workspace root: nearest ancestor with pnpm-workspace.yaml or a
 *  `workspaces` package.json; else the nearest .git; else cwd (single-package). */
export function findRepoRoot(cwd: string, deps: DiscoveryDeps = defaultDeps): string {
  let dir = cwd;
  let firstGit: string | null = null;
  for (;;) {
    if (deps.exists(join(dir, "pnpm-workspace.yaml"))) return dir;
    const pkg = deps.exists(join(dir, "package.json")) ? readPkg(dir, deps) : null;
    if (pkg && (pkg as { workspaces?: unknown }).workspaces) return dir;
    if (firstGit === null && deps.exists(join(dir, ".git"))) firstGit = dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return firstGit ?? cwd;
}

function toPosixRel(root: string, dir: string): string {
  const rel = relative(root, dir).split(sep).join("/");
  return rel === "" ? "." : rel;
}

function listDirs(dir: string, deps: DiscoveryDeps): string[] {
  let entries: DirEntry[];
  try { entries = deps.readdir(dir); } catch { return []; }
  return entries.filter((e) => e.isDirectory()).map((e) => join(dir, e.name));
}

const PRUNE = new Set(["node_modules", "dist", ".git"]);

function walkBounded(start: string, deps: DiscoveryDeps, maxDepth: number, out: Set<string>): void {
  const stack: Array<{ dir: string; depth: number }> = [{ dir: start, depth: 0 }];
  while (stack.length) {
    const { dir, depth } = stack.pop()!;
    if (deps.exists(join(dir, "package.json"))) out.add(dir);
    if (depth >= maxDepth) continue;
    for (const child of listDirs(dir, deps)) {
      const base = child.slice(dir.length + 1);
      if (PRUNE.has(base) || base.startsWith(".")) continue;
      stack.push({ dir: child, depth: depth + 1 });
    }
  }
}

/** Enumerate candidate dirs for one non-negation glob, cheaply (no full-tree walk). */
function enumerateGlob(repoRoot: string, glob: string, deps: DiscoveryDeps, out: Set<string>): void {
  const segments = glob.split("/");
  const wildIdx = segments.findIndex((s) => s.includes("*"));
  if (wildIdx === -1) {                                   // literal path
    out.add(join(repoRoot, glob));
    return;
  }
  const prefixDir = wildIdx === 0 ? repoRoot : join(repoRoot, segments.slice(0, wildIdx).join("/"));
  if (segments[wildIdx] === "**") {
    walkBounded(prefixDir, deps, 6, out);                 // prefix/** → bounded recursive walk
  } else {
    for (const d of listDirs(prefixDir, deps)) out.add(d); // prefix/* → one readdir level
  }
}

function readGlobs(repoRoot: string, deps: DiscoveryDeps): string[] {
  if (deps.exists(join(repoRoot, "pnpm-workspace.yaml"))) {
    try { const g = __parsePnpmPackages(deps.readFile(join(repoRoot, "pnpm-workspace.yaml"))); if (g.length) return g; } catch { /* fall through */ }
  }
  const rootPkg = readPkg(repoRoot, deps);
  if (rootPkg) { const g = __pkgWorkspaceGlobs(rootPkg); if (g.length) return g; }
  return [];
}

/** Discover all workspace packages under `repoRoot`. Always returns at least the root
 *  package (single-package mode) unless the root package.json is unreadable. Best-effort:
 *  any ambiguity collapses to single-package mode (never throws for discovery). */
export function discoverWorkspaces(repoRoot: string, deps: DiscoveryDeps = defaultDeps): WorkspacePackage[] {
  const rootPkg = readPkg(repoRoot, deps);
  const rootMember: WorkspacePackage | null = rootPkg
    ? { dir: repoRoot, relPath: ".", name: typeof rootPkg.name === "string" ? rootPkg.name : null, pkg: rootPkg }
    : null;

  const globs = readGlobs(repoRoot, deps);
  const candidates = new Set<string>();
  for (const g of globs) { if (!g.startsWith("!")) enumerateGlob(repoRoot, g, deps, candidates); }

  const members: WorkspacePackage[] = [];
  const seen = new Set<string>();
  for (const dir of candidates) {
    const rel = toPosixRel(repoRoot, dir);
    if (rel === ".") continue;                                  // root handled separately
    if (rel.split("/").some((s) => PRUNE.has(s))) continue;     // never node_modules/dist/.git
    if (!matchesWorkspaceGlobs(rel, globs)) continue;
    if (seen.has(dir)) continue;
    const pkg = readPkg(dir, deps);
    if (!pkg) continue;                                         // keep only real packages
    seen.add(dir);
    members.push({ dir, relPath: rel, name: typeof pkg.name === "string" ? pkg.name : null, pkg });
  }

  if (members.length === 0) return rootMember ? [rootMember] : []; // fail-soft → single-package
  members.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return rootMember ? [rootMember, ...members] : members;
}
