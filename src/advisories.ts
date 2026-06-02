import type { CveSeverity, Ledger } from "./ledger.js";
import { ledgerKey } from "./spec.js";

export interface Advisory {
  id: string;
  severity: CveSeverity;
}

function normalizeSeverity(s: unknown): CveSeverity {
  return s === "moderate" || s === "high" || s === "critical" ? s : "low";
}

export type DriftKind = "present-at-record" | "new-since-record";
export interface DriftAdvisory extends Advisory { kind: DriftKind; }

export interface CveDrift {
  package: string;
  newAdvisories: DriftAdvisory[];
}

/** For each live package, the unacknowledged advisories on the INSTALLED name@version
 *  entry, each classified against the seen-at-record baseline (entry.checks.advisories):
 *  - in the baseline  → "present-at-record" (existed when recorded; needs acknowledgement)
 *  - not in baseline  → "new-since-record"  (genuine drift)
 *  An entry with no baseline (legacy / unrecorded) classifies everything as
 *  "present-at-record" — we never claim a CVE is NEW when we don't know. */
export function detectDrift(
  ledger: Ledger,
  live: Record<string, Advisory[]>,
  installed: Record<string, string>,
): CveDrift[] {
  const drift: CveDrift[] = [];
  for (const [name, advisories] of Object.entries(live)) {
    if (!(name in installed)) continue; // couldn't resolve a version → nothing to key on
    const entry = ledger[ledgerKey(name, installed[name])];
    const ackIds = new Set((entry?.cve?.acknowledged ?? []).map((a) => a.id));
    const baseline = entry?.checks?.advisories;             // undefined = no baseline
    const seenIds = new Set((baseline ?? []).map((a) => a.id));
    const hasBaseline = baseline !== undefined;
    const newAdvisories: DriftAdvisory[] = [];
    for (const a of advisories) {
      if (ackIds.has(a.id)) continue;                        // accepted → silent
      const kind: DriftKind = hasBaseline && !seenIds.has(a.id) ? "new-since-record" : "present-at-record";
      newAdvisories.push({ ...a, kind });
    }
    if (newAdvisories.length > 0) drift.push({ package: name, newAdvisories });
  }
  return drift;
}

export interface AdvisoryClient {
  /** name -> versions present. Returns null on ANY error (offline/non-OK) — fail-open. */
  fetchBulk(pkgVersions: Record<string, string[]>): Promise<Record<string, Advisory[]> | null>;
}

export function createNpmAdvisoryClient(): AdvisoryClient {
  return {
    async fetchBulk(pkgVersions) {
      if (Object.keys(pkgVersions).length === 0) return {};
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        const url = process.env.VOUCH_ADVISORY_URL ?? "https://registry.npmjs.org/-/npm/v1/security/advisories/bulk";
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(pkgVersions),
          signal: controller.signal,
        });
        if (!res.ok) return null;
        return normalizeAdvisories(await res.json());
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** Maps the raw npm bulk-advisory response to `{ name: Advisory[] }`. Never throws. */
export function normalizeAdvisories(raw: unknown): Record<string, Advisory[]> {
  if (typeof raw !== "object" || raw === null) return {};
  const out: Record<string, Advisory[]> = {};
  for (const [name, list] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    const advisories: Advisory[] = [];
    for (const a of list) {
      if (typeof a !== "object" || a === null) continue;
      const rec = a as Record<string, unknown>;
      const id = typeof rec.ghsa_id === "string" && rec.ghsa_id ? rec.ghsa_id
        : rec.id != null ? String(rec.id) : null;
      if (!id) continue;
      advisories.push({ id, severity: normalizeSeverity(rec.severity) });
    }
    advisories.sort((x, y) => x.id.localeCompare(y.id));
    out[name] = advisories;
  }
  return out;
}
