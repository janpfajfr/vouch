import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLedger, writeLedger, upsertEntry, type LedgerEntry } from "../src/ledger.js";

const entry: LedgerEntry = {
  approvedVersion: "4.17.21",
  addedAt: "2026-05-23T10:00:00Z",
  risk: "low",
  reason: null,
  addedBy: null,
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

test("round-trips an entry using addedBy/addedAt", () => {
  const dir = mkdtempSync(join(tmpdir(), "vouch-ledger-"));
  try {
    const e: LedgerEntry = {
      approvedVersion: "1.0.0",
      addedAt: "2026-05-27T10:00:00.000Z",
      addedBy: "Jan Pfajfr <jan@example.com>",
      risk: "high",
      reason: "needed for bundling",
      checks: { ageHours: 100, installScripts: false },
    };
    writeLedger(dir, { esbuild: e });
    assert.deepEqual(readLedger(dir).esbuild, e);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
