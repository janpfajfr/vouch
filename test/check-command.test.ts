// test/check-command.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { runCheck, runCheckWithCve, detectUnpinned } from "../src/check-command.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import type { Ledger, LedgerEntry } from "../src/ledger.js";
import type { VersionResolver } from "../src/installed.js";
import type { AdvisoryClient, Advisory } from "../src/advisories.js";

const WS = "/repo";

/** Fake resolver: name -> installed version (or absent = not installed). */
const resolverOf = (map: Record<string, string>): VersionResolver => ({
  resolve: (_dir, name) => (name in map ? map[name] : null),
});

const entry = (name: string, version: string, over: Partial<LedgerEntry> = {}): LedgerEntry => ({
  name, version, addedAt: "t", risk: "low", reason: null, addedBy: null,
  checks: { ageHours: 1, installScripts: false }, ...over,
});

test("unrecorded installed name@version → violation naming the exact version", () => {
  const v = runCheck({ dependencies: { lodash: "^4" } }, WS, {}, resolverOf({ lodash: "4.17.21" }), DEFAULT_CONFIG);
  assert.equal(v.length, 1);
  assert.equal(v[0].package, "lodash@4.17.21");
  assert.match(v[0].reason, /never reviewed/i);
});

test("declared but not installed → violation", () => {
  const v = runCheck({ dependencies: { lodash: "^4" } }, WS, {}, resolverOf({}), DEFAULT_CONFIG);
  assert.equal(v.length, 1);
  assert.equal(v[0].package, "lodash");
  assert.match(v[0].reason, /declared but not installed/i);
});

test("passes when the installed name@version is recorded", () => {
  const ledger: Ledger = { "lodash@4.17.21": entry("lodash", "4.17.21") };
  const v = runCheck({ dependencies: { lodash: "^4" } }, WS, ledger, resolverOf({ lodash: "4.17.21" }), DEFAULT_CONFIG);
  assert.deepEqual(v, []);
});

test("recorded at a DIFFERENT version than installed → still a violation", () => {
  const ledger: Ledger = { "lodash@4.17.20": entry("lodash", "4.17.20") };
  const v = runCheck({ dependencies: { lodash: "^4" } }, WS, ledger, resolverOf({ lodash: "4.17.21" }), DEFAULT_CONFIG);
  assert.equal(v.length, 1);
  assert.equal(v[0].package, "lodash@4.17.21");
});

test("protocol ranges (workspace:/catalog:) are skipped, not violations", () => {
  const v = runCheck({ dependencies: { "@rossum/ui": "workspace:*", foo: "catalog:" } }, WS, {}, resolverOf({}), DEFAULT_CONFIG);
  assert.deepEqual(v, []);
});

test("checks devDependencies and optionalDependencies; not peer by default", () => {
  const v = runCheck(
    { devDependencies: { typescript: "^5" }, optionalDependencies: { fsevents: "^2" }, peerDependencies: { react: "^18" } },
    WS, {}, resolverOf({ typescript: "5.5.0", fsevents: "2.3.3", react: "18.3.0" }), DEFAULT_CONFIG,
  );
  assert.deepEqual(v.map((x) => x.package).sort(), ["fsevents@2.3.3", "typescript@5.5.0"]);
});

test("gates peerDependencies when checkPeerDependencies is enabled", () => {
  const cfg = { ...DEFAULT_CONFIG, checkPeerDependencies: true };
  const v = runCheck({ peerDependencies: { react: "^18" } }, WS, {}, resolverOf({ react: "18.3.0" }), cfg);
  assert.equal(v.length, 1);
  assert.equal(v[0].package, "react@18.3.0");
});

test("high-risk recorded entry without a reason is blocked", () => {
  const ledger: Ledger = { "esbuild@1.0.0": entry("esbuild", "1.0.0", { risk: "high", reason: null }) };
  const v = runCheck({ dependencies: { esbuild: "^1" } }, WS, ledger, resolverOf({ esbuild: "1.0.0" }), DEFAULT_CONFIG);
  assert.ok(v.some((x) => /reason/i.test(x.reason)));
});

test("high-risk recorded entry WITH a reason passes", () => {
  const ledger: Ledger = { "esbuild@1.0.0": entry("esbuild", "1.0.0", { risk: "high", reason: "bundler" }) };
  const v = runCheck({ dependencies: { esbuild: "^1" } }, WS, ledger, resolverOf({ esbuild: "1.0.0" }), DEFAULT_CONFIG);
  assert.deepEqual(v, []);
});

test("single-package violations carry workspace '.'", () => {
  const v = runCheck({ dependencies: { lodash: "^4" } }, WS, {}, resolverOf({ lodash: "4.17.21" }), DEFAULT_CONFIG);
  assert.equal(v[0].workspace, ".");
});

const fakeClient = (data: Record<string, Advisory[]> | null): AdvisoryClient => ({ async fetchBulk() { return data; } });

test("runCheckWithCve queries the INSTALLED version, not the range", async () => {
  const ledger: Ledger = { "lodash@4.17.20": entry("lodash", "4.17.20") };
  let seen: Record<string, string[]> | undefined;
  const client: AdvisoryClient = { async fetchBulk(pv) { seen = pv; return {}; } };
  await runCheckWithCve({ dependencies: { lodash: "^4" } }, WS, ledger, DEFAULT_CONFIG, client, resolverOf({ lodash: "4.17.20" }));
  assert.deepEqual(seen, { lodash: ["4.17.20"] });
});

test("runCheckWithCve turns an unacknowledged advisory into a violation", async () => {
  const ledger: Ledger = { "lodash@4.17.20": entry("lodash", "4.17.20", { cve: { acknowledged: [{ id: "GHSA-old", severity: "low" }], acknowledgedBy: "a", acknowledgedAt: "t", reason: "ok" } }) };
  const r = await runCheckWithCve({ dependencies: { lodash: "^4" } }, WS, ledger, DEFAULT_CONFIG,
    fakeClient({ lodash: [{ id: "GHSA-old", severity: "low" }, { id: "GHSA-new", severity: "high" }] }), resolverOf({ lodash: "4.17.20" }));
  assert.ok(r.violations.some((v) => v.package === "lodash@4.17.20" && /acknowledge/i.test(v.reason)));
});

test("runCheckWithCve fails open when the advisory client returns null", async () => {
  const ledger: Ledger = { "lodash@4.17.20": entry("lodash", "4.17.20") };
  const r = await runCheckWithCve({ dependencies: { lodash: "^4" } }, WS, ledger, DEFAULT_CONFIG, fakeClient(null), resolverOf({ lodash: "4.17.20" }));
  assert.deepEqual(r.violations, []);
  assert.ok(r.warnings.some((w) => /could not verify/i.test(w)));
});

test("runCheckWithCve warns once when the deprecated versionDrift key is set", async () => {
  const cfg = { ...DEFAULT_CONFIG, versionDrift: "block" as const };
  const r = await runCheckWithCve({ dependencies: {} }, WS, {}, cfg, fakeClient({}), resolverOf({}));
  assert.ok(r.warnings.some((w) => /versionDrift is no longer used/i.test(w)));
});

test("detectUnpinned skips protocol ranges and unrecorded deps; flags ranged recorded ones", () => {
  const ledger: Ledger = { "lodash@4.18.1": entry("lodash", "4.18.1") };
  const u = detectUnpinned(
    { dependencies: { lodash: "^4.18.1", "@ui/x": "workspace:*", missing: "^1" } },
    WS, ".", ledger, resolverOf({ lodash: "4.18.1", missing: "1.0.0" }), DEFAULT_CONFIG,
  );
  assert.equal(u.length, 1);
  assert.equal(u[0].package, "lodash");
  assert.equal(u[0].recorded, "4.18.1");
});

test("runCheckWithCve: requirePinned warn surfaces unpinned deps (off by default)", async () => {
  const ledger: Ledger = { "lodash@4.18.1": entry("lodash", "4.18.1") };
  const off = await runCheckWithCve({ dependencies: { lodash: "^4.18.1" } }, WS, ledger, DEFAULT_CONFIG, fakeClient({}), resolverOf({ lodash: "4.18.1" }));
  assert.ok(!off.warnings.some((w) => /not pinned/i.test(w)));
  const cfg = { ...DEFAULT_CONFIG, requirePinned: "warn" as const };
  const on = await runCheckWithCve({ dependencies: { lodash: "^4.18.1" } }, WS, ledger, cfg, fakeClient({}), resolverOf({ lodash: "4.18.1" }));
  assert.ok(on.warnings.some((w) => /lodash.*not pinned.*4\.18\.1/i.test(w)));
});

test("CVE drift message keeps fix/remove/acknowledge options", async () => {
  const ledger: Ledger = { "lodash@4.17.21": entry("lodash", "4.17.21") };
  const r = await runCheckWithCve({ dependencies: { lodash: "^4.17.21" } }, WS, ledger, DEFAULT_CONFIG,
    fakeClient({ lodash: [{ id: "GHSA-x", severity: "moderate" }] }), resolverOf({ lodash: "4.17.21" }));
  const v = r.violations.find((x) => x.package === "lodash@4.17.21");
  assert.ok(v);
  assert.match(v!.reason, /1\. Fix:/);
  assert.match(v!.reason, /3\. Accept:.*acknowledge lodash/);
});
