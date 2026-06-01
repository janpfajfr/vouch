import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../src/config.js";

// The schema is hand-written (not generated). This guards against drift: every key in
// DEFAULT_CONFIG must appear in schema.properties, and vice versa (the schema is allowed
// the extra `$schema` key, which isn't a runtime config field).
test("schema.json covers every Config key in DEFAULT_CONFIG", () => {
  const schema = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "schema.json"), "utf8"));
  const schemaKeys = new Set(Object.keys(schema.properties));
  schemaKeys.delete("$schema"); // editor-only, not a runtime field
  schemaKeys.delete("versionDrift"); // deprecated: still schema-documented for the editor, but no longer a DEFAULT_CONFIG key
  const configKeys = new Set(Object.keys(DEFAULT_CONFIG));
  assert.deepEqual([...schemaKeys].sort(), [...configKeys].sort(), "schema and DEFAULT_CONFIG keys must match");
});

test("schema.json is valid JSON-Schema-shaped", () => {
  const schema = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "schema.json"), "utf8"));
  assert.equal(schema.type, "object");
  assert.equal(schema.additionalProperties, false);
  assert.ok(schema.$id, "has $id so editors can cache it");
});
