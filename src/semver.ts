// Minimal semver range satisfaction — vouch has zero runtime deps, so no `semver` library.
// Covers the range syntaxes that actually appear in package.json (exact, ^, ~, x-ranges,
// comparators, ||). Anything it cannot parse confidently returns null: the caller treats
// null as "skip" so an unrecognised range never produces a false version-drift warning.

type V = [number, number, number];

function parseVersion(s: string): V | null {
  const core = s.trim().replace(/^[v=]+/, "").split(/[-+]/)[0];
  const parts = core.split(".");
  if (parts.length === 0 || parts.length > 3) return null;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isInteger(n) || n < 0)) return null;
  return [nums[0], nums[1] ?? 0, nums[2] ?? 0];
}

function cmp(a: V, b: V): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}

function caret(base: string, ver: V): boolean | null {
  const v = parseVersion(base);
  if (!v) return null;
  if (cmp(ver, v) < 0) return false;
  let upper: V;
  if (v[0] !== 0) upper = [v[0] + 1, 0, 0];
  else if (v[1] !== 0) upper = [0, v[1] + 1, 0];
  else upper = [0, 0, v[2] + 1];
  return cmp(ver, upper) < 0;
}

function tilde(base: string, ver: V): boolean | null {
  const partCount = base.trim().replace(/^[v=]+/, "").split(".").length;
  const v = parseVersion(base);
  if (!v) return null;
  if (cmp(ver, v) < 0) return false;
  const upper: V = partCount >= 2 ? [v[0], v[1] + 1, 0] : [v[0] + 1, 0, 0];
  return cmp(ver, upper) < 0;
}

function xRangeOrExact(c: string, ver: V): boolean | null {
  const parts = c.replace(/^[v=]+/, "").split(".");
  if (parts.length === 0 || parts.length > 3) return null;
  const nums: (number | null)[] = [];
  for (const p of parts) {
    if (p === "x" || p === "X" || p === "*") nums.push(null);
    else {
      const n = Number(p);
      if (!Number.isInteger(n) || n < 0) return null;
      nums.push(n);
    }
  }
  if (nums.length === 3 && nums.every((n) => n !== null)) {
    return ver[0] === nums[0] && ver[1] === nums[1] && ver[2] === nums[2];
  }
  for (let i = 0; i < nums.length; i++) {
    if (nums[i] === null) break;
    if (ver[i] !== nums[i]) return false;
  }
  return true;
}

function testComparator(c: string, ver: V): boolean | null {
  c = c.trim();
  if (c === "" || c === "*" || c === "x" || c === "X") return true;
  if (c.startsWith("^")) return caret(c.slice(1), ver);
  if (c.startsWith("~")) return tilde(c.slice(1), ver);
  const m = c.match(/^(>=|<=|>|<|=)\s*(.+)$/);
  if (m) {
    const v = parseVersion(m[2]);
    if (!v) return null;
    const r = cmp(ver, v);
    switch (m[1]) {
      case ">=": return r >= 0;
      case "<=": return r <= 0;
      case ">": return r > 0;
      case "<": return r < 0;
      default: return r === 0;
    }
  }
  return xRangeOrExact(c, ver);
}

function evalAnd(branch: string, ver: V): boolean | null {
  if (branch === "") return true;
  let sawNull = false;
  let anyFalse = false;
  for (const c of branch.split(/\s+/)) {
    const res = testComparator(c, ver);
    if (res === null) sawNull = true;
    else if (res === false) anyFalse = true;
  }
  // null wins over false: if any part of the branch is unparseable we cannot claim the
  // version is out of range, so we skip rather than risk a false drift warning.
  if (sawNull) return null;
  return anyFalse ? false : true;
}

/** Does `version` satisfy `range`? null = the range syntax isn't supported (skip it). */
export function satisfiesRange(version: string, range: string): boolean | null {
  const ver = parseVersion(version);
  if (!ver) return null;
  const r = (range ?? "").trim();
  if (r === "" || r === "*" || r === "x" || r === "X") return true;
  let sawNull = false;
  for (const branch of r.split("||")) {
    const res = evalAnd(branch.trim(), ver);
    if (res === true) return true;
    if (res === null) sawNull = true;
  }
  return sawNull ? null : false;
}
