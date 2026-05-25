import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeMetadata, PackageNotFoundError } from "../src/registry.js";

const fixture = {
  "dist-tags": { latest: "4.17.21" },
  versions: {
    "4.17.21": {
      name: "lodash",
      version: "4.17.21",
      scripts: { test: "echo" },
      repository: { url: "git+https://github.com/lodash/lodash.git" },
      license: "MIT",
    },
  },
  time: { "4.17.21": "2021-02-20T15:42:16.891Z" },
};

test("normalizes latest version", () => {
  const m = normalizeMetadata("lodash", undefined, fixture);
  assert.equal(m.version, "4.17.21");
  assert.equal(m.hasRepository, true);
  assert.equal(m.hasLicense, true);
  assert.deepEqual(m.scripts, { test: "echo" });
  assert.ok(m.publishedAt instanceof Date);
});

test("resolves an explicit version", () => {
  const m = normalizeMetadata("lodash", "4.17.21", fixture);
  assert.equal(m.version, "4.17.21");
});

test("throws PackageNotFoundError for missing version", () => {
  assert.throws(() => normalizeMetadata("lodash", "9.9.9", fixture), PackageNotFoundError);
});

test("missing time yields null publishedAt", () => {
  const noTime = { ...fixture, time: {} };
  const m = normalizeMetadata("lodash", undefined, noTime);
  assert.equal(m.publishedAt, null);
});
