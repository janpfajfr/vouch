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

import { runCheckWithCve } from "../src/check-command.js";
import type { AdvisoryClient, Advisory } from "../src/advisories.js";

const fakeClient = (data: Record<string, Advisory[]> | null): AdvisoryClient => ({
  async fetchBulk() { return data; },
});

const acked = (version: string, ids: string[]) => ({
  ...base, approvedVersion: version, risk: "low" as const,
  cve: { acknowledged: ids.map((id) => ({ id, severity: "low" as const })), acknowledgedBy: "alice", acknowledgedAt: "x" },
});

test("runCheckWithCve turns an unacknowledged advisory into a violation", async () => {
  const ledger = { lodash: acked("4.17.20", ["GHSA-old"]) };
  const r = await runCheckWithCve({ dependencies: { lodash: "^4" } }, ledger, DEFAULT_CONFIG,
    fakeClient({ lodash: [{ id: "GHSA-old", severity: "low" }, { id: "GHSA-new", severity: "high" }] }));
  assert.equal(r.warnings.length, 0);
  assert.ok(r.violations.some((v) => v.package === "lodash" && /reapprove/i.test(v.reason)));
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
  assert.ok(r.violations.some((v) => /no ledger entry/i.test(v.reason)));
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
  assert.ok(r.violations.some((v) => v.package === "typescript" && /reapprove/i.test(v.reason)));
});

test("high-risk passes when approved via the new approval record", () => {
  const ledger: Ledger = { evil: { ...base, risk: "high", reason: "needed", approvedBy: null,
    approval: { by: "Jan <j@x>", via: "git-config", at: "t" } } };
  const v = runCheck({ dependencies: { evil: "1" } }, ledger, DEFAULT_CONFIG);
  assert.deepEqual(v, []);
});

import { verifyApprovals } from "../src/check-command.js";
import type { ReviewClient } from "../src/review.js";

const reviewClient = (r: string[] | null): ReviewClient => ({ async approvingReviewers() { return r; } });
const highApproved: Ledger = { evil: { ...base, risk: "high", reason: "needed",
  approval: { by: "Jan <j@x>", via: "git-config", at: "t" } } };
const onCfg = (req: boolean, allowed: string[] = []) => ({ ...DEFAULT_CONFIG, approval: { verify: "github-review" as const, requireVerifiedApproval: req, allowedApprovers: allowed } });

test("verifyApprovals: verified reviewer => no violation, no warning", async () => {
  const r = await verifyApprovals(highApproved, onCfg(false), reviewClient(["alice"]));
  assert.deepEqual(r.violations, []);
  assert.deepEqual(r.warnings, []);
});

test("verifyApprovals: cannot verify (null) => warn, no violation (fail-open)", async () => {
  const r = await verifyApprovals(highApproved, onCfg(false), reviewClient(null));
  assert.deepEqual(r.violations, []);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /could not verify/i);
});

test("verifyApprovals: no permitted reviewer, default => warn only", async () => {
  const r = await verifyApprovals(highApproved, onCfg(false), reviewClient([]));
  assert.deepEqual(r.violations, []);
  assert.equal(r.warnings.length, 1);
});

test("verifyApprovals: no permitted reviewer + requireVerifiedApproval => violation", async () => {
  const r = await verifyApprovals(highApproved, onCfg(true), reviewClient([]));
  assert.ok(r.violations.some((v) => /verified/i.test(v.reason)));
});

test("verifyApprovals: verify off => no-op", async () => {
  const r = await verifyApprovals(highApproved, DEFAULT_CONFIG, reviewClient(null));
  assert.deepEqual(r, { violations: [], warnings: [] });
});

test("verifyApprovals: no high-risk-approved entries => no-op even when on", async () => {
  const r = await verifyApprovals({ ok: { ...base, risk: "low" } }, onCfg(true), reviewClient([]));
  assert.deepEqual(r, { violations: [], warnings: [] });
});
