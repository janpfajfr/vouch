import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSafeAdd, parseSpec, runAcknowledge, helpText, parseAddArgs, runInit } from "../src/cli.js";
import type { AdvisoryClient, Advisory } from "../src/advisories.js";
import { readLedger } from "../src/ledger.js";
import { RegistryUnavailableError, type RegistryClient, type PackageMetadata } from "../src/registry.js";
import type { ProvenanceClient } from "../src/provenance.js";

function fakeRegistry(meta: Partial<PackageMetadata>): RegistryClient {
  return {
    async fetchMetadata(name) {
      return { name, version: "1.0.0", publishedAt: new Date("2020-01-01"), scripts: {}, deprecated: false, attestationsUrl: null, ...meta };
    },
  };
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "ysna-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "host", dependencies: {} }));
  return dir;
}

const noIdentity = () => null;

const claimClient: ProvenanceClient = {
  async fetch() { return { attested: true, sourceRepo: "https://github.com/sigstore/sigstore-js", sourceCommit: "7d2900eca1c22b3f87c13987c8d4b7c9a29b733a", workflow: ".github/workflows/release.yml@refs/heads/main" }; },
};

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
    const e = readLedger(dir)["@acme/widget@1.0.0"];
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
  assert.match(h, /vouch adopt/);
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
    assert.equal(readLedger(dir)["request@1.0.0"].risk, "medium");
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
    const e = readLedger(dir)["minimist@1.0.0"];
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
    assert.equal(readLedger(dir)["minimist@1.0.0"].version, "1.0.0");
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
    assert.equal(readLedger(dir)["ms@1.0.0"].addedBy, "Jan Pfajfr <jan@example.com>");
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
    assert.equal(ledger["lodash@1.0.0"].risk, "low");
    assert.equal(ledger["lodash@1.0.0"].version, "1.0.0");
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
    const e = readLedger(dir)["evil@1.0.0"];
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
    assert.equal(readLedger(dir)["lodash@1.0.0"].cve, undefined); // never silently acknowledged
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
    assert.equal(readLedger(dir)["lodash@1.0.0"].risk, "low");
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
      pkg: "lodash@4.17.21", reason: "dev-only, path unreachable",
      identity: () => "Jan Pfajfr <jan@example.com>",
      client: ackClient({ lodash: [{ id: "GHSA-x", severity: "high" }] }),
      cwd, now: () => new Date("2026-05-27T10:00:00Z"), log: (s) => log.push(s), err: () => {},
    });
    assert.equal(code, 0);
    assert.ok(log.some((s) => /acknowledged/i.test(s)));
    const cve = readLedger(cwd)["lodash@4.17.21"].cve;
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
    const code = await runAcknowledge({ pkg: "lodash@4.17.21", reason: "x", identity: () => null, client: ackClient(null), cwd, now: () => new Date(), log: () => {}, err: () => {} });
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
    const code = await runAcknowledge({ pkg: "ghost@1.0.0", reason: "x", identity: () => null, client: ackClient({}), cwd, now: () => new Date(), log: () => {}, err: (s) => errs.push(s) });
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

test("runInit: writes a JSDoc-typed plain export when vouch isn't installed locally", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-init-novouch-"));
  try {
    const code = await runInit({ cwd: dir, log: () => {}, err: () => {} });
    assert.equal(code, 0);
    const content = readFileSync(join(dir, "vouch.config.mjs"), "utf8");
    // No runtime import → loads even without `npm install -D @vouchjs/vouch`.
    assert.doesNotMatch(content, /import \{ defineConfig \}/);
    assert.match(content, /@type \{import\("@vouchjs\/vouch"\)\.Config\}/);
    assert.match(content, /export default \{/);
    // Every Config key visible, with its default literal value
    for (const key of ["packageManager", "allowScopedPackages", "minimumVersionAgeHours", "warnVersionAgeHours", "blockInstallScripts", "requireCooldownConfigured", "requirePinned", "cveAtInstall", "cveAtInstallMinSeverity"]) {
      assert.match(content, new RegExp(`\\b${key}:`), `expected ${key} in the generated config`);
    }
    assert.match(content, /packageManager: "auto"/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("runInit: uses the defineConfig import when vouch IS installed locally", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-init-hasvouch-"));
  try {
    // Simulate `npm install -D @vouchjs/vouch` — a node_modules/@vouchjs/vouch entry exists.
    mkdirSync(join(dir, "node_modules", "@vouchjs", "vouch"), { recursive: true });
    await runInit({ cwd: dir, log: () => {}, err: () => {} });
    const content = readFileSync(join(dir, "vouch.config.mjs"), "utf8");
    assert.match(content, /import \{ defineConfig \} from "@vouchjs\/vouch"/);
    assert.match(content, /export default defineConfig\({/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("runInit: picks .js when package.json declares type=module, .mjs otherwise", async () => {
  const dirMjs = mkdtempSync(join(tmpdir(), "ysna-init-mjs-"));
  const dirJs = mkdtempSync(join(tmpdir(), "ysna-init-js-"));
  try {
    writeFileSync(join(dirMjs, "package.json"), JSON.stringify({ name: "x" }));
    await runInit({ cwd: dirMjs, log: () => {}, err: () => {} });
    assert.ok(readFileSync(join(dirMjs, "vouch.config.mjs"), "utf8"));

    writeFileSync(join(dirJs, "package.json"), JSON.stringify({ name: "x", type: "module" }));
    await runInit({ cwd: dirJs, log: () => {}, err: () => {} });
    assert.ok(readFileSync(join(dirJs, "vouch.config.js"), "utf8"));
  } finally {
    rmSync(dirMjs, { recursive: true, force: true });
    rmSync(dirJs, { recursive: true, force: true });
  }
});

test("runInit: seeds detected packageManager into the generated config", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-init-seed-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ packageManager: "pnpm@9.5.0" }));
    await runInit({ cwd: dir, log: () => {}, err: () => {} });
    const content = readFileSync(join(dir, "vouch.config.mjs"), "utf8");
    assert.match(content, /packageManager: "pnpm"/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("runInit: refuses to overwrite an existing vouch.config or legacy .safe-dep.json", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-init-skip-"));
  try {
    writeFileSync(join(dir, ".safe-dep.json"), JSON.stringify({ versionDrift: "block" }));
    const logs: string[] = [];
    const code = await runInit({ cwd: dir, log: (s) => logs.push(s), err: () => {} });
    assert.equal(code, 0);
    assert.ok(logs.some((s) => /already/i.test(s)));
    // didn't write a new config file
    assert.throws(() => readFileSync(join(dir, "vouch.config.mjs"), "utf8"));
    assert.throws(() => readFileSync(join(dir, "vouch.config.js"), "utf8"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("runInit: creates AGENTS.md with the vouch dependency rules when none exists", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-init-agents-new-"));
  try {
    await runInit({ cwd: dir, log: () => {}, err: () => {} });
    const content = readFileSync(join(dir, "AGENTS.md"), "utf8");
    assert.match(content, /<!-- vouch:begin -->/);
    assert.match(content, /<!-- vouch:end -->/);
    assert.match(content, /@vouchjs\/vouch/);
    // The core directive: don't install directly.
    assert.match(content, /MUST NOT/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("runInit: appends a marked vouch section to an existing AGENTS.md, preserving prior content", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-init-agents-append-"));
  try {
    const existing = "# House rules\n\nAlways run the linter before committing.\n";
    writeFileSync(join(dir, "AGENTS.md"), existing);
    await runInit({ cwd: dir, log: () => {}, err: () => {} });
    const content = readFileSync(join(dir, "AGENTS.md"), "utf8");
    // Original content untouched...
    assert.match(content, /Always run the linter before committing\./);
    // ...and the vouch section appended after it.
    assert.match(content, /<!-- vouch:begin -->[\s\S]*@vouchjs\/vouch[\s\S]*<!-- vouch:end -->/);
    assert.ok(content.indexOf("House rules") < content.indexOf("vouch:begin"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("runInit: is idempotent — does not duplicate the vouch section if already present", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-init-agents-idem-"));
  try {
    // First init seeds the section.
    await runInit({ cwd: dir, log: () => {}, err: () => {} });
    const first = readFileSync(join(dir, "AGENTS.md"), "utf8");
    // Remove the config so a second init runs its full path again, then re-run.
    rmSync(join(dir, "vouch.config.mjs"), { force: true });
    await runInit({ cwd: dir, log: () => {}, err: () => {} });
    const second = readFileSync(join(dir, "AGENTS.md"), "utf8");
    assert.equal(second, first, "AGENTS.md should be unchanged on a second init");
    // Exactly one marker pair.
    assert.equal(second.match(/<!-- vouch:begin -->/g)?.length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("parseAddArgs: empty or flag-like reason is rejected", () => {
  assert.match(parseAddArgs(["a", "--force-with-reason", "-D"]).error ?? "", /reason/i);
});

// Model C — keyed ledger (name@version) tests

const regV2 = (version: string): RegistryClient => ({
  async fetchMetadata(name) { return { name, version, publishedAt: new Date("2020-01-01T00:00:00Z"), scripts: {}, deprecated: false, attestationsUrl: null }; },
});
const noInstallV2 = { async install() { return 0; } };

test("runSafeAdd writes a name@version-keyed v2 entry with name+version fields", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({}));
    const code = await runSafeAdd({
      spec: "lodash", dev: false, force: null, registry: regV2("4.17.21"), installer: noInstallV2,
      now: () => new Date("2026-05-31T00:00:00Z"), identity: () => null, cwd: dir,
      log: () => {}, err: () => {},
    });
    assert.equal(code, 0);
    const file = JSON.parse(readFileSync(join(dir, ".security", "dependency-approvals.json"), "utf8"));
    assert.equal(file.version, 2);
    assert.ok(file.entries["lodash@4.17.21"]);
    assert.equal(file.entries["lodash@4.17.21"].name, "lodash");
    assert.equal(file.entries["lodash@4.17.21"].version, "4.17.21");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

const ackClientV2 = (ids: string[]): AdvisoryClient => ({ async fetchBulk() { return { lodash: ids.map((id) => ({ id, severity: "low" as const })) }; } });

test("runAcknowledge targets the explicit name@version spec", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-"));
  try {
    mkdirSync(join(dir, ".security"), { recursive: true });
    writeFileSync(join(dir, ".security", "dependency-approvals.json"), JSON.stringify({
      version: 2, entries: { "lodash@4.17.20": { name: "lodash", version: "4.17.20", addedAt: "t", risk: "low", reason: null, addedBy: null, checks: { ageHours: 1, installScripts: false } } },
    }));
    const code = await runAcknowledge({
      pkg: "lodash@4.17.20", reason: "accepted", identity: () => "a", client: ackClientV2(["GHSA-x"]),
      now: () => new Date("2026-05-31T00:00:00Z"), cwd: dir, log: () => {}, err: () => {},
    });
    assert.equal(code, 0);
    const file = JSON.parse(readFileSync(join(dir, ".security", "dependency-approvals.json"), "utf8"));
    assert.deepEqual(file.entries["lodash@4.17.20"].cve.acknowledged, [{ id: "GHSA-x", severity: "low" }]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

const reg = regV2;
const noInstall = noInstallV2;

test("runSafeAdd records checks.advisories from the install-time advisory fetch", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-add-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "host", dependencies: {} }));
    const advisoryClient = { async fetchBulk() { return { lodash: [{ id: "GHSA-x", severity: "moderate" as const }] }; } };
    await runSafeAdd({
      spec: "lodash@4.17.21", dev: false, force: null,
      registry: { async fetchMetadata(name) { return { name, version: "4.17.21", publishedAt: new Date("2020-01-01"), scripts: {}, deprecated: false, attestationsUrl: null }; } },
      installer: { async install() { return 0; } },
      advisoryClient,
      identity: noIdentity,
      now: () => new Date("2026-05-31T00:00:00Z"), cwd: dir, log: () => {}, err: () => {},
    });
    assert.deepEqual(readLedger(dir)["lodash@4.17.21"].checks.advisories, [{ id: "GHSA-x", severity: "moderate" }]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("runSafeAdd writes to the injected ledgerDir (root), not cwd", async () => {
  const root = mkdtempSync(join(tmpdir(), "ysna-"));
  try {
    const sub = join(root, "apps", "elis");
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, "package.json"), JSON.stringify({}));
    const code = await runSafeAdd({
      spec: "lodash", dev: false, force: null, registry: reg("4.17.21"), installer: noInstall,
      now: () => new Date("2026-05-31T00:00:00Z"), identity: () => null, cwd: sub, ledgerDir: root,
      log: () => {}, err: () => {},
    });
    assert.equal(code, 0);
    const file = JSON.parse(readFileSync(join(root, ".security", "dependency-approvals.json"), "utf8"));
    assert.ok(file.entries["lodash@4.17.21"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("records {attested:false} provenance and notes it when the version has no attestation", async () => {
  const dir = setup();
  try {
    const logs: string[] = [];
    const code = await runSafeAdd({
      spec: "lodash", dev: false, force: null,
      registry: fakeRegistry({}),
      installer: { async install() { return 0; } },
      identity: noIdentity,
      now: () => new Date("2026-06-12"), cwd: dir, log: (s) => logs.push(s), err: () => {},
    });
    assert.equal(code, 0);
    assert.deepEqual(readLedger(dir)["lodash@1.0.0"].checks.provenance, { attested: false });
    assert.ok(logs.some((s) => /no provenance attestation/.test(s)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("records the parsed claim and notes the source repo when attested", async () => {
  const dir = setup();
  try {
    const logs: string[] = [];
    const code = await runSafeAdd({
      spec: "sigstore", dev: false, force: null,
      registry: fakeRegistry({ attestationsUrl: "https://registry.npmjs.org/-/npm/v1/attestations/sigstore@1.0.0" }),
      installer: { async install() { return 0; } },
      provenanceClient: claimClient,
      identity: noIdentity,
      now: () => new Date("2026-06-12"), cwd: dir, log: (s) => logs.push(s), err: () => {},
    });
    assert.equal(code, 0);
    assert.equal(readLedger(dir)["sigstore@1.0.0"].checks.provenance?.sourceRepo, "https://github.com/sigstore/sigstore-js");
    assert.ok(logs.some((s) => /built from github\.com\/sigstore\/sigstore-js@7d2900e/.test(s)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("requireProvenance=block: unattested version blocks (no install, no ledger); --force-with-reason overrides", async () => {
  const dir = setup();
  writeFileSync(join(dir, ".safe-dep.json"), JSON.stringify({ requireProvenance: "block" }));
  try {
    let installed = false;
    const blocked = await runSafeAdd({
      spec: "lodash", dev: false, force: null,
      registry: fakeRegistry({}),
      installer: { async install() { installed = true; return 0; } },
      identity: noIdentity,
      now: () => new Date("2026-06-12"), cwd: dir, log: () => {}, err: () => {},
    });
    assert.equal(blocked, 1);
    assert.equal(installed, false);
    assert.deepEqual(readLedger(dir), {});

    const forced = await runSafeAdd({
      spec: "lodash", dev: false, force: "internal mirror has no provenance yet",
      registry: fakeRegistry({}),
      installer: { async install() { installed = true; return 0; } },
      identity: noIdentity,
      now: () => new Date("2026-06-12"), cwd: dir, log: () => {}, err: () => {},
    });
    assert.equal(forced, 0);
    assert.equal(installed, true);
    const e = readLedger(dir)["lodash@1.0.0"];
    assert.equal(e.reason, "internal mirror has no provenance yet");
    assert.equal(e.risk, "high");
    assert.deepEqual(e.checks.provenance, { attested: false });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("requireProvenance=block fails open on bundle-fetch failure: packument says attested, client offline → no block", async () => {
  const dir = setup();
  writeFileSync(join(dir, ".safe-dep.json"), JSON.stringify({ requireProvenance: "block" }));
  try {
    const code = await runSafeAdd({
      spec: "sigstore", dev: false, force: null,
      registry: fakeRegistry({ attestationsUrl: "https://reg/att" }),
      installer: { async install() { return 0; } },
      provenanceClient: { async fetch() { return null; } },
      identity: noIdentity,
      now: () => new Date("2026-06-12"), cwd: dir, log: () => {}, err: () => {},
    });
    assert.equal(code, 0);
    assert.deepEqual(readLedger(dir)["sigstore@1.0.0"].checks.provenance, { attested: true });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("allowlisted package skips the provenance gate but still records the evidence", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "host", dependencies: {} }));
    writeFileSync(join(dir, ".safe-dep.json"), JSON.stringify({ allowScopedPackages: ["@acme/*"], requireProvenance: "block" }));
    const code = await runSafeAdd({
      spec: "@acme/widget", dev: false, force: null,
      registry: fakeRegistry({}),
      installer: { async install() { return 0; } },
      identity: noIdentity,
      now: () => new Date("2026-06-12"), cwd: dir, log: () => {}, err: () => {},
    });
    assert.equal(code, 0);
    assert.deepEqual(readLedger(dir)["@acme/widget@1.0.0"].checks.provenance, { attested: false });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
