import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const cli = resolve("dist/src/cli.js");

/** Write node_modules/<name>/package.json so the version-aware resolver finds it. */
function installPkg(dir: string, name: string, version: string): void {
  const pkgDir = join(dir, "node_modules", ...name.split("/"));
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name, version }));
}

/** A v2 ledger envelope with one low-risk entry. */
function ledgerV2(name: string, version: string): string {
  return JSON.stringify({ version: 2, entries: { [`${name}@${version}`]: { name, version, addedAt: "x", risk: "low", reason: null, addedBy: null, checks: { ageHours: 1, installScripts: false } } } });
}

test("check exits 1 on unrecorded dependency", () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: { lodash: "^4" } }));
    assert.throws(() => execFileSync(process.execPath, [cli, "check"], { cwd: dir, stdio: "pipe", env: { ...process.env, VOUCH_ADVISORY_URL: "http://127.0.0.1:1" } }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check names the unrecorded name@version in the Next hint (-D for devDeps)", () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: { lodash: "^4" }, devDependencies: { typescript: "^5" } }));
    installPkg(dir, "lodash", "4.17.21");
    installPkg(dir, "typescript", "5.5.0");
    assert.throws(
      () => execFileSync(process.execPath, [cli, "check"], { cwd: dir, stdio: "pipe", env: { ...process.env, VOUCH_ADVISORY_URL: "http://127.0.0.1:1" } }),
      (err: NodeJS.ErrnoException & { status?: number; stderr?: Buffer }) => {
        assert.equal(err.status, 1);
        const stderr = String(err.stderr);
        assert.match(stderr, /vouch lodash@4\.17\.21\b/);
        assert.match(stderr, /vouch typescript@5\.5\.0 -D\b/);
        assert.doesNotMatch(stderr, /vouch <package>/);
        return true;
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check exits 0 when ledger covers the installed name@version", () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: { lodash: "^4" } }));
    installPkg(dir, "lodash", "4.17.21");
    mkdirSync(join(dir, ".security"), { recursive: true });
    writeFileSync(join(dir, ".security", "dependency-approvals.json"), ledgerV2("lodash", "4.17.21"));
    const out = execFileSync(process.execPath, [cli, "check"], { cwd: dir, encoding: "utf8", env: { ...process.env, VOUCH_ADVISORY_URL: "http://127.0.0.1:1" } });
    assert.match(out, /All dependencies are recorded/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("high-risk with a reason passes check (no separate approval step)", () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: { evil: "1" } }));
    installPkg(dir, "evil", "1.0.0");
    mkdirSync(join(dir, ".security"), { recursive: true });
    writeFileSync(join(dir, ".security", "dependency-approvals.json"),
      JSON.stringify({ version: 2, entries: { "evil@1.0.0": { name: "evil", version: "1.0.0", addedAt: "x", risk: "high", reason: "needed", addedBy: null, checks: { ageHours: 1, installScripts: false } } } }));
    const out = execFileSync(process.execPath, [cli, "check"], { cwd: dir, encoding: "utf8", env: { ...process.env, VOUCH_ADVISORY_URL: "http://127.0.0.1:1" } });
    assert.match(out, /All dependencies are recorded/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check fails CLEANLY on a malformed ledger — branded message, no stack trace", () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: { lodash: "^4" } }));
    mkdirSync(join(dir, ".security"), { recursive: true });
    writeFileSync(join(dir, ".security", "dependency-approvals.json"), "{ not json");
    assert.throws(
      () => execFileSync(process.execPath, [cli, "check"], { cwd: dir, stdio: "pipe", env: { ...process.env, VOUCH_ADVISORY_URL: "http://127.0.0.1:1" } }),
      (err: NodeJS.ErrnoException & { status?: number; stderr?: Buffer }) => {
        assert.equal(err.status, 1);
        const stderr = String(err.stderr);
        assert.match(stderr, /not valid JSON/);
        assert.doesNotMatch(stderr, /\bat .*\.js:\d+/); // fail-closed, but no raw Node stack trace
        return true;
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a 0.1.x name-keyed ledger auto-migrates to the v2 envelope on first write", () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: { lodash: "^4" } }));
    installPkg(dir, "lodash", "4.17.21");
    mkdirSync(join(dir, ".security"), { recursive: true });
    writeFileSync(join(dir, ".security", "dependency-approvals.json"),
      JSON.stringify({ lodash: { approvedVersion: "4.17.21", addedAt: "x", risk: "low", reason: null, addedBy: null, checks: { ageHours: 1, installScripts: false } } }));
    const out = execFileSync(process.execPath, [cli, "check"], { cwd: dir, encoding: "utf8", env: { ...process.env, VOUCH_ADVISORY_URL: "http://127.0.0.1:1" } });
    assert.match(out, /All dependencies are recorded/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("acknowledge without --reason exits 1", () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: { lodash: "^4" } }));
    installPkg(dir, "lodash", "4.17.21");
    mkdirSync(join(dir, ".security"), { recursive: true });
    writeFileSync(join(dir, ".security", "dependency-approvals.json"), ledgerV2("lodash", "4.17.21"));
    assert.throws(
      () => execFileSync(process.execPath, [cli, "acknowledge", "lodash"], { cwd: dir, stdio: "pipe", env: { ...process.env, VOUCH_ADVISORY_URL: "http://127.0.0.1:1" } }),
      (err: NodeJS.ErrnoException & { status?: number }) => {
        assert.equal(err.status, 1);
        return true;
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("acknowledge rejects a flag as the --reason value", () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: { lodash: "^4" } }));
    installPkg(dir, "lodash", "4.17.21");
    mkdirSync(join(dir, ".security"), { recursive: true });
    writeFileSync(join(dir, ".security", "dependency-approvals.json"), ledgerV2("lodash", "4.17.21"));
    assert.throws(
      () => execFileSync(process.execPath, [cli, "acknowledge", "lodash", "--reason", "-x"], { cwd: dir, stdio: "pipe", env: { ...process.env, VOUCH_ADVISORY_URL: "http://127.0.0.1:1" } }),
      (err: NodeJS.ErrnoException & { status?: number }) => {
        assert.equal(err.status, 1);
        return true;
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--help prints usage and the foundation command set", () => {
  const out = execFileSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
  assert.match(out, /Usage:/);
  assert.match(out, /vouch acknowledge/);
  assert.doesNotMatch(out, /vouch approve|reapprove/);
});

test("'help' shows help and exits 0 (does not try to install a package called 'help')", () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: {} }));
    const out = execFileSync(process.execPath, [cli, "help"], { cwd: dir, encoding: "utf8" });
    assert.match(out, /Usage:/);
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    assert.equal(pkg.dependencies.help, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--version prints a semver and exits 0", () => {
  const out = execFileSync(process.execPath, [cli, "--version"], { encoding: "utf8" });
  assert.match(out, /\d+\.\d+\.\d+/);
});
