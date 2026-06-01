import { test } from "node:test";
import assert from "node:assert/strict";
import { splitNameVersion, ledgerKey } from "../src/spec.js";

test("splitNameVersion: bare name has no version", () => {
  assert.deepEqual(splitNameVersion("lodash"), { name: "lodash", version: undefined });
});

test("splitNameVersion: name@version splits on the last @", () => {
  assert.deepEqual(splitNameVersion("lodash@4.17.21"), { name: "lodash", version: "4.17.21" });
});

test("splitNameVersion: scoped name keeps the scope @, splits the version @", () => {
  assert.deepEqual(splitNameVersion("@scope/pkg@1.2.3"), { name: "@scope/pkg", version: "1.2.3" });
});

test("splitNameVersion: bare scoped name has no version", () => {
  assert.deepEqual(splitNameVersion("@scope/pkg"), { name: "@scope/pkg", version: undefined });
});

test("ledgerKey joins name and version; scope @ is a prefix, not the delimiter", () => {
  assert.equal(ledgerKey("lodash", "4.17.21"), "lodash@4.17.21");
  assert.equal(ledgerKey("@scope/pkg", "1.2.3"), "@scope/pkg@1.2.3");
});
