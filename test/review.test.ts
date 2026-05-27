import { test } from "node:test";
import assert from "node:assert/strict";
import { permittedApprover } from "../src/review.js";

test("any write-association reviewer counts when allowedApprovers is empty", () => {
  assert.equal(permittedApprover(["alice", "bob"], []), true);
});

test("with allowedApprovers, only listed logins count", () => {
  assert.equal(permittedApprover(["bob"], ["alice"]), false);
  assert.equal(permittedApprover(["alice", "bob"], ["alice"]), true);
});

test("no reviewers means not verified", () => {
  assert.equal(permittedApprover([], []), false);
  assert.equal(permittedApprover([], ["alice"]), false);
});
