import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldShowWordmark, wordmark, success } from "../src/art.js";

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
