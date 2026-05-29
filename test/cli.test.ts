import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSafeAdd, parseSpec, runAcknowledge, helpText, parseAddArgs, runInit } from "../src/cli.js";
import type { AdvisoryClient, Advisory } from "../src/advisories.js";
import { readLedger } from "../src/ledger.js";
import { RegistryUnavailableError, type RegistryClient, type PackageMetadata } from "../src/registry.js";

function fakeRegistry(meta: Partial<PackageMetadata>): RegistryClient {
  return {
    async fetchMetadata(name) {
      return { name, version: "1.0.0", publishedAt: new Date("2020-01-01"), scripts: {}, deprecated: false, ...meta };
    },
  };
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "ysna-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "host", dependencies: {} }));
  return dir;
}

const noIdentity = () => null;

test("registry unavailable fails closed: no install, no ledger, exit 1", async () => {
  const dir = setup();
  try {
    let installed = false;
    const code = await runSafeAdd({
      spec: "lodash", dev: false, force: null,
      registry: { async fetchMetadata() { throw new RegistryUnavailableError("down"); } },
      installer: { async install() { installed = true; return 0; } },
      identity: noIdentity,
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
      identity: noIdentity,
      now: () => new Date("2026-05-23"), cwd: dir, log: () => {}, err: () => {},
    });
    assert.equal(code, 0);
    const e = readLedger(dir)["@acme/widget"];
    assert.equal(e.risk, "low");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("helpText lists the usage and the foundation command set", () => {
  const h = helpText();
  assert.match(h, /Usage:/);
  assert.match(h, /vouch check/);
  assert.match(h, /vouch acknowledge/);
  assert.doesNotMatch(h, /vouch approve/);
  assert.doesNotMatch(h, /reapprove/);
  assert.match(h, /--force-with-reason/);
});

test("parseSpec handles plain, versioned, and scoped names", () => {
  assert.deepEqual(parseSpec("lodash"), { name: "lodash", version: undefined });
  assert.deepEqual(parseSpec("lodash@4.17.21"), { name: "lodash", version: "4.17.21" });
  assert.deepEqual(parseSpec("@scope/pkg"), { name: "@scope/pkg", version: undefined });
  assert.deepEqual(parseSpec("@scope/pkg@1.2.3"), { name: "@scope/pkg", version: "1.2.3" });
});

test("runSafeAdd surfaces a deprecation note and records medium risk", async () => {
  const dir = setup();
  try {
    const logs: string[] = [];
    const code = await runSafeAdd({
      spec: "request", dev: false, force: null,
      registry: fakeRegistry({ deprecated: true }),
      installer: { async install() { return 0; } },
      identity: noIdentity,
      now: () => new Date("2026-05-23"), cwd: dir, log: (s) => logs.push(s), err: () => {},
    });
    assert.equal(code, 0);
    assert.ok(logs.some((s) => /deprecated/i.test(s)), "notes the deprecation");
    assert.equal(readLedger(dir).request.risk, "medium");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cveAtInstall=block: a critical advisory blocks the install (no ledger written)", async () => {
  const dir = setup();
  writeFileSync(join(dir, ".safe-dep.json"), JSON.stringify({ cveAtInstall: "block" }));
  try {
    let installed = false;
    const code = await runSafeAdd({
      spec: "minimist", dev: false, force: null,
      registry: fakeRegistry({}),
      installer: { async install() { installed = true; return 0; } },
      advisoryClient: { async fetchBulk() { return { minimist: [{ id: "GHSA-x", severity: "critical" }] }; } },
      identity: noIdentity,
      now: () => new Date("2026-05-28"), cwd: dir, log: () => {}, err: () => {},
    });
    assert.equal(code, 1);
    assert.equal(installed, false);
    assert.deepEqual(readLedger(dir), {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cveAtInstall=block + --force-with-reason: install proceeds and reason is recorded", async () => {
  const dir = setup();
  writeFileSync(join(dir, ".safe-dep.json"), JSON.stringify({ cveAtInstall: "block" }));
  try {
    const code = await runSafeAdd({
      spec: "minimist", dev: false, force: "needed; not on hot path",
      registry: fakeRegistry({}),
      installer: { async install() { return 0; } },
      advisoryClient: { async fetchBulk() { return { minimist: [{ id: "GHSA-x", severity: "critical" }] }; } },
      identity: noIdentity,
      now: () => new Date("2026-05-28"), cwd: dir, log: () => {}, err: () => {},
    });
    assert.equal(code, 0);
    const e = readLedger(dir).minimist;
    assert.equal(e.reason, "needed; not on hot path");
    assert.equal(e.risk, "high", "block-level CVE finding should bump risk to high");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cveAtInstall=block: moderate advisory stays a warn (below default 'high' threshold)", async () => {
  const dir = setup();
  writeFileSync(join(dir, ".safe-dep.json"), JSON.stringify({ cveAtInstall: "block" }));
  try {
    const code = await runSafeAdd({
      spec: "minimist", dev: false, force: null,
      registry: fakeRegistry({}),
      installer: { async install() { return 0; } },
      advisoryClient: { async fetchBulk() { return { minimist: [{ id: "GHSA-x", severity: "moderate" }] }; } },
      identity: noIdentity,
      now: () => new Date("2026-05-28"), cwd: dir, log: () => {}, err: () => {},
    });
    assert.equal(code, 0);
    assert.equal(readLedger(dir).minimist.approvedVersion, "1.0.0");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runSafeAdd records addedBy from the injected git identity", async () => {
  const dir = setup();
  try {
    await runSafeAdd({
      spec: "ms", dev: false, force: null,
      registry: fakeRegistry({}),
      installer: { async install() { return 0; } },
      identity: () => "Jan Pfajfr <jan@example.com>",
      now: () => new Date("2026-05-27T10:00:00Z"), cwd: dir, log: () => {}, err: () => {},
    });
    assert.equal(readLedger(dir).ms.addedBy, "Jan Pfajfr <jan@example.com>");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("safe (old, no scripts) package installs and writes ledger", async () => {
  const dir = setup();
  try {
    const calls: string[][] = [];
    const code = await runSafeAdd({
      spec: "lodash", dev: false, force: null,
      registry: fakeRegistry({}),
      installer: { async install(_pm, args) { calls.push(args); return 0; } },
      identity: noIdentity,
      now: () => new Date("2026-05-23"), cwd: dir, log: () => {}, err: () => {},
    });
    assert.equal(code, 0);
    assert.deepEqual(calls[0], ["install", "lodash"]);
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
      identity: noIdentity,
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
      identity: noIdentity,
      now: () => new Date("2026-05-23"), cwd: dir, log: () => {}, err: () => {},
    });
    assert.equal(code, 0);
    const e = readLedger(dir).evil;
    assert.equal(e.risk, "high");
    assert.equal(e.reason, "needed for bugfix");
    assert.equal(e.addedBy, null);
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
      identity: noIdentity,
      now: () => new Date("2026-05-23"), cwd: dir, log: () => {}, err: () => {},
    });
    assert.equal(code, 7);
    assert.deepEqual(readLedger(dir), {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("vouch warns about a CVE on the installed version and points to acknowledge, without acknowledging it", async () => {
  const dir = setup();
  try {
    const logs: string[] = [];
    const code = await runSafeAdd({
      spec: "lodash", dev: false, force: null,
      registry: fakeRegistry({}),
      installer: { async install() { return 0; } },
      advisoryClient: { async fetchBulk() { return { lodash: [{ id: "GHSA-x", severity: "high" }] }; } },
      identity: noIdentity,
      now: () => new Date("2026-05-23"), cwd: dir, log: (s) => logs.push(s), err: () => {},
    });
    assert.equal(code, 0);
    assert.ok(logs.some((s) => /GHSA-x/.test(s)), "names the advisory");
    assert.ok(logs.some((s) => /acknowledge/.test(s)), "points to acknowledge");
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
      identity: noIdentity,
      now: () => new Date("2026-05-23"), cwd: dir, log: (s) => logs.push(s), err: () => {},
    });
    assert.equal(code, 0);
    assert.ok(!logs.some((s) => /advisory|advisories/i.test(s)), "no CVE noise when unverifiable");
    assert.equal(readLedger(dir).lodash.risk, "low");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const ackClient = (data: Record<string, Advisory[]> | null): AdvisoryClient => ({ async fetchBulk() { return data; } });

function seedLedger(entry: object): string {
  const cwd = mkdtempSync(join(tmpdir(), "ysna-"));
  mkdirSync(join(cwd, ".security"));
  writeFileSync(join(cwd, ".security", "dependency-approvals.json"),
    JSON.stringify({ lodash: { approvedVersion: "4.17.21", addedAt: "x", risk: "low", reason: null, addedBy: null, checks: { ageHours: 1, installScripts: false }, ...entry } }, null, 2));
  return cwd;
}

test("runAcknowledge requires a reason and records git identity + advisories", async () => {
  const cwd = seedLedger({});
  try {
    const log: string[] = [];
    const code = await runAcknowledge({
      pkg: "lodash", reason: "dev-only, path unreachable",
      identity: () => "Jan Pfajfr <jan@example.com>",
      client: ackClient({ lodash: [{ id: "GHSA-x", severity: "high" }] }),
      cwd, now: () => new Date("2026-05-27T10:00:00Z"), log: (s) => log.push(s), err: () => {},
    });
    assert.equal(code, 0);
    assert.ok(log.some((s) => /acknowledged/i.test(s)));
    const cve = readLedger(cwd).lodash.cve;
    assert.equal(cve?.reason, "dev-only, path unreachable");
    assert.equal(cve?.acknowledgedBy, "Jan Pfajfr <jan@example.com>");
    assert.equal(cve?.acknowledged.length, 1);
    assert.equal(cve?.acknowledgedAt, "2026-05-27T10:00:00.000Z");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("runAcknowledge errors and leaves ledger unchanged when offline", async () => {
  const cwd = seedLedger({});
  try {
    const before = readFileSync(join(cwd, ".security", "dependency-approvals.json"), "utf8");
    const code = await runAcknowledge({ pkg: "lodash", reason: "x", identity: () => null, client: ackClient(null), cwd, now: () => new Date(), log: () => {}, err: () => {} });
    assert.equal(code, 1);
    assert.equal(readFileSync(join(cwd, ".security", "dependency-approvals.json"), "utf8"), before);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("runAcknowledge errors on unknown package", async () => {
  const cwd = seedLedger({});
  try {
    const errs: string[] = [];
    const code = await runAcknowledge({ pkg: "ghost", reason: "x", identity: () => null, client: ackClient({}), cwd, now: () => new Date(), log: () => {}, err: (s) => errs.push(s) });
    assert.equal(code, 1);
    assert.ok(errs.some((s) => /ghost/.test(s)));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("parseAddArgs: package then reason (correct order)", () => {
  assert.deepEqual(parseAddArgs(["esbuild", "--force-with-reason", "needs build"]),
    { spec: "esbuild", dev: false, force: "needs build" });
});

test("parseAddArgs: -D marks devDependency", () => {
  assert.deepEqual(parseAddArgs(["lodash", "-D"]), { spec: "lodash", dev: true, force: null });
});

test("parseAddArgs: flag value is excluded from the package positional", () => {
  const r = parseAddArgs(["--force-with-reason", "esbuild", "x"]);
  assert.equal(r.force, "esbuild");
  assert.equal(r.spec, "x");
});

test("parseAddArgs: more than one package positional is an error", () => {
  const r = parseAddArgs(["a", "b"]);
  assert.match(r.error ?? "", /extra argument/i);
});

test("parseAddArgs: no package yields the no-package marker", () => {
  assert.equal(parseAddArgs(["--force-with-reason", "x"]).error, "no-package");
});

test("runInit: writes a JSDoc-typed plain export when vouch isn't installed locally", () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-init-novouch-"));
  try {
    const code = runInit({ cwd: dir, log: () => {}, err: () => {} });
    assert.equal(code, 0);
    const content = readFileSync(join(dir, "vouch.config.mjs"), "utf8");
    // No runtime import → loads even without `npm install -D @vouchjs/vouch`.
    assert.doesNotMatch(content, /import \{ defineConfig \}/);
    assert.match(content, /@type \{import\("@vouchjs\/vouch"\)\.Config\}/);
    assert.match(content, /export default \{/);
    // Every Config key visible, with its default literal value
    for (const key of ["packageManager", "allowScopedPackages", "minimumVersionAgeHours", "warnVersionAgeHours", "blockInstallScripts", "requireCooldownConfigured", "versionDrift", "requirePinned", "cveAtInstall", "cveAtInstallMinSeverity"]) {
      assert.match(content, new RegExp(`\\b${key}:`), `expected ${key} in the generated config`);
    }
    assert.match(content, /packageManager: "auto"/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("runInit: uses the defineConfig import when vouch IS installed locally", () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-init-hasvouch-"));
  try {
    // Simulate `npm install -D @vouchjs/vouch` — a node_modules/@vouchjs/vouch entry exists.
    mkdirSync(join(dir, "node_modules", "@vouchjs", "vouch"), { recursive: true });
    runInit({ cwd: dir, log: () => {}, err: () => {} });
    const content = readFileSync(join(dir, "vouch.config.mjs"), "utf8");
    assert.match(content, /import \{ defineConfig \} from "@vouchjs\/vouch"/);
    assert.match(content, /export default defineConfig\({/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("runInit: picks .js when package.json declares type=module, .mjs otherwise", () => {
  const dirMjs = mkdtempSync(join(tmpdir(), "ysna-init-mjs-"));
  const dirJs = mkdtempSync(join(tmpdir(), "ysna-init-js-"));
  try {
    writeFileSync(join(dirMjs, "package.json"), JSON.stringify({ name: "x" }));
    runInit({ cwd: dirMjs, log: () => {}, err: () => {} });
    assert.ok(readFileSync(join(dirMjs, "vouch.config.mjs"), "utf8"));

    writeFileSync(join(dirJs, "package.json"), JSON.stringify({ name: "x", type: "module" }));
    runInit({ cwd: dirJs, log: () => {}, err: () => {} });
    assert.ok(readFileSync(join(dirJs, "vouch.config.js"), "utf8"));
  } finally {
    rmSync(dirMjs, { recursive: true, force: true });
    rmSync(dirJs, { recursive: true, force: true });
  }
});

test("runInit: seeds detected packageManager into the generated config", () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-init-seed-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ packageManager: "pnpm@9.5.0" }));
    runInit({ cwd: dir, log: () => {}, err: () => {} });
    const content = readFileSync(join(dir, "vouch.config.mjs"), "utf8");
    assert.match(content, /packageManager: "pnpm"/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("runInit: refuses to overwrite an existing vouch.config or legacy .safe-dep.json", () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-init-skip-"));
  try {
    writeFileSync(join(dir, ".safe-dep.json"), JSON.stringify({ versionDrift: "block" }));
    const logs: string[] = [];
    const code = runInit({ cwd: dir, log: (s) => logs.push(s), err: () => {} });
    assert.equal(code, 0);
    assert.ok(logs.some((s) => /already/i.test(s)));
    // didn't write a new config file
    assert.throws(() => readFileSync(join(dir, "vouch.config.mjs"), "utf8"));
    assert.throws(() => readFileSync(join(dir, "vouch.config.js"), "utf8"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("parseAddArgs: empty or flag-like reason is rejected", () => {
  assert.match(parseAddArgs(["a", "--force-with-reason", "-D"]).error ?? "", /reason/i);
});
