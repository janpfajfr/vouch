import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldShowWordmark, wordmark, success, statusHeader } from "../src/art.js";

test("statusHeader uses the ✦ vouch prefix and contains the message", () => {
  const h = statusHeader("success", "Recorded dependency decision", { isTTY: true, noColor: true, quiet: false });
  assert.match(h, /✦ vouch/);
  assert.match(h, /Recorded dependency decision/);
});
test("statusHeader is plain (no ANSI) when noColor is set", () => {
  assert.doesNotMatch(statusHeader("blocked", "x", { isTTY: true, noColor: true, quiet: false }), /\x1b\[/);
});
test("statusHeader is plain (no ANSI) when not a TTY", () => {
  assert.doesNotMatch(statusHeader("warn", "x", { isTTY: false, noColor: false, quiet: false }), /\x1b\[/);
});
test("statusHeader carries ANSI when color allowed on a TTY", () => {
  assert.match(statusHeader("success", "x", { isTTY: true, noColor: false, quiet: false }), /\x1b\[/);
});
test("--quiet drops the decorative prefix, keeps the message", () => {
  const h = statusHeader("success", "Dependency review passed", { isTTY: true, noColor: true, quiet: true });
  assert.doesNotMatch(h, /✦ vouch/);
  assert.equal(h, "Dependency review passed");
});

test("wordmark hidden when not a TTY", () => {
  assert.equal(shouldShowWordmark({ isTTY: false, noColor: false, quiet: false }), false);
});
test("wordmark hidden when quiet", () => {
  assert.equal(shouldShowWordmark({ isTTY: true, noColor: false, quiet: true }), false);
});
test("wordmark shown on interactive terminal", () => {
  assert.equal(shouldShowWordmark({ isTTY: true, noColor: false, quiet: false }), true);
});
test("wordmark returns non-empty string text", () => {
  assert.ok(wordmark({ isTTY: true, noColor: true, quiet: false }).length > 0);
});
test("colored text is plain when noColor is set", () => {
  assert.doesNotMatch(success("done", { isTTY: true, noColor: true, quiet: false }), /\x1b\[/);
});
test("colored text carries ANSI when color is allowed on a TTY", () => {
  assert.match(success("done", { isTTY: true, noColor: false, quiet: false }), /\x1b\[/);
});
test("colored text is plain (no ANSI) when not a TTY — calm output in pipes/CI", () => {
  assert.doesNotMatch(success("done", { isTTY: false, noColor: false, quiet: false }), /\x1b\[/);
});
