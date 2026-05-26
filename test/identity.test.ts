import { test } from "node:test";
import assert from "node:assert/strict";
import { gitIdentity } from "../src/identity.js";

const runner = (map: Record<string, string>) => (args: string[]): string => {
  const key = args.join(" ");
  if (key in map) return map[key];
  throw new Error(`unexpected: ${key}`);
};

test("formats name and email", () => {
  const id = gitIdentity(runner({ "config user.name": "Jan Pf", "config user.email": "j@x.io" }));
  assert.equal(id, "Jan Pf <j@x.io>");
});

test("name only when email missing", () => {
  const id = gitIdentity(runner({ "config user.name": "Jan Pf", "config user.email": "" }));
  assert.equal(id, "Jan Pf");
});

test("null when name is missing", () => {
  const id = gitIdentity(runner({ "config user.name": "", "config user.email": "j@x.io" }));
  assert.equal(id, null);
});

test("null when git throws (no git / not a repo)", () => {
  const id = gitIdentity(() => { throw new Error("not a git repo"); });
  assert.equal(id, null);
});
