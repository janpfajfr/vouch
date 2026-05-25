export interface Alternative { type: "builtin" | "existing"; message: string; }

const BUILTINS: Record<string, string> = {
  uuid: "Node has crypto.randomUUID() built in.",
  "node-fetch": "Node 18+ has a global fetch().",
  "left-pad": "Use String.prototype.padStart().",
  rimraf: "Use fs.rm(path, { recursive: true, force: true }).",
};

const EQUIVALENTS: Record<string, string[]> = {
  lodash: ["remeda", "es-toolkit"],
  moment: ["date-fns", "dayjs"],
  axios: ["ky", "ofetch"],
};

export function findAlternatives(
  pkg: string,
  existingDeps: string[],
  overrides: Record<string, string>,
): Alternative[] {
  const out: Alternative[] = [];
  if (BUILTINS[pkg]) out.push({ type: "builtin", message: BUILTINS[pkg] });
  if (overrides[pkg]) out.push({ type: "builtin", message: overrides[pkg] });
  const installed = (EQUIVALENTS[pkg] ?? []).filter((e) => existingDeps.includes(e));
  for (const e of installed) out.push({ type: "existing", message: `Project already uses "${e}"; prefer it unless "${pkg}" is required.` });
  return out;
}
