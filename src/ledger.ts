import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

export type Risk = "low" | "medium" | "high";

export type ApprovalVia = "manual" | "git-config" | "signed-commit" | "github-review";

export interface Approval {
  by: string;
  via: ApprovalVia;
  at: string;        // ISO 8601
  ref?: string;      // commit SHA / PR review id (Phase 2)
}

export type CveSeverity = "low" | "moderate" | "high" | "critical";

export interface AcknowledgedAdvisory {
  id: string;            // GHSA id, else the npm advisory id as a string
  severity: CveSeverity;
}

export interface CveSnapshot {
  acknowledged: AcknowledgedAdvisory[]; // human-signed-off set, sorted by id
  acknowledgedBy: string;               // the human who re-approved (always set)
  acknowledgedAt: string;               // ISO 8601
}

export interface LedgerEntry {
  approvedVersion: string;
  approvedAt: string;
  risk: Risk;
  reason: string | null;
  approvedBy: string | null;
  checks: { ageHours: number | null; installScripts: Record<string, string> | false };
  cve?: CveSnapshot;
  approval?: Approval;
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

/** The effective approver: the new approval record, else the legacy approvedBy, else null. */
export function approverOf(entry: LedgerEntry): string | null {
  const by = entry.approval?.by ?? entry.approvedBy;
  return by && by.trim() !== "" ? by : null;
}
