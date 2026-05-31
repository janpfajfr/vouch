// The single place the '@' separator is disambiguated. '@' both prefixes a scope
// (@scope/pkg) and joins a name to a version (pkg@1.2.3); the version delimiter is the
// LAST '@', but only when it isn't the scope '@' at index 0.

export type LedgerKey = string & { readonly __brand: "LedgerKey" };

/** Split "name@version" into parts. Returns version=undefined for a bare name. */
export function splitNameVersion(s: string): { name: string; version: string | undefined } {
  const at = s.lastIndexOf("@");
  if (at > 0) return { name: s.slice(0, at), version: s.slice(at + 1) };
  return { name: s, version: undefined };
}

/** Build a ledger key — always "name@version"; the scope '@' is a prefix, never the delimiter. */
export function ledgerKey(name: string, version: string): LedgerKey {
  return `${name}@${version}` as LedgerKey;
}
