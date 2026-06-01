// test/ledger.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readLedger, writeLedger, upsertEntry, approvedVersions, normalizeLedger,
  type LedgerEntry, type Ledger,
} from "../src/ledger.js";

const entry: LedgerEntry = {
  name: "lodash",
  version: "4.17.21",
  addedAt: "2026-05-23T10:00:00Z",
  risk: "low",
  reason: null,
  addedBy: null,
  checks: { ageHours: 900, installScripts: false },
};

function tmp(): string { return mkdtempSync(join(tmpdir(), "ysna-")); }

test("readLedger returns {} when file missing", () => {
  const dir = tmp();
  try { assert.deepEqual(readLedger(dir), {}); } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("write then read round-trips through the v2 envelope, keyed by name@version", () => {
  const dir = tmp();
  try {
    writeLedger(dir, { "lodash@4.17.21": entry });
    const raw = JSON.parse(readFileSync(join(dir, ".security", "dependency-approvals.json"), "utf8"));
    assert.equal(raw.version, 2);
    assert.deepEqual(raw.entries, { "lodash@4.17.21": entry });
    assert.deepEqual(readLedger(dir), { "lodash@4.17.21": entry });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("writeLedger sorts keys and ends with a newline", () => {
  const dir = tmp();
  try {
    const b: LedgerEntry = { ...entry, name: "b", version: "1.0.0" };
    const a: LedgerEntry = { ...entry, name: "a", version: "1.0.0" };
    writeLedger(dir, { "b@1.0.0": b, "a@1.0.0": a });
    const text = readFileSync(join(dir, ".security", "dependency-approvals.json"), "utf8");
    assert.ok(text.endsWith("\n"));
    assert.ok(text.indexOf('"a@1.0.0"') < text.indexOf('"b@1.0.0"'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("upsertEntry keys by name@version without mutating input", () => {
  const before: Ledger = {};
  const after = upsertEntry(before, "lodash", "4.17.21", entry);
  assert.deepEqual(after, { "lodash@4.17.21": entry });
  assert.deepEqual(before, {});
});

test("upsertEntry keys scoped names correctly", () => {
  const e: LedgerEntry = { ...entry, name: "@scope/pkg", version: "1.2.3" };
  assert.deepEqual(upsertEntry({}, "@scope/pkg", "1.2.3", e), { "@scope/pkg@1.2.3": e });
});

test("approvedVersions returns every recorded version of a name (prefix scan)", () => {
  const z3: LedgerEntry = { ...entry, name: "zod", version: "3.25.76" };
  const z4: LedgerEntry = { ...entry, name: "zod", version: "4.3.6" };
  const ledger: Ledger = { "zod@3.25.76": z3, "zod@4.3.6": z4, "lodash@4.17.21": entry };
  const vs = approvedVersions(ledger, "zod").map((e) => e.version).sort();
  assert.deepEqual(vs, ["3.25.76", "4.3.6"]);
});

test("readLedger throws on malformed JSON", () => {
  const dir = tmp();
  try {
    mkdirSync(join(dir, ".security"), { recursive: true });
    writeFileSync(join(dir, ".security", "dependency-approvals.json"), "{ bad");
    assert.throws(() => readLedger(dir), /dependency-approvals/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("migrates a bare 0.1.x name-keyed file to name@version on read", () => {
  const v1 = {
    lodash: { approvedVersion: "4.17.21", addedAt: "t", risk: "low", reason: "r", addedBy: "alice", checks: { ageHours: 1, installScripts: false } },
  };
  const out = normalizeLedger(v1);
  assert.deepEqual(Object.keys(out), ["lodash@4.17.21"]);
  assert.equal(out["lodash@4.17.21"].name, "lodash");
  assert.equal(out["lodash@4.17.21"].version, "4.17.21");
  assert.equal(out["lodash@4.17.21"].reason, "r");
  assert.equal(out["lodash@4.17.21"].addedBy, "alice");
});

test("migration preserves a cve snapshot", () => {
  const v1 = { lodash: { approvedVersion: "4.17.21", addedAt: "t", risk: "low", reason: null, addedBy: null, checks: { ageHours: 1, installScripts: false }, cve: { acknowledged: [{ id: "GHSA-x", severity: "low" }], acknowledgedBy: "a", acknowledgedAt: "t", reason: "ok" } } };
  const out = normalizeLedger(v1);
  assert.deepEqual(out["lodash@4.17.21"].cve?.acknowledged, [{ id: "GHSA-x", severity: "low" }]);
});

test("migration keys scoped v1 names correctly", () => {
  const v1 = { "@scope/pkg": { approvedVersion: "1.2.3", addedAt: "t", risk: "low", reason: null, addedBy: null, checks: { ageHours: 1, installScripts: false } } };
  assert.deepEqual(Object.keys(normalizeLedger(v1)), ["@scope/pkg@1.2.3"]);
});

test("a v2 envelope re-reads unchanged (idempotent)", () => {
  const v2 = { version: 2, entries: { "lodash@4.17.21": entry } };
  assert.deepEqual(normalizeLedger(v2), { "lodash@4.17.21": entry });
});

test("a v1 entry without approvedVersion fails closed", () => {
  assert.throws(() => normalizeLedger({ lodash: { addedAt: "t", risk: "low" } }), /approvedVersion/);
});

test("normalizeLedger throws on an unsupported future ledger version", () => {
  assert.throws(() => normalizeLedger({ version: 3, entries: {} }), /unsupported ledger version 3/i);
});

test("readLedger migrates a v1-format file from disk", () => {
  const dir = tmp();
  try {
    mkdirSync(join(dir, ".security"), { recursive: true });
    writeFileSync(join(dir, ".security", "dependency-approvals.json"),
      JSON.stringify({ lodash: { approvedVersion: "4.17.21", addedAt: "t", risk: "low", reason: null, addedBy: null, checks: { ageHours: 1, installScripts: false } } }));
    const out = readLedger(dir);
    assert.deepEqual(Object.keys(out), ["lodash@4.17.21"]);
    assert.equal(out["lodash@4.17.21"].version, "4.17.21");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("normalizeLedger rejects a top-level array", () => {
  assert.throws(() => normalizeLedger([{ approvedVersion: "1.0.0" }]), /expected an object/);
});
