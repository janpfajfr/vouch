import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAttestations, describeProvenance, resolveProvenance } from "../src/provenance.js";

const SLSA = "https://slsa.dev/provenance/v1";
const b64 = (statement: unknown) => Buffer.from(JSON.stringify(statement)).toString("base64");

// Mirrors the live response captured from registry.npmjs.org for sigstore@5.0.0 on
// 2026-06-12 (verification material trimmed — vouch never reads it).
const slsaStatement = {
  _type: "https://in-toto.io/Statement/v1",
  predicateType: SLSA,
  predicate: {
    buildDefinition: {
      buildType: "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1",
      externalParameters: {
        workflow: { ref: "refs/heads/main", repository: "https://github.com/sigstore/sigstore-js", path: ".github/workflows/release.yml" },
      },
      resolvedDependencies: [
        { uri: "git+https://github.com/sigstore/sigstore-js@refs/heads/main", digest: { gitCommit: "7d2900eca1c22b3f87c13987c8d4b7c9a29b733a" } },
      ],
    },
    runDetails: { builder: { id: "https://github.com/actions/runner/github-hosted" } },
  },
};
const registryResponse = {
  attestations: [
    { predicateType: "https://github.com/npm/attestation/tree/main/specs/publish/v0.1", bundle: { mediaType: "m", dsseEnvelope: { payload: b64({ _type: "publish" }) } } },
    { predicateType: SLSA, bundle: { mediaType: "m", dsseEnvelope: { payload: b64(slsaStatement) } } },
  ],
};

test("parseAttestations extracts repo, commit, and workflow from the SLSA attestation (skipping the publish one)", () => {
  assert.deepEqual(parseAttestations(registryResponse), {
    attested: true,
    sourceRepo: "https://github.com/sigstore/sigstore-js",
    sourceCommit: "7d2900eca1c22b3f87c13987c8d4b7c9a29b733a",
    workflow: ".github/workflows/release.yml@refs/heads/main",
  });
});

test("parseAttestations degrades to bare attested:true on garbage", () => {
  for (const raw of [null, "x", 42, {}, { attestations: "nope" }, { attestations: [] },
    { attestations: [{ predicateType: SLSA, bundle: { dsseEnvelope: { payload: "%%%not-base64-json%%%" } } }] },
    { attestations: [{ predicateType: SLSA }] }]) {
    assert.deepEqual(parseAttestations(raw), { attested: true });
  }
});

test("parseAttestations records the repo even when resolvedDependencies is missing", () => {
  const noDeps = structuredClone(slsaStatement) as Record<string, any>;
  delete noDeps.predicate.buildDefinition.resolvedDependencies;
  const out = parseAttestations({ attestations: [{ predicateType: SLSA, bundle: { dsseEnvelope: { payload: b64(noDeps) } } }] });
  assert.equal(out.sourceRepo, "https://github.com/sigstore/sigstore-js");
  assert.equal(out.sourceCommit, undefined);
  assert.equal(out.workflow, ".github/workflows/release.yml@refs/heads/main");
});

test("describeProvenance formats the three states", () => {
  assert.equal(describeProvenance({ attested: false }), "no provenance attestation");
  assert.equal(describeProvenance({ attested: true }), "provenance: attestation present");
  assert.equal(
    describeProvenance({ attested: true, sourceRepo: "https://github.com/sigstore/sigstore-js", sourceCommit: "7d2900eca1c22b3f87c13987c8d4b7c9a29b733a" }),
    "provenance: built from github.com/sigstore/sigstore-js@7d2900e",
  );
});

test("resolveProvenance: no url → attested:false; client null (offline) → bare attested:true; claim wins", async () => {
  assert.deepEqual(await resolveProvenance(null, { async fetch() { throw new Error("never called"); } }), { attested: false });
  assert.deepEqual(await resolveProvenance("https://u", { async fetch() { return null; } }), { attested: true });
  assert.deepEqual(await resolveProvenance("https://u", { async fetch() { return { attested: true, sourceRepo: "https://github.com/x/y" }; } }), { attested: true, sourceRepo: "https://github.com/x/y" });
  assert.deepEqual(await resolveProvenance("https://u", undefined), { attested: true });
});
