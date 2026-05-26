import type { CveSeverity, Ledger } from "./ledger.js";

export interface Advisory {
  id: string;
  severity: CveSeverity;
}

function normalizeSeverity(s: unknown): CveSeverity {
  return s === "moderate" || s === "high" || s === "critical" ? s : "low";
}

export interface CveDrift {
  package: string;
  newAdvisories: Advisory[];
}

/** For each live package, the advisories whose id is not in the entry's acknowledged set. */
export function detectDrift(ledger: Ledger, live: Record<string, Advisory[]>): CveDrift[] {
  const drift: CveDrift[] = [];
  for (const [name, advisories] of Object.entries(live)) {
    const ackIds = new Set((ledger[name]?.cve?.acknowledged ?? []).map((a) => a.id));
    const newAdvisories = advisories.filter((a) => !ackIds.has(a.id));
    if (newAdvisories.length > 0) drift.push({ package: name, newAdvisories });
  }
  return drift;
}

export interface AdvisoryClient {
  /** name -> versions present. Returns null on ANY error (offline/non-OK) — fail-open. */
  fetchBulk(pkgVersions: Record<string, string[]>): Promise<Record<string, Advisory[]> | null>;
}

export class NpmAdvisoryClient implements AdvisoryClient {
  async fetchBulk(pkgVersions: Record<string, string[]>): Promise<Record<string, Advisory[]> | null> {
    if (Object.keys(pkgVersions).length === 0) return {};
    try {
      const url = process.env.YSNA_ADVISORY_URL ?? "https://registry.npmjs.org/-/npm/v1/security/advisories/bulk";
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(pkgVersions),
      });
      if (!res.ok) return null;
      return normalizeAdvisories(await res.json());
    } catch {
      return null;
    }
  }
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
