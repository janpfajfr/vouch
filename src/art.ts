export interface OutputOpts { isTTY: boolean; noColor: boolean; quiet: boolean; }

const MAGENTA = "\x1b[35m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

function color(s: string, code: string, opts: OutputOpts): string {
  if (opts.noColor || !opts.isTTY) return s;
  return code + s + RESET;
}

export function shouldShowWordmark(opts: OutputOpts): boolean {
  return opts.isTTY && !opts.quiet;
}

const WORDMARK_TEXT = [
  "  __  _____  _   _   ____  _  _   _   _    _    _  _  ___ _____ ",
  " |  \\/  / _ \\| | | | / ___|| || | /_\\ | |  | |  | \\| |/ _ \\_   _|",
  " | |\\/| | (_) | |_| | \\___ \\ __ |/ _ \\| |__| |__| .  | (_) || |  ",
  " |_|  |_|\\___/ \\___/  |____/_||_/_/ \\_\\____|____|_|\\_|\\___/ |_|  ",
  "          you-shall-not-add — review before it enters the repo",
].join("\n");

export function wordmark(opts: OutputOpts): string {
  return color(WORDMARK_TEXT, CYAN, opts);
}

const GATE = [
  "          .:*~*:._.:*~*:._.:*~*:.",
  "         |   🚫  DEPENDENCY  GATE  🚫   |",
  "         |                              |",
  "         |      PACKAGE  REJECTED      |",
  "          ':*~*:._.:*~*:._.:*~*:.'",
].join("\n");

export function blockBanner(opts: OutputOpts): string {
  return color(GATE, MAGENTA, opts);
}
