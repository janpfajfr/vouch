import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

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

export interface LedgerEntry {
  approvedVersion: string;
  addedAt: string;
  risk: Risk;
  reason: string | null;
  addedBy: string | null;
  checks: { ageHours: number | null; installScripts: Record<string, string> | false };
  cve?: CveSnapshot;
}

export type Ledger = Record<string, LedgerEntry>;

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
  try {
    return JSON.parse(raw) as Ledger;
  } catch {
    throw new Error(`Invalid ${LEDGER_RELATIVE}: not valid JSON`);
  }
}

export function writeLedger(cwd: string, ledger: Ledger): void {
  const path = ledgerPath(cwd);
  mkdirSync(dirname(path), { recursive: true });
  const sorted: Ledger = {};
  for (const key of Object.keys(ledger).sort()) sorted[key] = ledger[key];
  writeFileSync(path, JSON.stringify(sorted, null, 2) + "\n");
}

export function upsertEntry(ledger: Ledger, name: string, entry: LedgerEntry): Ledger {
  return { ...ledger, [name]: entry };
}
