// test/adopt-command.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAdopt, countUnrecorded } from "../src/adopt-command.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import { readLedger, type Ledger } from "../src/ledger.js";
import type { WorkspacePackage } from "../src/workspaces.js";
import type { VersionResolver } from "../src/installed.js";
import type { RegistryClient, PackageMetadata } from "../src/registry.js";
import type { AdvisoryClient } from "../src/advisories.js";
import type { ProvenanceClient } from "../src/provenance.js";

const ws = (relPath: string, pkg: object): WorkspacePackage => ({ dir: `/r/${relPath === "." ? "" : relPath}`, relPath, name: null, pkg });

const wsResolver = (map: Record<string, Record<string, string>>): VersionResolver => ({
  resolve: (dir, name) => {
    const rel = dir === "/r/" || dir === "/r" ? "." : dir.slice(3);
    const m = map[rel] ?? {};
    return name in m ? m[name] : null;
  },
});

const reg = (over: (name: string, v: string) => Partial<PackageMetadata> = () => ({})): RegistryClient => ({
  async fetchMetadata(name, v) { return { name, version: v ?? "0.0.0", publishedAt: new Date("2020-01-01T00:00:00Z"), scripts: {}, deprecated: false, attestationsUrl: null, ...over(name, v ?? "0.0.0") }; },
});

function tmp() { return mkdtempSync(join(tmpdir(), "ysna-")); }

function adopt(dir: string, workspaces: WorkspacePackage[], resolver: VersionResolver, extra: Partial<Parameters<typeof runAdopt>[0]> = {}) {
  return runAdopt({
    reason: "adopted: pre-existing dependency", registry: reg(), identity: () => "tester",
    now: () => new Date("2026-05-31T00:00:00Z"), repoRoot: dir, cfg: DEFAULT_CONFIG, workspaces, resolver,
    log: () => {}, err: () => {}, ...extra,
  });
}

test("records an unrecorded installed dep per workspace at the installed version", async () => {
  const dir = tmp();
  try {
    const code = await adopt(dir, [ws("apps/elis", { dependencies: { lodash: "^4" } })], wsResolver({ "apps/elis": { lodash: "4.17.21" } }));
    assert.equal(code, 0);
    const ledger = readLedger(dir);
    assert.ok(ledger["lodash@4.17.21"]);
    assert.equal(ledger["lodash@4.17.21"].reason, "adopted: pre-existing dependency");
    assert.equal(ledger["lodash@4.17.21"].addedBy, "tester");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("dedups one name@version across workspaces into one entry; two versions → two entries", async () => {
  const dir = tmp();
  try {
    const workspaces = [
      ws("apps/elis", { dependencies: { zod: "^3", lodash: "^4" } }),
      ws("libs/api", { dependencies: { zod: "^4", lodash: "^4" } }),
    ];
    const resolver = wsResolver({ "apps/elis": { zod: "3.25.76", lodash: "4.17.21" }, "libs/api": { zod: "4.3.6", lodash: "4.17.21" } });
    await adopt(dir, workspaces, resolver);
    assert.deepEqual(Object.keys(readLedger(dir)).sort(), ["lodash@4.17.21", "zod@3.25.76", "zod@4.3.6"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("idempotent: never clobbers an existing entry (human reason preserved)", async () => {
  const dir = tmp();
  try {
    mkdirSync(join(dir, ".security"), { recursive: true });
    writeFileSync(join(dir, ".security", "dependency-approvals.json"), JSON.stringify({
      version: 2, entries: { "lodash@4.17.21": { name: "lodash", version: "4.17.21", addedAt: "old", risk: "low", reason: "human chose this", addedBy: "alice", checks: { ageHours: 1, installScripts: false } } },
    }));
    await adopt(dir, [ws("apps/elis", { dependencies: { lodash: "^4" } })], wsResolver({ "apps/elis": { lodash: "4.17.21" } }));
    assert.equal(readLedger(dir)["lodash@4.17.21"].reason, "human chose this");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("warns + skips a declared-but-not-installed dep; exit still 0", async () => {
  const dir = tmp();
  try {
    const code = await adopt(dir, [ws("apps/elis", { dependencies: { ghost: "^1" } })], wsResolver({ "apps/elis": {} }));
    assert.equal(code, 0);
    assert.deepEqual(Object.keys(readLedger(dir)), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("never writes a cve field even when advisories exist", async () => {
  const dir = tmp();
  try {
    const advisoryClient: AdvisoryClient = { async fetchBulk() { return { lodash: [{ id: "GHSA-x", severity: "high" }] }; } };
    await adopt(dir, [ws("apps/elis", { dependencies: { lodash: "^4" } })], wsResolver({ "apps/elis": { lodash: "4.17.21" } }), { advisoryClient });
    assert.equal(readLedger(dir)["lodash@4.17.21"].cve, undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("registry error on one candidate skips only it; others recorded", async () => {
  const dir = tmp();
  try {
    const registry: RegistryClient = { async fetchMetadata(name, v) { if (name === "bad") throw new Error("boom"); return { name, version: v ?? "0.0.0", publishedAt: new Date("2020-01-01"), scripts: {}, deprecated: false, attestationsUrl: null }; } };
    await adopt(dir, [ws("apps/elis", { dependencies: { lodash: "^4", bad: "^1" } })], wsResolver({ "apps/elis": { lodash: "4.17.21", bad: "1.0.0" } }), { registry });
    assert.deepEqual(Object.keys(readLedger(dir)), ["lodash@4.17.21"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("install-script dep is recorded high-risk with the blanket reason (so check passes)", async () => {
  const dir = tmp();
  try {
    const registry = reg((name) => name === "esbuild" ? { scripts: { postinstall: "node x" } } : {});
    await adopt(dir, [ws("apps/elis", { dependencies: { esbuild: "^1" } })], wsResolver({ "apps/elis": { esbuild: "1.0.0" } }), { registry });
    const e = readLedger(dir)["esbuild@1.0.0"];
    assert.equal(e.risk, "high");
    assert.equal(e.reason, "adopted: pre-existing dependency");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("skips protocol ranges (workspace:/catalog:)", async () => {
  const dir = tmp();
  try {
    await adopt(dir, [ws("apps/elis", { dependencies: { "@rossum/api": "workspace:*", lodash: "^4" } })], wsResolver({ "apps/elis": { lodash: "4.17.21" } }));
    assert.deepEqual(Object.keys(readLedger(dir)), ["lodash@4.17.21"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("records checks.advisories from the advisory feed", async () => {
  const dir = tmp();
  try {
    const advisoryClient: AdvisoryClient = { async fetchBulk() { return { lodash: [{ id: "GHSA-x", severity: "high" }] }; } };
    await adopt(dir, [ws("apps/elis", { dependencies: { lodash: "^4" } })], wsResolver({ "apps/elis": { lodash: "4.17.21" } }), { advisoryClient });
    assert.deepEqual(readLedger(dir)["lodash@4.17.21"].checks.advisories, [{ id: "GHSA-x", severity: "high" }]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("records an empty advisories baseline when the feed reports none", async () => {
  const dir = tmp();
  try {
    const advisoryClient: AdvisoryClient = { async fetchBulk() { return { }; } };
    await adopt(dir, [ws("apps/elis", { dependencies: { lodash: "^4" } })], wsResolver({ "apps/elis": { lodash: "4.17.21" } }), { advisoryClient });
    assert.deepEqual(readLedger(dir)["lodash@4.17.21"].checks.advisories, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("adopt records provenance evidence per entry", async () => {
  const dir = tmp();
  try {
    const registry = reg((name) => name === "sigstore" ? { attestationsUrl: "https://reg/att/sigstore" } : {});
    const provenanceClient: ProvenanceClient = {
      async fetch() { return { attested: true, sourceRepo: "https://github.com/sigstore/sigstore-js" }; },
    };
    await adopt(
      dir,
      [ws("apps/elis", { dependencies: { sigstore: "^1", lodash: "^4" } })],
      wsResolver({ "apps/elis": { sigstore: "1.0.0", lodash: "4.17.21" } }),
      { registry, provenanceClient },
    );
    const ledger = readLedger(dir);
    assert.deepEqual(ledger["sigstore@1.0.0"].checks.provenance, { attested: true, sourceRepo: "https://github.com/sigstore/sigstore-js" });
    assert.deepEqual(ledger["lodash@4.17.21"].checks.provenance, { attested: false });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("adopt: requireProvenance never affects risk (evidence-only)", async () => {
  const dir = tmp();
  try {
    await adopt(
      dir,
      [ws("apps/elis", { dependencies: { lodash: "^4" } })],
      wsResolver({ "apps/elis": { lodash: "4.17.21" } }),
      { cfg: { ...DEFAULT_CONFIG, requireProvenance: "block" as const } },
    );
    const e = readLedger(dir)["lodash@4.17.21"];
    assert.equal(e.risk, "low");
    assert.deepEqual(e.checks.provenance, { attested: false });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("omits the baseline (no field) when the advisory service is offline", async () => {
  const dir = tmp();
  try {
    const advisoryClient: AdvisoryClient = { async fetchBulk() { return null; } };
    await adopt(dir, [ws("apps/elis", { dependencies: { lodash: "^4" } })], wsResolver({ "apps/elis": { lodash: "4.17.21" } }), { advisoryClient });
    assert.equal(readLedger(dir)["lodash@4.17.21"].checks.advisories, undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("omits the baseline when no advisory client is configured", async () => {
  const dir = tmp();
  try {
    await adopt(dir, [ws("apps/elis", { dependencies: { lodash: "^4" } })], wsResolver({ "apps/elis": { lodash: "4.17.21" } }));
    assert.equal(readLedger(dir)["lodash@4.17.21"].checks.advisories, undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("countUnrecorded counts distinct unrecorded name@version across workspaces", () => {
  const workspaces = [ws("apps/elis", { dependencies: { zod: "^3", lodash: "^4" } }), ws("libs/api", { dependencies: { zod: "^4", lodash: "^4" } })];
  const resolver = wsResolver({ "apps/elis": { zod: "3.25.76", lodash: "4.17.21" }, "libs/api": { zod: "4.3.6", lodash: "4.17.21" } });
  const ledger: Ledger = { "lodash@4.17.21": { name: "lodash", version: "4.17.21", addedAt: "t", risk: "low", reason: null, addedBy: null, checks: { ageHours: 1, installScripts: false } } };
  const { count, workspaceCount } = countUnrecorded(workspaces, ledger, resolver, DEFAULT_CONFIG);
  assert.equal(count, 2);          // zod@3.25.76 + zod@4.3.6 (lodash already recorded)
  assert.equal(workspaceCount, 2);
});
