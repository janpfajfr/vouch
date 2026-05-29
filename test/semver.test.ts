import { test } from "node:test";
import assert from "node:assert/strict";
import { satisfiesRange, isExactPin } from "../src/semver.js";

test("isExactPin: only concrete single versions count as pinned", () => {
  for (const r of ["1.2.3", "=1.2.3", "v1.2.3", "1.2.3-beta.1", " 1.2.3 "]) assert.equal(isExactPin(r), true, r);
  for (const r of ["^1.2.3", "~1.2.3", "1.x", "1.2", "*", "", ">=1.0.0", "1.2.3 || 2.0.0", "next", "github:u/r", "file:../x"]) assert.equal(isExactPin(r), false, r);
});

test("exact version: matches only itself", () => {
  assert.equal(satisfiesRange("1.2.3", "1.2.3"), true);
  assert.equal(satisfiesRange("1.2.4", "1.2.3"), false);
  assert.equal(satisfiesRange("1.2.3", "=1.2.3"), true);
});

test("wildcards always match", () => {
  assert.equal(satisfiesRange("9.9.9", "*"), true);
  assert.equal(satisfiesRange("9.9.9", ""), true);
  assert.equal(satisfiesRange("9.9.9", "x"), true);
});

test("caret: locks the left-most non-zero, allows higher patch/minor", () => {
  assert.equal(satisfiesRange("1.4.0", "^1.2.3"), true);
  assert.equal(satisfiesRange("1.2.3", "^1.2.3"), true);
  assert.equal(satisfiesRange("2.0.0", "^1.2.3"), false);
  assert.equal(satisfiesRange("1.2.2", "^1.2.3"), false);
});

test("caret with leading zero: 0.x locks the minor", () => {
  assert.equal(satisfiesRange("0.2.9", "^0.2.3"), true);
  assert.equal(satisfiesRange("0.3.0", "^0.2.3"), false);
});

test("tilde: allows patch-level changes within a minor", () => {
  assert.equal(satisfiesRange("1.2.9", "~1.2.3"), true);
  assert.equal(satisfiesRange("1.3.0", "~1.2.3"), false);
  assert.equal(satisfiesRange("1.2.2", "~1.2.3"), false);
});

test("x-ranges", () => {
  assert.equal(satisfiesRange("4.18.1", "4.x"), true);
  assert.equal(satisfiesRange("4.18.1", "4"), true);
  assert.equal(satisfiesRange("3.0.0", "4.x"), false);
  assert.equal(satisfiesRange("4.18.1", "4.18.x"), true);
  assert.equal(satisfiesRange("4.19.0", "4.18.x"), false);
});

test("comparators", () => {
  assert.equal(satisfiesRange("4.18.1", ">=4.0.0"), true);
  assert.equal(satisfiesRange("3.9.9", ">=4.0.0"), false);
  assert.equal(satisfiesRange("4.0.1", ">4.0.0"), true);
  assert.equal(satisfiesRange("4.0.0", ">4.0.0"), false);
  assert.equal(satisfiesRange("3.0.0", "<4.0.0"), true);
  assert.equal(satisfiesRange("4.0.0", "<=4.0.0"), true);
});

test("OR ranges: satisfied if any branch is", () => {
  assert.equal(satisfiesRange("2.0.0", "^1.0.0 || ^2.0.0"), true);
  assert.equal(satisfiesRange("3.0.0", "^1.0.0 || ^2.0.0"), false);
});

test("prerelease/build metadata on the version is ignored for the core compare", () => {
  assert.equal(satisfiesRange("1.2.3-beta.1", "^1.2.0"), true);
});

test("unparseable / unsupported ranges return null (skip, never a false drift)", () => {
  assert.equal(satisfiesRange("1.2.3", "1.2.3 - 2.0.0"), null); // hyphen ranges unsupported for now
  assert.equal(satisfiesRange("1.2.3", "next"), null);          // dist-tag
  assert.equal(satisfiesRange("1.2.3", "github:user/repo"), null);
  assert.equal(satisfiesRange("not-a-version", "^1.0.0"), null);
});
