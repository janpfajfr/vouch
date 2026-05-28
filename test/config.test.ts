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

test("rejects an invalid enum value instead of silently downgrading the gate", () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-"));
  try {
    writeFileSync(join(dir, ".safe-dep.json"), JSON.stringify({ versionDrift: "blcok" }));
    assert.throws(() => loadConfig(dir), /versionDrift.*one of/);
    writeFileSync(join(dir, ".safe-dep.json"), JSON.stringify({ packageManager: "bun" }));
    assert.throws(() => loadConfig(dir), /packageManager.*one of/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("accepts valid enum values", () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-"));
  try {
    writeFileSync(join(dir, ".safe-dep.json"), JSON.stringify({ versionDrift: "block", requirePinned: "warn", packageManager: "pnpm" }));
    const cfg = loadConfig(dir);
    assert.equal(cfg.versionDrift, "block");
    assert.equal(cfg.requirePinned, "warn");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("versionDrift defaults to warn", () => {
  assert.equal(DEFAULT_CONFIG.versionDrift, "warn");
});

test("requirePinned defaults to off (opt-in)", () => {
  assert.equal(DEFAULT_CONFIG.requirePinned, "off");
});

test("cveAtInstall defaults to warn; min-severity defaults to high", () => {
  assert.equal(DEFAULT_CONFIG.cveAtInstall, "warn");
  assert.equal(DEFAULT_CONFIG.cveAtInstallMinSeverity, "high");
});

test("loadConfig has no approval block and no requireApprovalForHighRisk", () => {
  const dir = mkdtempSync(join(tmpdir(), "vouch-cfg-"));
  try {
    const cfg = loadConfig(dir);
    assert.ok(!("approval" in cfg));
    assert.ok(!("requireApprovalForHighRisk" in cfg));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
