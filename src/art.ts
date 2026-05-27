export interface OutputOpts {
  isTTY: boolean;
  noColor: boolean;
  quiet: boolean;
}

const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const BLUE = "\x1b[34m";
const RESET = "\x1b[0m";

function color(s: string, code: string, opts: OutputOpts): string {
  if (opts.noColor || !opts.isTTY) return s;
  return code + s + RESET;
}

export function shouldShowWordmark(opts: OutputOpts): boolean {
  return opts.isTTY && !opts.quiet;
}

const WORDMARK_TEXT = [
  "                       _     ",
  " __   _____  _   _  ___| |__  ",
  " \\ \\ / / _ \\| | | |/ __| '_ \\ ",
  "  \\ V / (_) | |_| | (__| | | |",
  "   \\_/ \\___/ \\__,_|\\___|_| |_|",
  "   vouch — record why dependencies enter your repo",
].join("\n");

export function wordmark(opts: OutputOpts): string {
  return color(WORDMARK_TEXT, CYAN, opts);
}

const REVIEW_REQUIRED = [
  "          ╔═[ VOUCH CHECK ]════════════╗",
  "          ║  DEPENDENCY NEEDS REVIEW   ║",
  "          ║                            ║",
  "          ║  see reasons below ↓       ║",
  "          ╚════════════════════════════╝",
].join("\n");

export function blockBanner(opts: OutputOpts): string {
  return color(REVIEW_REQUIRED, YELLOW, opts);
}

export function success(s: string, opts: OutputOpts): string {
  return color(s, GREEN, opts);
}

export function warn(s: string, opts: OutputOpts): string {
  return color(s, YELLOW, opts);
}

export function blocked(s: string, opts: OutputOpts): string {
  return color(s, RED, opts);
}

export function muted(s: string, opts: OutputOpts): string {
  return color(s, BLUE, opts);
}
