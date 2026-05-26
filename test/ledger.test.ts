import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLedger, writeLedger, upsertEntry, approverOf, type LedgerEntry } from "../src/ledger.js";

const entry: LedgerEntry = {
  approvedVersion: "4.17.21",
  approvedAt: "2026-05-23T10:00:00Z",
  risk: "low",
  reason: null,
  approvedBy: null,
  checks: { ageHours: 900, installScripts: false },
};

test("readLedger returns {} when file missing", () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-"));
  try {
    assert.deepEqual(readLedger(dir), {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("write then read round-trips", () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-"));
  try {
    writeLedger(dir, { lodash: entry });
    assert.deepEqual(readLedger(dir), { lodash: entry });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("upsertEntry adds without mutating input", () => {
  const before = {};
  const after = upsertEntry(before, "lodash", entry);
  assert.deepEqual(after, { lodash: entry });
  assert.deepEqual(before, {});
});

test("readLedger throws on malformed file", () => {
  const dir = mkdtempSync(join(tmpdir(), "ysna-"));
  try {
    mkdirSync(join(dir, ".security"), { recursive: true });
    writeFileSync(join(dir, ".security", "dependency-approvals.json"), "{ bad");
    assert.throws(() => readLedger(dir), /dependency-approvals/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const base: LedgerEntry = {
  approvedVersion: "1.0.0", approvedAt: "x", risk: "high", reason: "r",
  approvedBy: null, checks: { ageHours: 1, installScripts: false },
};

test("approverOf prefers the new approval record", () => {
  assert.equal(approverOf({ ...base, approval: { by: "Jan <j@x>", via: "git-config", at: "t" } }), "Jan <j@x>");
});

test("approverOf falls back to the legacy approvedBy", () => {
  assert.equal(approverOf({ ...base, approvedBy: "Alice" }), "Alice");
});

test("approverOf returns null when neither is set or is blank", () => {
  assert.equal(approverOf(base), null);
  assert.equal(approverOf({ ...base, approvedBy: "   " }), null);
});
