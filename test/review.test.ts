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

import { approversFromReviews } from "../src/review.js";

test("approversFromReviews: APPROVED from a write-association user counts", () => {
  assert.deepEqual(approversFromReviews([{ state: "APPROVED", user: { login: "alice" }, author_association: "MEMBER" }]), ["alice"]);
});

test("approversFromReviews: a later CHANGES_REQUESTED supersedes an earlier APPROVED", () => {
  const reviews = [
    { state: "APPROVED", user: { login: "alice" }, author_association: "MEMBER" },
    { state: "CHANGES_REQUESTED", user: { login: "alice" }, author_association: "MEMBER" },
  ];
  assert.deepEqual(approversFromReviews(reviews), []);
});

test("approversFromReviews: non-write association is ignored", () => {
  assert.deepEqual(approversFromReviews([{ state: "APPROVED", user: { login: "ext" }, author_association: "CONTRIBUTOR" }]), []);
});
