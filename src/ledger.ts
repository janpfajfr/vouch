import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

export type Risk = "low" | "medium" | "high";

export interface LedgerEntry {
  approvedVersion: string;
  approvedAt: string;
  risk: Risk;
  reason: string | null;
  approvedBy: string | null;
  checks: { ageHours: number | null; installScripts: boolean };
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
