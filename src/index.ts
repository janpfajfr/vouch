// Public package entry for `import { defineConfig } from "@vouchjs/vouch"` in a vouch.config.{ts,js,mjs}.
// The runtime CLI lives in src/cli.ts (bin entry); this is the typed API surface.

import type { Config } from "./config.js";

export type { Config, CheckMode, Severity, PackageManager } from "./config.js";

/** Define a vouch config with full TypeScript autocomplete + validation at edit time.
 *  Returns the config unchanged — its only purpose is to give your editor the type. */
export function defineConfig(config: Partial<Config>): Partial<Config> {
  return config;
}
