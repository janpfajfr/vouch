import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const cli = resolve("dist/src/cli.js");

const lowEntry = JSON.stringify({ lodash: { approvedVersion: "4.17.21", addedAt: "x", risk: "low", reason: null, addedBy: null, checks: { ageHours: 1, installScripts: false } } });

test("check exits 1 on unrecorded dependency", () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: { lodash: "^4" } }));
    assert.throws(() => execFileSync(process.execPath, [cli, "check"], { cwd: dir, stdio: "pipe", env: { ...process.env, VOUCH_ADVISORY_URL: "http://127.0.0.1:1" } }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check names the actual unrecorded packages in the Next hint (-D for devDeps)", () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: { lodash: "^4" }, devDependencies: { typescript: "^5" } }));
    assert.throws(
      () => execFileSync(process.execPath, [cli, "check"], { cwd: dir, stdio: "pipe", env: { ...process.env, VOUCH_ADVISORY_URL: "http://127.0.0.1:1" } }),
      (err: NodeJS.ErrnoException & { status?: number; stderr?: Buffer }) => {
        assert.equal(err.status, 1);
        const stderr = String(err.stderr);
        assert.match(stderr, /vouch lodash\b/);        // prod dep named
        assert.match(stderr, /vouch typescript -D\b/);  // devDep named, with -D
        assert.doesNotMatch(stderr, /vouch <package>/); // no generic placeholder
        return true;
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check exits 0 when ledger covers deps", () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: { lodash: "^4" } }));
    mkdirSync(join(dir, ".security"), { recursive: true });
    writeFileSync(join(dir, ".security", "dependency-approvals.json"), lowEntry);
    const out = execFileSync(process.execPath, [cli, "check"], { cwd: dir, encoding: "utf8", env: { ...process.env, VOUCH_ADVISORY_URL: "http://127.0.0.1:1" } });
    assert.match(out, /All dependencies are recorded/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("high-risk with a reason passes check (no separate approval step)", () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: { evil: "1" } }));
    mkdirSync(join(dir, ".security"), { recursive: true });
    writeFileSync(join(dir, ".security", "dependency-approvals.json"),
      JSON.stringify({ evil: { approvedVersion: "1.0.0", addedAt: "x", risk: "high", reason: "needed", addedBy: null, checks: { ageHours: 1, installScripts: false } } }));
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

test("acknowledge without --reason exits 1", () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: { lodash: "^4" } }));
    mkdirSync(join(dir, ".security"), { recursive: true });
    writeFileSync(join(dir, ".security", "dependency-approvals.json"), lowEntry);
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
    mkdirSync(join(dir, ".security"), { recursive: true });
    writeFileSync(join(dir, ".security", "dependency-approvals.json"), lowEntry);
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
