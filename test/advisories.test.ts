import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeAdvisories, detectDrift } from "../src/advisories.js";
import type { Ledger } from "../src/ledger.js";

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

const entry = (version: string, ack: { id: string; severity: "low"|"moderate"|"high"|"critical" }[]) => ({
  approvedVersion: version, addedAt: "x", risk: "low" as const, reason: null, addedBy: null,
  checks: { ageHours: 1, installScripts: false as const },
  cve: { acknowledged: ack, acknowledgedBy: "alice", acknowledgedAt: "x", reason: "accepted" },
});

test("detectDrift reports advisories not in the acknowledged set", () => {
  const ledger: Ledger = { lodash: entry("4.17.20", [{ id: "GHSA-old", severity: "low" }]) };
  const drift = detectDrift(ledger, { lodash: [{ id: "GHSA-old", severity: "low" }, { id: "GHSA-new", severity: "high" }] });
  assert.equal(drift.length, 1);
  assert.equal(drift[0].package, "lodash");
  assert.deepEqual(drift[0].newAdvisories, [{ id: "GHSA-new", severity: "high" }]);
});

test("detectDrift reports nothing when all advisories are acknowledged", () => {
  const ledger: Ledger = { lodash: entry("4.17.20", [{ id: "GHSA-old", severity: "low" }]) };
  assert.deepEqual(detectDrift(ledger, { lodash: [{ id: "GHSA-old", severity: "low" }] }), []);
});

test("detectDrift treats a missing cve field as an empty acknowledged set", () => {
  const ledger: Ledger = { foo: { approvedVersion: "1", addedAt: "x", risk: "low", reason: null, addedBy: null, checks: { ageHours: 1, installScripts: false } } };
  const drift = detectDrift(ledger, { foo: [{ id: "GHSA-z", severity: "critical" }] });
  assert.deepEqual(drift[0].newAdvisories, [{ id: "GHSA-z", severity: "critical" }]);
});

test("detectDrift ignores resolved advisories (acknowledged but no longer live)", () => {
  const ledger: Ledger = { lodash: entry("4.17.20", [{ id: "GHSA-old", severity: "low" }]) };
  assert.deepEqual(detectDrift(ledger, { lodash: [] }), []);
});
