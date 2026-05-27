import { test } from "node:test";
import assert from "node:assert/strict";
import { runCheck, runCheckWithCve, detectVersionDrift, detectUnpinned } from "../src/check-command.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import type { Ledger } from "../src/ledger.js";
import type { AdvisoryClient, Advisory } from "../src/advisories.js";

const base = { approvedVersion: "1.0.0", addedAt: "x", reason: null, addedBy: null, checks: { ageHours: 1, installScripts: false as const } };

test("fails when a dependency has no ledger entry", () => {
  const v = runCheck({ dependencies: { lodash: "^4" } }, {}, DEFAULT_CONFIG);
  assert.equal(v.length, 1);
  assert.equal(v[0].package, "lodash");
  assert.match(v[0].reason, /not in the ledger/i);
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

test("high-risk with a reason passes (recorded + explained)", () => {
  const ledger: Ledger = { esbuild: { ...base, risk: "high", reason: "bundler" } };
  const v = runCheck({ dependencies: { esbuild: "^1.0.0" } }, ledger, DEFAULT_CONFIG);
  assert.equal(v.length, 0);
});

test("high-risk without a reason is BLOCKED (needs review)", () => {
  const ledger: Ledger = { esbuild: { ...base, risk: "high", reason: null } };
  const v = runCheck({ dependencies: { esbuild: "^1.0.0" } }, ledger, DEFAULT_CONFIG);
  assert.ok(v.some((x) => /reason/i.test(x.reason)));
});

const fakeClient = (data: Record<string, Advisory[]> | null): AdvisoryClient => ({
  async fetchBulk() { return data; },
});

const acked = (version: string, ids: string[]) => ({
  ...base, approvedVersion: version, risk: "low" as const,
  cve: { acknowledged: ids.map((id) => ({ id, severity: "low" as const })), acknowledgedBy: "alice", acknowledgedAt: "x", reason: "accepted" },
});

test("runCheckWithCve turns an unacknowledged advisory into a violation", async () => {
  const ledger = { lodash: acked("4.17.20", ["GHSA-old"]) };
  const r = await runCheckWithCve({ dependencies: { lodash: "^4" } }, ledger, DEFAULT_CONFIG,
    fakeClient({ lodash: [{ id: "GHSA-old", severity: "low" }, { id: "GHSA-new", severity: "high" }] }));
  assert.equal(r.warnings.length, 0);
  assert.ok(r.violations.some((v) => v.package.startsWith("lodash") && /acknowledge/i.test(v.reason)));
});

test("runCheckWithCve adds no CVE violation when advisories are acknowledged", async () => {
  const ledger = { lodash: acked("4.17.20", ["GHSA-old"]) };
  const r = await runCheckWithCve({ dependencies: { lodash: "^4" } }, ledger, DEFAULT_CONFIG,
    fakeClient({ lodash: [{ id: "GHSA-old", severity: "low" }] }));
  assert.deepEqual(r.violations, []);
});

test("runCheckWithCve fails open: client null yields a warning, no violation", async () => {
  const ledger = { lodash: acked("4.17.20", []) };
  const r = await runCheckWithCve({ dependencies: { lodash: "^4" } }, ledger, DEFAULT_CONFIG, fakeClient(null));
  assert.deepEqual(r.violations, []);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /could not verify/i);
});

test("runCheckWithCve still reports base violations (missing entry)", async () => {
  const r = await runCheckWithCve({ dependencies: { lodash: "^4" } }, {}, DEFAULT_CONFIG, fakeClient({}));
  assert.ok(r.violations.some((v) => /not in the ledger/i.test(v.reason)));
});

test("runCheckWithCve queries the approved version, not the package.json range", async () => {
  const ledger = { lodash: acked("4.17.20", []) };
  let seen: Record<string, string[]> | undefined;
  const client: AdvisoryClient = { async fetchBulk(pkgVersions) { seen = pkgVersions; return {}; } };
  await runCheckWithCve({ dependencies: { lodash: "^4" } }, ledger, DEFAULT_CONFIG, client);
  assert.deepEqual(seen, { lodash: ["4.17.20"] });
});

test("runCheckWithCve checks devDependencies too", async () => {
  const ledger = { typescript: acked("5.5.0", ["GHSA-old"]) };
  const r = await runCheckWithCve({ devDependencies: { typescript: "^5" } }, ledger, DEFAULT_CONFIG,
    fakeClient({ typescript: [{ id: "GHSA-new", severity: "high" }] }));
  assert.ok(r.violations.some((v) => v.package.startsWith("typescript") && /acknowledge/i.test(v.reason)));
});

const lowAt = (v: string) => ({ ...base, approvedVersion: v, risk: "low" as const });

test("detectVersionDrift flags a recorded version that no longer satisfies the range", () => {
  const ledger = { lodash: lowAt("4.18.1") };
  const d = detectVersionDrift({ dependencies: { lodash: "^3.0.0" } }, ledger);
  assert.equal(d.length, 1);
  assert.equal(d[0].package, "lodash");
  assert.equal(d[0].recorded, "4.18.1");
});

test("detectVersionDrift is silent when the recorded version still satisfies the range", () => {
  const ledger = { lodash: lowAt("4.18.1") };
  assert.deepEqual(detectVersionDrift({ dependencies: { lodash: "^4.0.0" } }, ledger), []);
});

test("detectVersionDrift skips unrecorded deps and unparseable ranges", () => {
  const ledger = { lodash: lowAt("4.18.1") };
  assert.deepEqual(detectVersionDrift({ dependencies: { lodash: "next", missing: "^1.0.0" } }, ledger), []);
});

test("runCheckWithCve: version drift warns by default, no violation", async () => {
  const ledger = { lodash: lowAt("4.18.1") };
  const r = await runCheckWithCve({ dependencies: { lodash: "^3.0.0" } }, ledger, DEFAULT_CONFIG, fakeClient({}));
  assert.deepEqual(r.violations, []);
  assert.ok(r.warnings.some((w) => /lodash.*re-record/i.test(w)));
});

test("runCheckWithCve: version drift blocks when configured", async () => {
  const ledger = { lodash: lowAt("4.18.1") };
  const cfg = { ...DEFAULT_CONFIG, versionDrift: "block" as const };
  const r = await runCheckWithCve({ dependencies: { lodash: "^3.0.0" } }, ledger, cfg, fakeClient({}));
  assert.ok(r.violations.some((v) => v.package === "lodash" && /re-record/i.test(v.reason)));
});

test("detectUnpinned flags ranged recorded deps, not exact pins or unrecorded ones", () => {
  const ledger = { lodash: lowAt("4.18.1"), ms: lowAt("2.1.3") };
  const u = detectUnpinned({ dependencies: { lodash: "^4.18.1", ms: "2.1.3", missing: "^1.0.0" } }, ledger);
  assert.equal(u.length, 1);
  assert.equal(u[0].package, "lodash");
  assert.equal(u[0].recorded, "4.18.1");
});

test("runCheckWithCve: requirePinned off by default → no pin warning", async () => {
  const ledger = { lodash: lowAt("4.18.1") };
  const r = await runCheckWithCve({ dependencies: { lodash: "^4.18.1" } }, ledger, DEFAULT_CONFIG, fakeClient({}));
  assert.ok(!r.warnings.some((w) => /not pinned/i.test(w)));
});

test("runCheckWithCve: requirePinned warn surfaces unpinned deps, suggests the recorded version", async () => {
  const ledger = { lodash: lowAt("4.18.1") };
  const cfg = { ...DEFAULT_CONFIG, requirePinned: "warn" as const };
  const r = await runCheckWithCve({ dependencies: { lodash: "^4.18.1" } }, ledger, cfg, fakeClient({}));
  assert.deepEqual(r.violations, []);
  assert.ok(r.warnings.some((w) => /lodash.*not pinned.*4\.18\.1/i.test(w)));
});

test("runCheckWithCve: requirePinned block fails on unpinned deps", async () => {
  const ledger = { lodash: lowAt("4.18.1") };
  const cfg = { ...DEFAULT_CONFIG, requirePinned: "block" as const };
  const r = await runCheckWithCve({ dependencies: { lodash: "^4.18.1" } }, ledger, cfg, fakeClient({}));
  assert.ok(r.violations.some((v) => v.package === "lodash" && /not pinned/i.test(v.reason)));
});

test("runCheckWithCve: versionDrift off suppresses the warning", async () => {
  const ledger = { lodash: lowAt("4.18.1") };
  const cfg = { ...DEFAULT_CONFIG, versionDrift: "off" as const };
  const r = await runCheckWithCve({ dependencies: { lodash: "^3.0.0" } }, ledger, cfg, fakeClient({}));
  assert.deepEqual(r.violations, []);
  assert.equal(r.warnings.length, 0);
});

test("CVE drift message lists fix / remove / acknowledge options", async () => {
  const ledger = { lodash: acked("4.17.21", []) };
  const client = fakeClient({ lodash: [{ id: "GHSA-x", severity: "moderate" }] });
  const r = await runCheckWithCve({ dependencies: { lodash: "^4.17.21" } }, ledger, DEFAULT_CONFIG, client);
  const v = r.violations.find((x) => x.package.startsWith("lodash@"));
  assert.ok(v);
  assert.match(v!.reason, /1\. Fix:/);
  assert.match(v!.reason, /3\. Accept:.*acknowledge lodash/);
});
