import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, DEFAULT_CONFIG } from "../src/config.js";

test("returns defaults when no config file", () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-"));
  try {
    assert.deepEqual(loadConfig(dir), DEFAULT_CONFIG);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("merges file over defaults", () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-"));
  try {
    writeFileSync(join(dir, ".safe-dep.json"), JSON.stringify({ minimumVersionAgeHours: 48, packageManager: "npm" }));
    const cfg = loadConfig(dir);
    assert.equal(cfg.minimumVersionAgeHours, 48);
    assert.equal(cfg.packageManager, "npm");
    assert.equal(cfg.blockInstallScripts, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("throws on malformed JSON", () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-"));
  try {
    writeFileSync(join(dir, ".safe-dep.json"), "{ not json");
    assert.throws(() => loadConfig(dir), /\.safe-dep\.json/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("approval config defaults to verification off", () => {
  assert.deepEqual(DEFAULT_CONFIG.approval, { verify: "off", requireVerifiedApproval: false, allowedApprovers: [] });
});

test("a partial approval block keeps the other approval defaults", () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-"));
  try {
    writeFileSync(join(dir, ".safe-dep.json"), JSON.stringify({ approval: { verify: "github-review" } }));
    const cfg = loadConfig(dir);
    assert.equal(cfg.approval.verify, "github-review");
    assert.equal(cfg.approval.requireVerifiedApproval, false);
    assert.deepEqual(cfg.approval.allowedApprovers, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
