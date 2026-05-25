import { test } from "node:test";
import assert from "node:assert/strict";
import { runCheck } from "../src/check-command.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import type { Ledger } from "../src/ledger.js";

const base = { approvedVersion: "1.0.0", approvedAt: "x", reason: null, approvedBy: null, checks: { ageHours: 1, installScripts: false as const } };

test("fails when a dependency has no ledger entry", () => {
  const v = runCheck({ dependencies: { lodash: "^4" } }, {}, DEFAULT_CONFIG);
  assert.equal(v.length, 1);
  assert.equal(v[0].package, "lodash");
  assert.match(v[0].reason, /no ledger entry/i);
});

test("passes when every dep is in the ledger", () => {
  const ledger: Ledger = { lodash: { ...base, risk: "low" } };
  const v = runCheck({ dependencies: { lodash: "^4" } }, ledger, DEFAULT_CONFIG);
  assert.deepEqual(v, []);
});

test("checks devDependencies too", () => {
  const v = runCheck({ devDependencies: { typescript: "^5" } }, {}, DEFAULT_CONFIG);
  assert.equal(v.length, 1);
  assert.equal(v[0].package, "typescript");
});

test("high-risk without reason fails", () => {
  const ledger: Ledger = { evil: { ...base, risk: "high", reason: null, approvedBy: "alice" } };
  const v = runCheck({ dependencies: { evil: "1" } }, ledger, DEFAULT_CONFIG);
  assert.ok(v.some((x) => /reason/i.test(x.reason)));
});

test("high-risk with reason but no approvedBy fails when approval required", () => {
  const ledger: Ledger = { evil: { ...base, risk: "high", reason: "needed", approvedBy: null } };
  const v = runCheck({ dependencies: { evil: "1" } }, ledger, DEFAULT_CONFIG);
  assert.ok(v.some((x) => /approv/i.test(x.reason)));
});

test("high-risk with reason and approvedBy passes", () => {
  const ledger: Ledger = { evil: { ...base, risk: "high", reason: "needed", approvedBy: "alice" } };
  const v = runCheck({ dependencies: { evil: "1" } }, ledger, DEFAULT_CONFIG);
  assert.deepEqual(v, []);
});

test("approval not required when requireApprovalForHighRisk is false", () => {
  const cfg = { ...DEFAULT_CONFIG, requireApprovalForHighRisk: false };
  const ledger: Ledger = { evil: { ...base, risk: "high", reason: "needed", approvedBy: null } };
  const v = runCheck({ dependencies: { evil: "1" } }, ledger, cfg);
  assert.deepEqual(v, []);
});
