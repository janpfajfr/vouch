import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const cli = resolve("dist/src/cli.js");

test("check exits 1 on unreviewed dependency", () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: { lodash: "^4" } }));
    assert.throws(() => execFileSync(process.execPath, [cli, "check"], { cwd: dir, stdio: "pipe", env: { ...process.env, YSNA_ADVISORY_URL: "http://127.0.0.1:1" } }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check exits 0 when ledger covers deps", () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: { lodash: "^4" } }));
    mkdirSync(join(dir, ".security"), { recursive: true });
    writeFileSync(
      join(dir, ".security", "dependency-approvals.json"),
      JSON.stringify({ lodash: { approvedVersion: "4.17.21", approvedAt: "x", risk: "low", reason: null, approvedBy: null, checks: { ageHours: 1, installScripts: false } } }),
    );
    const out = execFileSync(process.execPath, [cli, "check"], { cwd: dir, encoding: "utf8", env: { ...process.env, YSNA_ADVISORY_URL: "http://127.0.0.1:1" } });
    assert.match(out, /all dependencies are approved/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reapprove without --approved-by exits 1", () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: { lodash: "^4" } }));
    mkdirSync(join(dir, ".security"), { recursive: true });
    writeFileSync(
      join(dir, ".security", "dependency-approvals.json"),
      JSON.stringify({ lodash: { approvedVersion: "4.17.21", approvedAt: "x", risk: "low", reason: null, approvedBy: null, checks: { ageHours: 1, installScripts: false } } }),
    );
    assert.throws(
      () => execFileSync(process.execPath, [cli, "reapprove", "lodash"], { cwd: dir, stdio: "pipe", env: { ...process.env, YSNA_ADVISORY_URL: "http://127.0.0.1:1" } }),
      (err: NodeJS.ErrnoException & { status?: number }) => {
        assert.equal(err.status, 1);
        return true;
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reapprove rejects a flag as the --approved-by value", () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: { lodash: "^4" } }));
    mkdirSync(join(dir, ".security"), { recursive: true });
    writeFileSync(
      join(dir, ".security", "dependency-approvals.json"),
      JSON.stringify({ lodash: { approvedVersion: "4.17.21", approvedAt: "x", risk: "low", reason: null, approvedBy: null, checks: { ageHours: 1, installScripts: false } } }),
    );
    assert.throws(
      () => execFileSync(process.execPath, [cli, "reapprove", "lodash", "--approved-by", "-x"], { cwd: dir, stdio: "pipe", env: { ...process.env, YSNA_ADVISORY_URL: "http://127.0.0.1:1" } }),
      (err: NodeJS.ErrnoException & { status?: number }) => {
        assert.equal(err.status, 1);
        return true;
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
