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

const entry = (name: string, version: string, ackIds: string[]): Ledger[string] => ({
  name, version, addedAt: "x", risk: "low" as const, reason: null, addedBy: null,
  checks: { ageHours: 1, installScripts: false },
  cve: { acknowledged: ackIds.map((id) => ({ id, severity: "low" as const })), acknowledgedBy: "alice", acknowledgedAt: "x", reason: "accepted" },
});

test("detectDrift reports advisories not in the acknowledged set", () => {
  const ledger: Ledger = { "lodash@4.17.20": entry("lodash", "4.17.20", ["GHSA-old"]) };
  const drift = detectDrift(ledger, { lodash: [{ id: "GHSA-old", severity: "low" }, { id: "GHSA-new", severity: "high" }] }, { lodash: "4.17.20" });
  assert.equal(drift.length, 1);
  assert.equal(drift[0].package, "lodash");
  assert.deepEqual(drift[0].newAdvisories, [{ id: "GHSA-new", severity: "high", kind: "present-at-record" }]);
});

test("detectDrift reports nothing when all advisories are acknowledged", () => {
  const ledger: Ledger = { "lodash@4.17.20": entry("lodash", "4.17.20", ["GHSA-old"]) };
  assert.deepEqual(detectDrift(ledger, { lodash: [{ id: "GHSA-old", severity: "low" }] }, { lodash: "4.17.20" }), []);
});

test("detectDrift treats a missing cve field as an empty acknowledged set", () => {
  const ledger: Ledger = { "foo@1": { name: "foo", version: "1", addedAt: "x", risk: "low", reason: null, addedBy: null, checks: { ageHours: 1, installScripts: false } } };
  const drift = detectDrift(ledger, { foo: [{ id: "GHSA-z", severity: "critical" }] }, { foo: "1" });
  assert.deepEqual(drift[0].newAdvisories, [{ id: "GHSA-z", severity: "critical", kind: "present-at-record" }]);
});

test("detectDrift ignores resolved advisories (acknowledged but no longer live)", () => {
  const ledger: Ledger = { "lodash@4.17.20": entry("lodash", "4.17.20", ["GHSA-old"]) };
  assert.deepEqual(detectDrift(ledger, { lodash: [] }, { lodash: "4.17.20" }), []);
});

const e = (name: string, version: string, ackIds: string[]): Ledger[string] => ({
  name, version, addedAt: "t", risk: "low", reason: null, addedBy: null,
  checks: { ageHours: 1, installScripts: false },
  cve: { acknowledged: ackIds.map((id) => ({ id, severity: "low" as const })), acknowledgedBy: "a", acknowledgedAt: "t", reason: "ok" },
});

test("detectDrift keys acknowledgement by the INSTALLED name@version", () => {
  const ledger: Ledger = { "lodash@4.17.20": e("lodash", "4.17.20", ["GHSA-old"]) };
  const live = { lodash: [{ id: "GHSA-old", severity: "low" as const }, { id: "GHSA-new", severity: "high" as const }] };
  const drift = detectDrift(ledger, live, { lodash: "4.17.20" });
  assert.equal(drift.length, 1);
  assert.deepEqual(drift[0].newAdvisories.map((a) => a.id), ["GHSA-new"]);
});

test("detectDrift: acking lodash@4.17.20 does NOT suppress drift on 4.17.21", () => {
  const ledger: Ledger = { "lodash@4.17.20": e("lodash", "4.17.20", ["GHSA-old"]) };
  const live = { lodash: [{ id: "GHSA-old", severity: "low" as const }] };
  const drift = detectDrift(ledger, live, { lodash: "4.17.21" });
  assert.equal(drift.length, 1);
  assert.deepEqual(drift[0].newAdvisories.map((a) => a.id), ["GHSA-old"]);
});

test("detectDrift skips a live package with no resolved installed version", () => {
  const ledger: Ledger = {};
  const live = { lodash: [{ id: "GHSA-x", severity: "low" as const }] };
  assert.deepEqual(detectDrift(ledger, live, {}), []);
});

// Baseline classification: entry carries checks.advisories (the seen-at-record set).
const entryWithBaseline = (name: string, version: string, seenIds: string[]): Ledger[string] => ({
  name, version, addedAt: "t", risk: "low", reason: null, addedBy: null,
  checks: { ageHours: 1, installScripts: false, advisories: seenIds.map((id) => ({ id, severity: "low" as const })) },
});

test("detectDrift: advisory in the seen baseline is present-at-record", () => {
  const ledger: Ledger = { "lodash@4.17.21": entryWithBaseline("lodash", "4.17.21", ["GHSA-old"]) };
  const drift = detectDrift(ledger, { lodash: [{ id: "GHSA-old", severity: "low" }] }, { lodash: "4.17.21" });
  assert.deepEqual(drift[0].newAdvisories, [{ id: "GHSA-old", severity: "low", kind: "present-at-record" }]);
});

test("detectDrift: advisory NOT in the seen baseline is new-since-record", () => {
  const ledger: Ledger = { "lodash@4.17.21": entryWithBaseline("lodash", "4.17.21", ["GHSA-old"]) };
  const drift = detectDrift(ledger, { lodash: [{ id: "GHSA-old", severity: "low" }, { id: "GHSA-new", severity: "high" }] }, { lodash: "4.17.21" });
  assert.deepEqual(drift[0].newAdvisories, [
    { id: "GHSA-old", severity: "low", kind: "present-at-record" },
    { id: "GHSA-new", severity: "high", kind: "new-since-record" },
  ]);
});

test("detectDrift: empty baseline [] means everything live is new-since-record", () => {
  const ledger: Ledger = { "lodash@4.17.21": entryWithBaseline("lodash", "4.17.21", []) };
  const drift = detectDrift(ledger, { lodash: [{ id: "GHSA-z", severity: "critical" }] }, { lodash: "4.17.21" });
  assert.deepEqual(drift[0].newAdvisories, [{ id: "GHSA-z", severity: "critical", kind: "new-since-record" }]);
});

test("detectDrift: legacy entry (no checks.advisories) classifies as present-at-record, never new", () => {
  const ledger: Ledger = { "foo@1": { name: "foo", version: "1", addedAt: "t", risk: "low", reason: null, addedBy: null, checks: { ageHours: 1, installScripts: false } } };
  const drift = detectDrift(ledger, { foo: [{ id: "GHSA-z", severity: "critical" }] }, { foo: "1" });
  assert.deepEqual(drift[0].newAdvisories, [{ id: "GHSA-z", severity: "critical", kind: "present-at-record" }]);
});

test("detectDrift: acknowledged advisory stays silent even if also in the baseline", () => {
  const ledger: Ledger = { "lodash@4.17.21": {
    name: "lodash", version: "4.17.21", addedAt: "t", risk: "low", reason: null, addedBy: null,
    checks: { ageHours: 1, installScripts: false, advisories: [{ id: "GHSA-old", severity: "low" }] },
    cve: { acknowledged: [{ id: "GHSA-old", severity: "low" }], acknowledgedBy: "a", acknowledgedAt: "t", reason: "ok" },
  } };
  assert.deepEqual(detectDrift(ledger, { lodash: [{ id: "GHSA-old", severity: "low" }] }, { lodash: "4.17.21" }), []);
});
