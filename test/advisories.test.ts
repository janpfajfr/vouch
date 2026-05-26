import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeAdvisories } from "../src/advisories.js";

test("maps ghsa_id and severity per package", () => {
  const raw = {
    lodash: [{ id: 1065, ghsa_id: "GHSA-x6yq", severity: "high", title: "Prototype Pollution" }],
  };
  const out = normalizeAdvisories(raw);
  assert.deepEqual(out, { lodash: [{ id: "GHSA-x6yq", severity: "high" }] });
});

test("falls back to npm id as string when ghsa_id is missing", () => {
  const out = normalizeAdvisories({ foo: [{ id: 42, severity: "moderate" }] });
  assert.deepEqual(out.foo, [{ id: "42", severity: "moderate" }]);
});

test("maps info severity to low and unknown severity to low", () => {
  const out = normalizeAdvisories({ a: [{ id: 1, severity: "info" }], b: [{ id: 2, severity: "weird" }] });
  assert.equal(out.a[0].severity, "low");
  assert.equal(out.b[0].severity, "low");
});

test("skips malformed entries and sorts advisories by id", () => {
  const out = normalizeAdvisories({ p: [null, { id: 5, ghsa_id: "GHSA-bbb", severity: "low" }, { ghsa_id: "GHSA-aaa", id: 9, severity: "critical" }] });
  assert.deepEqual(out.p, [
    { id: "GHSA-aaa", severity: "critical" },
    { id: "GHSA-bbb", severity: "low" },
  ]);
});

test("returns empty object for non-object input", () => {
  assert.deepEqual(normalizeAdvisories(null), {});
  assert.deepEqual(normalizeAdvisories("nope"), {});
});
