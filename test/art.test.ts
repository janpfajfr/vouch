import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldShowWordmark, wordmark, blockBanner } from "../src/art.js";

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
test("block banner always returns the catchphrase, even non-TTY", () => {
  const b = blockBanner({ isTTY: false, noColor: true, quiet: true });
  assert.match(b, /REVIEW/i);
});
test("no ANSI escape codes when noColor is set", () => {
  const b = blockBanner({ isTTY: true, noColor: true, quiet: false });
  assert.doesNotMatch(b, /\x1b\[/);
});
test("ANSI escape codes present when color allowed on TTY", () => {
  const b = blockBanner({ isTTY: true, noColor: false, quiet: false });
  assert.match(b, /\x1b\[/);
});
