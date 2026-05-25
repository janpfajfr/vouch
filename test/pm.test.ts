import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectPM, installArgs, cooldownConfigured } from "../src/pm.js";

function withDir(files: Record<string, string>, fn: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "ysna-"));
  try {
    for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("detects pnpm by lockfile", () => withDir({ "pnpm-lock.yaml": "" }, (d) => assert.equal(detectPM(d, "auto"), "pnpm")));
test("detects yarn by lockfile", () => withDir({ "yarn.lock": "" }, (d) => assert.equal(detectPM(d, "auto"), "yarn")));
test("detects npm by lockfile", () => withDir({ "package-lock.json": "" }, (d) => assert.equal(detectPM(d, "auto"), "npm")));
test("defaults to pnpm when none", () => withDir({}, (d) => assert.equal(detectPM(d, "auto"), "pnpm")));
test("explicit config overrides detection", () => withDir({ "yarn.lock": "" }, (d) => assert.equal(detectPM(d, "npm"), "npm")));

test("install args, runtime and dev", () => {
  assert.deepEqual(installArgs("pnpm", "lodash", false), ["add", "lodash"]);
  assert.deepEqual(installArgs("pnpm", "lodash", true), ["add", "-D", "lodash"]);
  assert.deepEqual(installArgs("npm", "lodash", true), ["install", "-D", "lodash"]);
  assert.deepEqual(installArgs("yarn", "lodash", true), ["add", "-D", "lodash"]);
});

test("cooldownConfigured true when pnpm minimumReleaseAge set", () =>
  withDir({ "pnpm-workspace.yaml": "minimumReleaseAge: 1440\n" }, (d) => assert.equal(cooldownConfigured(d, "pnpm"), true)));
test("cooldownConfigured false when absent", () =>
  withDir({ "pnpm-workspace.yaml": "packages:\n  - x\n" }, (d) => assert.equal(cooldownConfigured(d, "pnpm"), false)));
