import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, DEFAULT_CONFIG } from "../src/config.js";

test("returns defaults when no config file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-"));
  try {
    assert.deepEqual(await loadConfig(dir), DEFAULT_CONFIG);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("legacy .safe-dep.json: merges file over defaults", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-"));
  try {
    writeFileSync(join(dir, ".safe-dep.json"), JSON.stringify({ minimumVersionAgeHours: 48, packageManager: "npm" }));
    const cfg = await loadConfig(dir);
    assert.equal(cfg.minimumVersionAgeHours, 48);
    assert.equal(cfg.packageManager, "npm");
    assert.equal(cfg.blockInstallScripts, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("legacy .safe-dep.json: throws on malformed JSON", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-"));
  try {
    writeFileSync(join(dir, ".safe-dep.json"), "{ not json");
    await assert.rejects(loadConfig(dir), /\.safe-dep\.json/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rejects an invalid enum value instead of silently downgrading the gate", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-"));
  try {
    writeFileSync(join(dir, ".safe-dep.json"), JSON.stringify({ versionDrift: "blcok" }));
    await assert.rejects(loadConfig(dir), /versionDrift.*one of/);
    writeFileSync(join(dir, ".safe-dep.json"), JSON.stringify({ packageManager: "bun" }));
    await assert.rejects(loadConfig(dir), /packageManager.*one of/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("accepts valid enum values", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-"));
  try {
    writeFileSync(join(dir, ".safe-dep.json"), JSON.stringify({ versionDrift: "warn", requirePinned: "warn", packageManager: "pnpm" }));
    const cfg = await loadConfig(dir);
    assert.equal(cfg.versionDrift, "warn");
    assert.equal(cfg.requirePinned, "warn");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("versionDrift is no longer a default (deprecated, ignored by check)", () => {
  assert.equal(DEFAULT_CONFIG.versionDrift, undefined);
});

test("requirePinned 'block' is rejected with a clear migration message", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-"));
  try {
    writeFileSync(join(dir, ".safe-dep.json"), JSON.stringify({ requirePinned: "block" }));
    await assert.rejects(loadConfig(dir), /requirePinned.*no longer supports "block"/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("versionDrift is still accepted (validated) during the deprecation window", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-"));
  try {
    writeFileSync(join(dir, ".safe-dep.json"), JSON.stringify({ versionDrift: "block" }));
    const cfg = await loadConfig(dir);
    assert.equal(cfg.versionDrift, "block");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a versionDrift typo still errors (enum still validated)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-"));
  try {
    writeFileSync(join(dir, ".safe-dep.json"), JSON.stringify({ versionDrift: "blcok" }));
    await assert.rejects(loadConfig(dir), /versionDrift.*one of/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("requirePinned defaults to off (opt-in)", () => {
  assert.equal(DEFAULT_CONFIG.requirePinned, "off");
});

test("cveAtInstall defaults to warn; min-severity defaults to high", () => {
  assert.equal(DEFAULT_CONFIG.cveAtInstall, "warn");
  assert.equal(DEFAULT_CONFIG.cveAtInstallMinSeverity, "high");
});

test("loadConfig has no approval block and no requireApprovalForHighRisk", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vouch-cfg-"));
  try {
    const cfg = await loadConfig(dir);
    assert.ok(!("approval" in cfg));
    assert.ok(!("requireApprovalForHighRisk" in cfg));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// vouch.config.* (typed config) — preferred over the legacy JSON.

test("loads vouch.config.mjs and merges with defaults", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-cfg-mjs-"));
  try {
    writeFileSync(join(dir, "vouch.config.mjs"),
      `export default { versionDrift: "block", cveAtInstall: "block", cveAtInstallMinSeverity: "critical" };\n`);
    const cfg = await loadConfig(dir);
    assert.equal(cfg.versionDrift, "block");
    assert.equal(cfg.cveAtInstall, "block");
    assert.equal(cfg.cveAtInstallMinSeverity, "critical");
    assert.equal(cfg.blockInstallScripts, true, "defaults still apply for unspecified keys");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("vouch.config.* wins over a legacy .safe-dep.json in the same dir", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-cfg-pref-"));
  try {
    writeFileSync(join(dir, ".safe-dep.json"), JSON.stringify({ versionDrift: "off" }));
    writeFileSync(join(dir, "vouch.config.mjs"), `export default { versionDrift: "block" };\n`);
    const cfg = await loadConfig(dir);
    assert.equal(cfg.versionDrift, "block");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("vouch.config.mjs without a default export errors clearly", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-cfg-bad-"));
  try {
    writeFileSync(join(dir, "vouch.config.mjs"), `export const cfg = { versionDrift: "block" };\n`);
    await assert.rejects(loadConfig(dir), /default-exported config object/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("typed config: enum validation still fires (typo'd values fail)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-cfg-typo-"));
  try {
    writeFileSync(join(dir, "vouch.config.mjs"), `export default { versionDrift: "blcok" };\n`);
    await assert.rejects(loadConfig(dir), /versionDrift.*one of/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("requireProvenance defaults to off and validates its enum", async () => {
  assert.equal(DEFAULT_CONFIG.requireProvenance, "off");
  const dir = mkdtempSync(join(tmpdir(), "ysna-cfg-"));
  try {
    writeFileSync(join(dir, ".safe-dep.json"), JSON.stringify({ requireProvenance: "definitely" }));
    await assert.rejects(() => loadConfig(dir), /requireProvenance/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
