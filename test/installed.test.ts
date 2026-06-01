// test/installed.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { createVersionResolver, isProtocolRange, type ResolverDeps } from "../src/installed.js";

/** In-memory fs: realpath returns the path if present (no symlinks modeled), else throws. */
function tree(files: Record<string, string>): ResolverDeps {
  return {
    realpath: (p) => { if (p in files) return p; throw new Error(`ENOENT ${p}`); },
    readFile: (p) => { if (p in files) return files[p]; throw new Error(`ENOENT ${p}`); },
  };
}
const manifest = (v: string) => JSON.stringify({ version: v });

test("resolves a dep from the workspace-local node_modules", () => {
  const root = "/repo";
  const deps = tree({ [join(root, "apps/elis/node_modules/zod/package.json")]: manifest("3.25.76") });
  const r = createVersionResolver(root, deps);
  assert.equal(r.resolve(join(root, "apps/elis"), "zod"), "3.25.76");
});

test("multi-version: each workspace resolves its own installed version", () => {
  const root = "/repo";
  const deps = tree({
    [join(root, "apps/elis/node_modules/zod/package.json")]: manifest("3.25.76"),
    [join(root, "libs/api/node_modules/zod/package.json")]: manifest("4.3.6"),
  });
  const r = createVersionResolver(root, deps);
  assert.equal(r.resolve(join(root, "apps/elis"), "zod"), "3.25.76");
  assert.equal(r.resolve(join(root, "libs/api"), "zod"), "4.3.6");
});

test("walks up to a dep hoisted to the repo-root node_modules", () => {
  const root = "/repo";
  const deps = tree({ [join(root, "node_modules/lodash/package.json")]: manifest("4.17.21") });
  const r = createVersionResolver(root, deps);
  assert.equal(r.resolve(join(root, "apps/elis"), "lodash"), "4.17.21");
});

test("single-package: resolves from cwd node_modules", () => {
  const root = "/proj";
  const deps = tree({ [join(root, "node_modules/lodash/package.json")]: manifest("4.17.21") });
  const r = createVersionResolver(root, deps);
  assert.equal(r.resolve(root, "lodash"), "4.17.21");
});

test("scoped names resolve at the @scope/pkg path", () => {
  const root = "/repo";
  const deps = tree({ [join(root, "node_modules/@scope/pkg/package.json")]: manifest("1.2.3") });
  const r = createVersionResolver(root, deps);
  assert.equal(r.resolve(root, "@scope/pkg"), "1.2.3");
});

test("returns null when not installed anywhere up to the root", () => {
  const r = createVersionResolver("/repo", tree({}));
  assert.equal(r.resolve("/repo/apps/elis", "missing"), null);
});

test("returns null (not a hang) when realpath/read throws, then exhausts the walk", () => {
  const r = createVersionResolver("/repo", tree({ "/repo/node_modules/x/package.json": "{ not json" }));
  assert.equal(r.resolve("/repo/apps/elis", "x"), null); // JSON.parse throws → caught → walk up → null
});

test("isProtocolRange: internal/non-registry specifiers are true", () => {
  for (const s of ["workspace:*", "link:../x", "file:./y", "catalog:", "git:foo", "github:o/r", "https://x", "  workspace:^1  "]) {
    assert.equal(isProtocolRange(s), true, s);
  }
  for (const s of ["^1.2.3", "1.2.3", "*", "~2.0.0", ">=1 <2"]) {
    assert.equal(isProtocolRange(s), false, s);
  }
});
