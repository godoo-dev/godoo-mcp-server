import type { OdooClient } from "@godoo-dev/client";

export interface CatalogModelRow {
  model: string;
  name: string | boolean;
  info: string | boolean;
}
export interface CatalogSnapshot {
  schema_hash: string | null;
  models: CatalogModelRow[];
  cached: boolean;
}
interface CacheEntry {
  url: string;
  database: string;
  uid: number;
  expires: number;
  snapshot: Omit<CatalogSnapshot, "cached">;
}
const cache = new Map<string, CacheEntry>();
const ttl = 60 * 60 * 1000;
const maximum = 32;

export async function computeSchemaHash(client: OdooClient): Promise<string | null> {
  try {
    const probes = await Promise.all(
      ["ir.model", "ir.model.fields", "ir.module.module"].map((model) =>
        client.searchRead(
          model,
          model === "ir.module.module" ? [["state", "=", "installed"]] : [],
          {
            fields: ["write_date"],
            order: "write_date desc",
            limit: 1,
          },
        ),
      ),
    );
    return probes.map((rows) => rows[0]?.write_date || "").join("|");
  } catch {
    return null;
  }
}

function prune(): void {
  for (const [key, entry] of cache) if (entry.expires <= Date.now()) cache.delete(key);
}

export async function getCatalogSnapshot(
  client: OdooClient,
  url: string,
  database: string,
): Promise<CatalogSnapshot> {
  const schema_hash = await computeSchemaHash(client);
  if (schema_hash === null) return { schema_hash, models: [], cached: false };
  const uid = client.getSession()?.uid;
  const key = JSON.stringify([url, database, uid, schema_hash]);
  prune();
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return { ...structuredClone(hit.snapshot), cached: true };
  }
  const models = await client.searchRead<CatalogModelRow>(
    "ir.model",
    [["model", "in", ["mail.message", "res.users", "res.partner", "ir.attachment", "ir.ui.menu"]]],
    { fields: ["model", "name", "info"] },
  );
  const snapshot = { schema_hash, models };
  if (typeof uid === "number" && Number.isSafeInteger(uid) && uid > 0) {
    cache.set(key, {
      url,
      database,
      uid,
      expires: Date.now() + ttl,
      snapshot: structuredClone(snapshot),
    });
    while (cache.size > maximum) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
  }
  return { ...snapshot, cached: false };
}

export function getModelEntryFromCache(
  model: string,
  {
    url,
    database,
    uid,
  }: {
    url: string;
    database: string;
    uid: number;
  },
): CatalogModelRow | undefined {
  prune();
  for (const entry of cache.values()) {
    if (entry.url === url && entry.database === database && entry.uid === uid) {
      const result = entry.snapshot.models.find((row) => row.model === model);
      if (result) return structuredClone(result);
    }
  }
  return undefined;
}
