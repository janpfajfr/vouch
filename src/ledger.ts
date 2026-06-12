// src/ledger.ts
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { ledgerKey } from "./spec.js";

export type Risk = "low" | "medium" | "high";
export type CveSeverity = "low" | "moderate" | "high" | "critical";

export interface AcknowledgedAdvisory {
  id: string;            // GHSA id, else the npm advisory id as a string
  severity: CveSeverity;
}

export interface CveSnapshot {
  acknowledged: AcknowledgedAdvisory[]; // human-signed-off set, sorted by id
  acknowledgedBy: string | null;        // git identity of who acknowledged (attribution)
  acknowledgedAt: string;               // ISO 8601
  reason: string;                       // why the risk was knowingly accepted
}

/** Provenance posture recorded at decision time. Field omitted on an entry = recorded
 *  before vouch tracked provenance (same "no baseline" semantics as checks.advisories).
 *  attested:true with no claim fields = attestation exists (packument fact) but the
 *  bundle fetch failed or didn't parse — presence is still trustworthy. */
export interface ProvenanceRecord {
  attested: boolean;
  sourceRepo?: string;   // e.g. "https://github.com/sigstore/sigstore-js"
  sourceCommit?: string; // full git SHA from the SLSA predicate
  workflow?: string;     // e.g. ".github/workflows/release.yml@refs/heads/main"
}

export interface LedgerEntry {
  name: string;          // denormalized from the key — entry is self-describing
  version: string;       // was approvedVersion; the key already says "approved"
  addedAt: string;
  risk: Risk;
  reason: string | null;
  addedBy: string | null;
  checks: { ageHours: number | null; installScripts: Record<string, string> | false; advisories?: AcknowledgedAdvisory[]; provenance?: ProvenanceRecord };
  cve?: CveSnapshot;
}

export type Ledger = Record<string, LedgerEntry>;
export const LEDGER_VERSION = 2 as const;
interface LedgerFileV2 { version: 2; entries: Ledger; }

export const LEDGER_RELATIVE = join(".security", "dependency-approvals.json");

export function ledgerPath(cwd: string): string {
  return join(cwd, LEDGER_RELATIVE);
}

export function readLedger(cwd: string): Ledger {
  let raw: string;
  try {
    raw = readFileSync(ledgerPath(cwd), "utf8");
  } catch {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid ${LEDGER_RELATIVE}: not valid JSON`);
  }
  return normalizeLedger(parsed);
}

export function writeLedger(cwd: string, ledger: Ledger): void {
  const path = ledgerPath(cwd);
  mkdirSync(dirname(path), { recursive: true });
  const sorted: Ledger = {};
  for (const key of Object.keys(ledger).sort()) sorted[key] = ledger[key];
  const file: LedgerFileV2 = { version: LEDGER_VERSION, entries: sorted };
  writeFileSync(path, JSON.stringify(file, null, 2) + "\n");
}

export function upsertEntry(ledger: Ledger, name: string, version: string, entry: LedgerEntry): Ledger {
  return { ...ledger, [ledgerKey(name, version)]: entry };
}

/** Rare "any approved version of name?" query — prefix scan over the flat record. */
export function approvedVersions(ledger: Ledger, name: string): LedgerEntry[] {
  return Object.values(ledger).filter((e) => e.name === name);
}

/** Accepts the v2 envelope OR a bare 0.1.x name-keyed object, migrating the latter in
 *  memory. The migrated key uses the entry's own approvedVersion — the human-reviewed
 *  fact — never node_modules/registry (which may have drifted). */
export function normalizeLedger(parsed: unknown): Ledger {
  if (typeof parsed !== "object" || parsed === null) throw new Error(`Invalid ${LEDGER_RELATIVE}: expected an object`);
  if (Array.isArray(parsed)) throw new Error(`Invalid ${LEDGER_RELATIVE}: expected an object`);
  const obj = parsed as Record<string, unknown>;

  // v2: trust the envelope. (A real v1 package literally named "version" has an object
  // value, not the number 2, so this never misfires.)
  if (obj.version === 2 && typeof obj.entries === "object" && obj.entries !== null) return obj.entries as Ledger;

  // A numeric top-level `version` other than 2 is a future format we don't understand.
  // (A real v1 ledger never has a numeric `version` key — v1 values are entry objects.)
  if (typeof obj.version === "number") {
    throw new Error(`Invalid ${LEDGER_RELATIVE}: unsupported ledger version ${obj.version} (this vouch supports version 2). Upgrade vouch.`);
  }

  // v1 (published 0.1.x): bare name -> entry map; entries carry approvedVersion.
  const out: Ledger = {};
  for (const [name, value] of Object.entries(obj)) {
    if (typeof value !== "object" || value === null) continue;
    const e = value as Record<string, unknown>;
    if (typeof e.approvedVersion !== "string") {
      throw new Error(`Invalid ${LEDGER_RELATIVE}: entry "${name}" has no approvedVersion to key on (cannot migrate).`);
    }
    const version = e.approvedVersion;
    out[ledgerKey(name, version)] = {
      name, version,
      addedAt: String(e.addedAt ?? ""),
      risk: (e.risk as Risk) ?? "low",
      reason: (e.reason as string | null) ?? null,
      addedBy: (e.addedBy as string | null) ?? null,
      checks: (e.checks as LedgerEntry["checks"]) ?? { ageHours: null, installScripts: false },
      ...(e.cve ? { cve: e.cve as CveSnapshot } : {}),
    };
  }
  return out;
}
