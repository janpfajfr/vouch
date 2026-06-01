// test/workspaces.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  globToRegExp,
  matchesWorkspaceGlobs,
  findRepoRoot,
  discoverWorkspaces,
  __parsePnpmPackages,
  __pkgWorkspaceGlobs,
  type DiscoveryDeps,
} from "../src/workspaces.js";

// ─── Task 1: Glob matcher ────────────────────────────────────────────────────

test("apps/* matches one segment, not nested", () => {
  const re = globToRegExp("apps/*");
  assert.ok(re.test("apps/foo"));
  assert.ok(!re.test("apps/foo/bar"));
  assert.ok(!re.test("apps"));
});

test("libs/** matches nested segments", () => {
  const re = globToRegExp("libs/**");
  assert.ok(re.test("libs/a"));
  assert.ok(re.test("libs/a/b"));
});

test("literal path matches exactly", () => {
  const re = globToRegExp("tools/build");
  assert.ok(re.test("tools/build"));
  assert.ok(!re.test("tools/build/x"));
});

test("matchesWorkspaceGlobs: member iff ≥1 non-! glob and 0 ! globs", () => {
  assert.ok(matchesWorkspaceGlobs("apps/foo", ["apps/*", "libs/*"]));
  assert.ok(!matchesWorkspaceGlobs("docs/x", ["apps/*"]));
  assert.ok(!matchesWorkspaceGlobs("apps/legacy", ["apps/*", "!apps/legacy"]));
  assert.ok(matchesWorkspaceGlobs("apps/foo", ["apps/*", "!apps/legacy"]));
});

// ─── Task 2: Workspace-glob readers and findRepoRoot ────────────────────────

test("pnpm block-sequence packages: parsed; security keys ignored", () => {
  const yaml = [
    "packages:",
    "  - apps/*",
    "  - libs/*",
    "  - tools/*",
    "minimumReleaseAge: 10080",
    "blockExoticSubdeps: true",
  ].join("\n");
  assert.deepEqual(__parsePnpmPackages(yaml), ["apps/*", "libs/*", "tools/*"]);
});

test("pnpm flow-array packages: parsed", () => {
  assert.deepEqual(__parsePnpmPackages(`packages: ['apps/*', "libs/*"]`), ["apps/*", "libs/*"]);
});

test("pnpm scanner does not descend into a sibling catalogs: block", () => {
  const yaml = ["packages:", "  - apps/*", "catalogs:", "  default:", "    zod: 3.25.76"].join("\n");
  assert.deepEqual(__parsePnpmPackages(yaml), ["apps/*"]);
});

test("package.json workspaces: array form and yarn object form", () => {
  assert.deepEqual(__pkgWorkspaceGlobs({ workspaces: ["packages/*"] }), ["packages/*"]);
  assert.deepEqual(__pkgWorkspaceGlobs({ workspaces: { packages: ["packages/*"], nohoist: ["x"] } }), ["packages/*"]);
  assert.deepEqual(__pkgWorkspaceGlobs({ workspaces: { foo: 1 } }), []);
  assert.deepEqual(__pkgWorkspaceGlobs({}), []);
});

function fs(files: Record<string, string>, dirs: Record<string, string[]>): DiscoveryDeps {
  return {
    readFile: (p) => { if (p in files) return files[p]; throw new Error(`ENOENT ${p}`); },
    exists: (p) => p in files || p in dirs,
    readdir: (p) => (dirs[p] ?? []).map((name) => ({ name, isDirectory: () => true })),
  };
}

test("findRepoRoot walks up to pnpm-workspace.yaml", () => {
  const deps = fs({ "/r/pnpm-workspace.yaml": "packages:\n  - apps/*\n" }, { "/r": [], "/r/apps": [], "/r/apps/elis": [] });
  assert.equal(findRepoRoot("/r/apps/elis", deps), "/r");
});

test("findRepoRoot prefers a workspaces package.json over a nearer .git", () => {
  const deps = fs(
    { "/r/package.json": JSON.stringify({ workspaces: ["apps/*"] }) },
    { "/r": [], "/r/apps": [], "/r/apps/elis/.git": [], "/r/apps/elis": [] },
  );
  assert.equal(findRepoRoot("/r/apps/elis", deps), "/r");
});

test("findRepoRoot: no workspace marker → nearest enclosing package.json, else cwd", () => {
  // no markers and no package.json anywhere → cwd
  assert.equal(findRepoRoot("/r/sub", fs({}, { "/r/.git": [], "/r": [], "/r/sub": [] })), "/r/sub");
  // single-package repo run from a subdir: the ancestor package.json wins
  assert.equal(findRepoRoot("/r/sub", fs({ "/r/package.json": "{}" }, { "/r": [], "/r/sub": [] })), "/r");
});

test("findRepoRoot: a subdir package wins over a non-workspace git root (no silent wrong-target)", () => {
  const deps = fs({ "/r/package.json": "{}", "/r/apps/x/package.json": "{}" }, { "/r/.git": [], "/r": [], "/r/apps": [], "/r/apps/x": [] });
  assert.equal(findRepoRoot("/r/apps/x", deps), "/r/apps/x"); // the package you're in, not the git root
});

// ─── Task 3: discoverWorkspaces ──────────────────────────────────────────────

const PKG = (name: string) => JSON.stringify({ name });

test("discovers apps/* + libs/*, always includes root, indexes by manifest name", () => {
  const deps = fs(
    {
      "/r/pnpm-workspace.yaml": "packages:\n  - apps/*\n  - libs/*\n",
      "/r/package.json": JSON.stringify({ name: "root" }),
      "/r/apps/elis/package.json": PKG("@app/elis"),
      "/r/libs/api/package.json": PKG("@rossum/api"),
    },
    { "/r": [], "/r/apps": ["elis"], "/r/apps/elis": [], "/r/libs": ["api"], "/r/libs/api": [] },
  );
  const ws = discoverWorkspaces("/r", deps);
  const byRel = Object.fromEntries(ws.map((w) => [w.relPath, w.name]));
  assert.deepEqual(byRel, { ".": "root", "apps/elis": "@app/elis", "libs/api": "@rossum/api" });
});

test("excludes node_modules and dist; keeps only dirs with a package.json", () => {
  const deps = fs(
    {
      "/r/pnpm-workspace.yaml": "packages:\n  - libs/*\n",
      "/r/package.json": JSON.stringify({ name: "root" }),
      "/r/libs/api/package.json": PKG("api"),
      "/r/libs/api/dist/package.json": PKG("api-dist"),  // must be excluded
      // libs/notapkg has no package.json → dropped
    },
    { "/r": [], "/r/libs": ["api", "notapkg"], "/r/libs/api": ["dist"], "/r/libs/api/dist": [], "/r/libs/notapkg": [] },
  );
  const rels = discoverWorkspaces("/r", deps).map((w) => w.relPath).sort();
  assert.deepEqual(rels, [".", "libs/api"]);
});

test("fail-soft: no config → single-package (root only)", () => {
  const deps = fs({ "/r/package.json": JSON.stringify({ name: "solo" }) }, { "/r": [] });
  const ws = discoverWorkspaces("/r", deps);
  assert.equal(ws.length, 1);
  assert.equal(ws[0].relPath, ".");
});

test("fail-soft: empty packages: block → single-package", () => {
  const deps = fs({ "/r/pnpm-workspace.yaml": "packages:\n", "/r/package.json": JSON.stringify({ name: "solo" }) }, { "/r": [] });
  assert.deepEqual(discoverWorkspaces("/r", deps).map((w) => w.relPath), ["."]);
});

test("fail-soft: zero matching package dirs → single-package", () => {
  const deps = fs({ "/r/pnpm-workspace.yaml": "packages:\n  - apps/*\n", "/r/package.json": JSON.stringify({ name: "solo" }) }, { "/r": [], "/r/apps": [] });
  assert.deepEqual(discoverWorkspaces("/r", deps).map((w) => w.relPath), ["."]);
});

test("fail-soft: even an unreadable root yields [] (command's readPackageJson fails closed)", () => {
  const deps = fs({}, { "/r": [] });
  assert.deepEqual(discoverWorkspaces("/r", deps), []);
});
