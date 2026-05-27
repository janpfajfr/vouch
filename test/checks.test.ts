import { test } from "node:test";
import assert from "node:assert/strict";
import { checkVersionAge, checkInstallScripts, checkDeprecated, overallRisk, DANGEROUS_SCRIPTS } from "../src/checks.js";
import { DEFAULT_CONFIG } from "../src/config.js";

const now = new Date("2026-05-23T00:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000);

test("age < 24h blocks", () => {
  const f = checkVersionAge(hoursAgo(2), now, DEFAULT_CONFIG);
  assert.equal(f.level, "block");
});

test("age between 24h and 7d warns", () => {
  const f = checkVersionAge(hoursAgo(48), now, DEFAULT_CONFIG);
  assert.equal(f.level, "warn");
});

test("age >= 7d is ok", () => {
  const f = checkVersionAge(hoursAgo(24 * 30), now, DEFAULT_CONFIG);
  assert.equal(f.level, "ok");
});

test("unknown publish date warns, never silently ok", () => {
  const f = checkVersionAge(null, now, DEFAULT_CONFIG);
  assert.equal(f.level, "warn");
});

test("install script blocks when blockInstallScripts true", () => {
  const f = checkInstallScripts({ postinstall: "node x.js" }, DEFAULT_CONFIG);
  assert.equal(f.level, "block");
  assert.match(f.message, /postinstall/);
});

test("checkDeprecated warns for a deprecated package, ok otherwise", () => {
  assert.equal(checkDeprecated(true).level, "warn");
  assert.match(checkDeprecated(true).message, /deprecated/i);
  assert.equal(checkDeprecated(false).level, "ok");
});

test("non-lifecycle scripts are ignored", () => {
  const f = checkInstallScripts({ test: "node --test", build: "tsc" }, DEFAULT_CONFIG);
  assert.equal(f.level, "ok");
});

test("DANGEROUS_SCRIPTS lists the six lifecycle hooks", () => {
  assert.deepEqual([...DANGEROUS_SCRIPTS].sort(), [
    "install", "postinstall", "preinstall", "prepare", "prepublish", "prepublishOnly",
  ].sort());
});

test("overallRisk: block->high, warn->medium, none->low", () => {
  assert.equal(overallRisk([{ level: "block", message: "" }]), "high");
  assert.equal(overallRisk([{ level: "warn", message: "" }]), "medium");
  assert.equal(overallRisk([{ level: "ok", message: "" }]), "low");
});
