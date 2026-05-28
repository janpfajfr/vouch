export interface PackageMetadata {
  name: string;
  version: string;
  publishedAt: Date | null;
  scripts: Record<string, string>;
  deprecated: boolean;
}

export interface RegistryClient {
  fetchMetadata(name: string, versionSpec?: string): Promise<PackageMetadata>;
}

export class PackageNotFoundError extends Error {}
export class RegistryUnavailableError extends Error {}

interface RawDoc {
  "dist-tags"?: Record<string, string>;
  versions?: Record<string, any>;
  time?: Record<string, string>;
}

export function normalizeMetadata(name: string, versionSpec: string | undefined, doc: RawDoc): PackageMetadata {
  const version = versionSpec ?? doc["dist-tags"]?.latest;
  if (!version) throw new PackageNotFoundError(`No version resolved for ${name}`);
  const v = doc.versions?.[version];
  if (!v) throw new PackageNotFoundError(`Version ${version} not found for ${name}`);
  const timeStr = doc.time?.[version];
  return {
    name,
    version,
    publishedAt: timeStr ? new Date(timeStr) : null,
    scripts: v.scripts ?? {},
    deprecated: Boolean(v.deprecated),
  };
}

export class NpmRegistryClient implements RegistryClient {
  async fetchMetadata(name: string, versionSpec?: string): Promise<PackageMetadata> {
    let res: Response;
    try {
      res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`);
    } catch {
      throw new RegistryUnavailableError(`Could not reach the npm registry for ${name}.`);
    }
    if (res.status === 404) throw new PackageNotFoundError(`Package not found: ${name}`);
    if (!res.ok) throw new RegistryUnavailableError(`Registry returned ${res.status} for ${name}.`);
    const doc = (await res.json()) as RawDoc;
    return normalizeMetadata(name, versionSpec, doc);
  }
}
