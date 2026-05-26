import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSafeAdd, parseSpec, runReapprove, helpText } from "../src/cli.js";
import type { AdvisoryClient, Advisory } from "../src/advisories.js";
import { readLedger } from "../src/ledger.js";
import { RegistryUnavailableError, type RegistryClient, type PackageMetadata } from "../src/registry.js";

function fakeRegistry(meta: Partial<PackageMetadata>): RegistryClient {
  return {
    async fetchMetadata(name) {
      return { name, version: "1.0.0", publishedAt: new Date("2020-01-01"), scripts: {}, hasRepository: true, hasLicense: true, deprecated: false, ...meta };
    },
  };
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "ysna-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "host", dependencies: {} }));
  return dir;
}

test("registry unavailable fails closed: no install, no ledger, exit 1", async () => {
  const dir = setup();
  try {
    let installed = false;
    const code = await runSafeAdd({
      spec: "lodash", dev: false, force: null,
      registry: { async fetchMetadata() { throw new RegistryUnavailableError("down"); } },
      installer: { async install() { installed = true; return 0; } },
      now: () => new Date("2026-05-23"), cwd: dir, log: () => {}, err: () => {},
    });
    assert.equal(code, 1);
    assert.equal(installed, false);
    assert.deepEqual(readLedger(dir), {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("allowlisted scoped package skips the gate even with install scripts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "host", dependencies: {} }));
    writeFileSync(join(dir, ".safe-dep.json"), JSON.stringify({ allowScopedPackages: ["@acme/*"] }));
    const code = await runSafeAdd({
      spec: "@acme/widget", dev: false, force: null,
      registry: fakeRegistry({ scripts: { postinstall: "x" } }),
      installer: { async install() { return 0; } },
      now: () => new Date("2026-05-23"), cwd: dir, log: () => {}, err: () => {},
    });
    assert.equal(code, 0);
    const e = readLedger(dir)["@acme/widget"];
    assert.equal(e.risk, "low");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("helpText lists the usage and every command", () => {
  const h = helpText();
  assert.match(h, /Usage:/);
  assert.match(h, /vouch check/);
  assert.match(h, /vouch reapprove/);
  assert.match(h, /--force-with-reason/);
});

test("parseSpec handles plain, versioned, and scoped names", () => {
  assert.deepEqual(parseSpec("lodash"), { name: "lodash", version: undefined });
  assert.deepEqual(parseSpec("lodash@4.17.21"), { name: "lodash", version: "4.17.21" });
  assert.deepEqual(parseSpec("@scope/pkg"), { name: "@scope/pkg", version: undefined });
  assert.deepEqual(parseSpec("@scope/pkg@1.2.3"), { name: "@scope/pkg", version: "1.2.3" });
});

test("safe (old, no scripts) package installs and writes ledger", async () => {
  const dir = setup();
  try {
    const calls: string[][] = [];
    const code = await runSafeAdd({
      spec: "lodash", dev: false, force: null,
      registry: fakeRegistry({}),
      installer: { async install(_pm, args) { calls.push(args); return 0; } },
      now: () => new Date("2026-05-23"), cwd: dir, log: () => {}, err: () => {},
    });
    assert.equal(code, 0);
    assert.deepEqual(calls[0], ["add", "lodash"]);
    const ledger = readLedger(dir);
    assert.equal(ledger.lodash.risk, "low");
    assert.equal(ledger.lodash.approvedVersion, "1.0.0");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("blocked package (install script) does NOT install or write ledger, exits 1", async () => {
  const dir = setup();
  try {
    let installed = false;
    const code = await runSafeAdd({
      spec: "evil", dev: false, force: null,
      registry: fakeRegistry({ scripts: { postinstall: "x" } }),
      installer: { async install() { installed = true; return 0; } },
      now: () => new Date("2026-05-23"), cwd: dir, log: () => {}, err: () => {},
    });
    assert.equal(code, 1);
    assert.equal(installed, false);
    assert.deepEqual(readLedger(dir), {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--force-with-reason allows a blocked package and records high risk + reason", async () => {
  const dir = setup();
  try {
    const code = await runSafeAdd({
      spec: "evil", dev: false, force: "needed for bugfix",
      registry: fakeRegistry({ scripts: { postinstall: "x" } }),
      installer: { async install() { return 0; } },
      now: () => new Date("2026-05-23"), cwd: dir, log: () => {}, err: () => {},
    });
    assert.equal(code, 0);
    const e = readLedger(dir).evil;
    assert.equal(e.risk, "high");
    assert.equal(e.reason, "needed for bugfix");
    assert.equal(e.approvedBy, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ledger is NOT written when install fails", async () => {
  const dir = setup();
  try {
    const code = await runSafeAdd({
      spec: "lodash", dev: false, force: null,
      registry: fakeRegistry({}),
      installer: { async install() { return 7; } },
      now: () => new Date("2026-05-23"), cwd: dir, log: () => {}, err: () => {},
    });
    assert.equal(code, 7);
    assert.deepEqual(readLedger(dir), {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("vouch warns about a CVE on the installed version and points to reapprove, without acknowledging it", async () => {
  const dir = setup();
  try {
    const logs: string[] = [];
    const code = await runSafeAdd({
      spec: "lodash", dev: false, force: null,
      registry: fakeRegistry({}),
      installer: { async install() { return 0; } },
      advisoryClient: { async fetchBulk() { return { lodash: [{ id: "GHSA-x", severity: "high" }] }; } },
      now: () => new Date("2026-05-23"), cwd: dir, log: (s) => logs.push(s), err: () => {},
    });
    assert.equal(code, 0);
    assert.ok(logs.some((s) => /GHSA-x/.test(s)), "names the advisory");
    assert.ok(logs.some((s) => /reapprove/.test(s)), "points to reapprove");
    assert.equal(readLedger(dir).lodash.cve, undefined); // never silently acknowledged
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("vouch fails open when the advisory service is unavailable", async () => {
  const dir = setup();
  try {
    const logs: string[] = [];
    const code = await runSafeAdd({
      spec: "lodash", dev: false, force: null,
      registry: fakeRegistry({}),
      installer: { async install() { return 0; } },
      advisoryClient: { async fetchBulk() { return null; } },
      now: () => new Date("2026-05-23"), cwd: dir, log: (s) => logs.push(s), err: () => {},
    });
    assert.equal(code, 0);
    assert.ok(!logs.some((s) => /advisory|advisories/i.test(s)), "no CVE noise when unverifiable");
    assert.equal(readLedger(dir).lodash.risk, "low");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const reapproveClient = (data: Record<string, Advisory[]> | null): AdvisoryClient => ({ async fetchBulk() { return data; } });

function seedLedger(entry: object): string {
  const cwd = mkdtempSync(join(tmpdir(), "ysna-"));
  mkdirSync(join(cwd, ".security"));
  writeFileSync(join(cwd, ".security", "dependency-approvals.json"),
    JSON.stringify({ lodash: { approvedVersion: "4.17.21", approvedAt: "x", risk: "low", reason: null, approvedBy: null, checks: { ageHours: 1, installScripts: false }, ...entry } }, null, 2));
  return cwd;
}

test("runReapprove records the live advisory set and acknowledgedBy", async () => {
  const cwd = seedLedger({});
  try {
    const log: string[] = [];
    const code = await runReapprove({
      pkg: "lodash", approvedBy: "alice", client: reapproveClient({ lodash: [{ id: "GHSA-new", severity: "high" }] }),
      cwd, now: () => new Date("2026-05-26T00:00:00Z"), log: (s) => log.push(s), err: () => {},
    });
    assert.equal(code, 0);
    assert.ok(log.some((s) => /re-approved/i.test(s)));
    const ledger = JSON.parse(readFileSync(join(cwd, ".security", "dependency-approvals.json"), "utf8"));
    assert.deepEqual(ledger.lodash.cve.acknowledged, [{ id: "GHSA-new", severity: "high" }]);
    assert.equal(ledger.lodash.cve.acknowledgedBy, "alice");
    assert.equal(ledger.lodash.cve.acknowledgedAt, "2026-05-26T00:00:00.000Z");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("runReapprove errors and leaves ledger unchanged when offline", async () => {
  const cwd = seedLedger({});
  try {
    const before = readFileSync(join(cwd, ".security", "dependency-approvals.json"), "utf8");
    const code = await runReapprove({ pkg: "lodash", approvedBy: "alice", client: reapproveClient(null), cwd, now: () => new Date(), log: () => {}, err: () => {} });
    assert.equal(code, 1);
    assert.equal(readFileSync(join(cwd, ".security", "dependency-approvals.json"), "utf8"), before);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("runReapprove errors on unknown package", async () => {
  const cwd = seedLedger({});
  try {
    const errs: string[] = [];
    const code = await runReapprove({ pkg: "ghost", approvedBy: "alice", client: reapproveClient({}), cwd, now: () => new Date(), log: () => {}, err: (s) => errs.push(s) });
    assert.equal(code, 1);
    assert.ok(errs.some((s) => /ghost/.test(s)));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
