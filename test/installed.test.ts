// test/installed.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { createVersionResolver, isProtocolRange, pnpmLockVersion, type ResolverDeps } from "../src/installed.js";

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

// --- pnpm-lock.yaml fallback ---
const LOCK = `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      lodash:
        specifier: ^4
        version: 4.17.21

  apps/elis:
    dependencies:
      zod:
        specifier: ^3
        version: 3.25.76(react@18.3.0)
    devDependencies:
      '@types/react':
        specifier: 18.0.38
        version: 18.0.38

  libs/components:
    dependencies:
      '@dnd-kit/core':
        specifier: 6.1.0
        version: 6.1.0(react-dom@18.3.0(react@18.3.0))(react@18.3.0)
      classnames:
        specifier: ^2
        version: 2.5.1

packages:

  lodash@4.17.21: {}
`;

test("falls back to pnpm-lock when there is no local node_modules (the components case)", () => {
  const root = "/repo";
  const deps = tree({ [join(root, "pnpm-lock.yaml")]: LOCK }); // NO node_modules anywhere
  const r = createVersionResolver(root, deps);
  assert.equal(r.resolve(join(root, "libs/components"), "classnames"), "2.5.1");
});

test("lockfile fallback strips the peer/hash suffix and handles scoped names", () => {
  const root = "/repo";
  const r = createVersionResolver(root, tree({ [join(root, "pnpm-lock.yaml")]: LOCK }));
  assert.equal(r.resolve(join(root, "apps/elis"), "zod"), "3.25.76");
  assert.equal(r.resolve(join(root, "apps/elis"), "@types/react"), "18.0.38");
  assert.equal(r.resolve(join(root, "libs/components"), "@dnd-kit/core"), "6.1.0");
});

test("lockfile fallback resolves the root importer '.'", () => {
  const root = "/repo";
  const r = createVersionResolver(root, tree({ [join(root, "pnpm-lock.yaml")]: LOCK }));
  assert.equal(r.resolve(root, "lodash"), "4.17.21");
});

test("node_modules walk is PREFERRED over the lockfile when both resolve", () => {
  const root = "/repo";
  const deps = tree({
    [join(root, "apps/elis/node_modules/zod/package.json")]: JSON.stringify({ version: "3.99.99" }),
    [join(root, "pnpm-lock.yaml")]: LOCK, // says 3.25.76
  });
  const r = createVersionResolver(root, deps);
  assert.equal(r.resolve(join(root, "apps/elis"), "zod"), "3.99.99"); // actual install wins
});

test("returns null when neither node_modules nor lockfile has the dep", () => {
  const root = "/repo";
  const r = createVersionResolver(root, tree({ [join(root, "pnpm-lock.yaml")]: LOCK }));
  assert.equal(r.resolve(join(root, "apps/elis"), "nonexistent"), null);
});

test("pnpmLockVersion: unknown importer → null", () => {
  assert.equal(pnpmLockVersion(LOCK, "libs/missing", "x"), null);
});
