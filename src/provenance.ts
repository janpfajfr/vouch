// src/provenance.ts — npm provenance attestations: fetch (fail-open) + parse (never throws).
// vouch records the registry-verified claim from publish time; it does NOT re-verify
// sigstore signatures (`npm audit signatures` does that). Same attribution-not-authorization
// posture as the rest of the tool.
import type { ProvenanceRecord } from "./ledger.js";

const SLSA_PREDICATE = "https://slsa.dev/provenance/v1";

export interface ProvenanceClient {
  /** Fetch + parse the attestation bundle at `url`. Returns null on ANY error — fail-open. */
  fetch(url: string): Promise<ProvenanceRecord | null>;
}

export function createNpmProvenanceClient(): ProvenanceClient {
  return {
    async fetch(url) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) return null;
        return parseAttestations(await res.json());
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** Packument presence + best-effort claim. The gate only ever sees the packument-confirmed
 *  fact (attested true/false); a failed bundle fetch can never block. */
export async function resolveProvenance(attestationsUrl: string | null, client: ProvenanceClient | undefined): Promise<ProvenanceRecord> {
  if (!attestationsUrl) return { attested: false };
  const claim = client ? await client.fetch(attestationsUrl) : null;
  return claim ?? { attested: true };
}

/** Safe deep property walk over unknown JSON. */
function get(obj: unknown, ...path: string[]): unknown {
  let cur = obj;
  for (const key of path) {
    if (typeof cur !== "object" || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/** Extract the SLSA claim from the npm attestations response. Never throws; any
 *  unrecognized structure degrades to bare { attested: true } — presence already
 *  came from the packument, which is the trustworthy part. */
export function parseAttestations(raw: unknown): ProvenanceRecord {
  const out: ProvenanceRecord = { attested: true };
  const list = get(raw, "attestations");
  if (!Array.isArray(list)) return out;
  const slsa = list.find((a) => get(a, "predicateType") === SLSA_PREDICATE);
  const payload = get(slsa, "bundle", "dsseEnvelope", "payload");
  if (typeof payload !== "string") return out;
  let statement: unknown;
  try {
    statement = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
  } catch {
    return out;
  }
  const workflow = get(statement, "predicate", "buildDefinition", "externalParameters", "workflow");
  const repository = get(workflow, "repository");
  if (typeof repository === "string") out.sourceRepo = repository;
  const wfPath = get(workflow, "path");
  const wfRef = get(workflow, "ref");
  if (typeof wfPath === "string" && typeof wfRef === "string") out.workflow = `${wfPath}@${wfRef}`;
  const deps = get(statement, "predicate", "buildDefinition", "resolvedDependencies");
  if (Array.isArray(deps)) {
    for (const d of deps) {
      const commit = get(d, "digest", "gitCommit");
      if (typeof commit === "string") { out.sourceCommit = commit; break; }
    }
  }
  return out;
}

/** One-line human summary for CLI notes and (later) PR rendering. */
export function describeProvenance(p: ProvenanceRecord): string {
  if (!p.attested) return "no provenance attestation";
  if (!p.sourceRepo) return "provenance: attestation present";
  const repo = p.sourceRepo.replace(/^https?:\/\//, "");
  const commit = p.sourceCommit ? `@${p.sourceCommit.slice(0, 7)}` : "";
  return `provenance: built from ${repo}${commit}`;
}
