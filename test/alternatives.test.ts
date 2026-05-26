import { test } from "node:test";
import assert from "node:assert/strict";
import { findAlternatives } from "../src/alternatives.js";

test("suggests Node built-in for uuid", () => {
  const alts = findAlternatives("uuid", [], {});
  assert.ok(alts.some((a) => a.type === "builtin" && /randomUUID/.test(a.message)));
});

test("suggests existing dep when equivalent already present", () => {
  const alts = findAlternatives("lodash", ["remeda"], {});
  assert.ok(alts.some((a) => a.type === "existing" && /remeda/.test(a.message)));
});

test("no existing suggestion when equivalent not installed", () => {
  const alts = findAlternatives("lodash", ["express"], {});
  assert.equal(alts.filter((a) => a.type === "existing").length, 0);
});

test("config override adds a builtin-style note", () => {
  const alts = findAlternatives("moment", [], { moment: "Prefer date-fns or Intl APIs" });
  assert.ok(alts.some((a) => /date-fns/.test(a.message)));
});

test("unknown package yields no alternatives", () => {
  assert.deepEqual(findAlternatives("some-unique-thing", [], {}), []);
});
