import { PublicError } from "./errors.ts";
import { createStorage } from "./storage.ts";
import type { ObjectStore, Runtime } from "./types.ts";

export const MAX_ARTIFACT_BYTES = 100 * 1024 * 1024;
const MANAGED_KEY = /^exports\/v1\/([1-9][0-9]*)\/[0-9a-f]{32}\.(?:json|bin)$/;

function exportError(message: string): PublicError {
  return new PublicError(message, "export_failed");
}

function settings(runtime: Runtime): { ttl: number; grace: number; retention: number } {
  const integer = (value: string | undefined, fallback: number): number => {
    if (value === undefined) return fallback;
    if (!/^[+-]?\d+$/.test(value.trim())) throw new Error("Invalid duration");
    return Number(value);
  };
  const ttl = integer(runtime.config.ODOO_EXPORT_URL_TTL_MINUTES, 60);
  const grace = integer(runtime.config.ODOO_EXPORT_CLEANUP_GRACE_MINUTES, 30);
  const retention = (ttl + grace) * 60;
  if (
    !Number.isSafeInteger(ttl) ||
    ttl < 1 ||
    ttl > 10080 ||
    !Number.isSafeInteger(grace) ||
    grace < 0 ||
    !Number.isSafeInteger(retention) ||
    !Number.isFinite(new Date(now(runtime).getTime() + retention * 1000).getTime())
  ) {
    throw new Error("Invalid duration");
  }
  return { ttl: ttl * 60, grace: grace * 60, retention };
}

function now(runtime: Runtime): Date {
  return runtime.now?.() ?? new Date();
}

function storage(runtime: Runtime): ObjectStore {
  return runtime.storage ?? createStorage(runtime.config, runtime.fetch);
}

function httpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

async function rollback(store: ObjectStore, key: string, runtime: Runtime): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      store.delete(key),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Cleanup timed out")), 5000);
      }),
    ]);
  } catch {
    runtime.log?.({ event: "export_object_cleanup_failed" });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export interface ArtifactOptions {
  source: Record<string, unknown>;
  mimetype?: string;
  filename?: string;
}

export async function deliverArtifact(
  content: Uint8Array,
  options: ArtifactOptions,
  runtime: Runtime,
): Promise<Record<string, unknown>> {
  if (content.byteLength > MAX_ARTIFACT_BYTES) {
    throw exportError("Content exceeds the 100 MiB artifact size limit");
  }
  let store: ObjectStore;
  let timing: ReturnType<typeof settings>;
  try {
    timing = settings(runtime);
    store = storage(runtime);
  } catch {
    throw exportError("Private export storage is not configured correctly");
  }
  const artifactId = crypto.randomUUID().replaceAll("-", "");
  const key = `exports/v1/${timing.retention}/${artifactId}.${options.filename === undefined ? "json" : "bin"}`;
  const expiresAt = new Date(Math.floor(now(runtime).getTime() / 1000) * 1000 + timing.ttl * 1000);
  try {
    // Sign first: provider upload time plus retention can never precede URL expiry plus grace.
    const url = await store.sign(key, timing.ttl);
    if (!httpsUrl(url)) throw new Error("Invalid signed URL");
    const metadata: Record<string, string> = {
      "Content-Type": options.mimetype ?? "application/json",
      "Cache-Control": "no-store",
    };
    if (options.filename !== undefined) {
      const filename = encodeURIComponent(options.filename).replace(
        /[!'()*]/g,
        (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
      );
      metadata["Content-Disposition"] = `attachment; filename*=UTF-8''${filename}`;
    }
    await store.put(key, content, metadata);
    const uploaded = await store.head(key);
    if (now(runtime) >= expiresAt || !Number.isFinite(uploaded.lastModified.getTime())) {
      throw new Error("Expired or invalid artifact");
    }
    const digest = await crypto.subtle.digest("SHA-256", content as BufferSource);
    return {
      delivery: "artifact",
      artifact_id: artifactId,
      download_url: url,
      expires_at: expiresAt.toISOString(),
      expires_in_seconds: timing.ttl,
      size_bytes: content.byteLength,
      sha256: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
        "",
      ),
      retention_seconds: timing.retention,
      cleanup_grace_seconds: timing.grace,
      delete_after: new Date(
        uploaded.lastModified.getTime() + timing.retention * 1000,
      ).toISOString(),
      source: options.source,
    };
  } catch {
    // A failed reply can follow a committed upload; delete only this invocation's random key.
    await rollback(store, key, runtime);
    throw exportError("Private export delivery failed");
  }
}

export interface RecordDeliveryOptions {
  maxReturnBytes?: number | null;
  model: string;
  tool: string;
  rowCount: number;
}

export async function deliverRecordResult(
  result: Record<string, unknown>,
  options: RecordDeliveryOptions,
  runtime: Runtime,
): Promise<Record<string, unknown>> {
  const bound = options.maxReturnBytes === undefined ? 500 : options.maxReturnBytes;
  if (bound === null) return result;
  if (!Number.isSafeInteger(bound) || bound < 0) {
    throw new PublicError("max_return_bytes must be a nonnegative integer or null");
  }
  let content: Uint8Array;
  try {
    content = new TextEncoder().encode(JSON.stringify(result));
  } catch {
    throw exportError("Private export delivery failed");
  }
  if (content.byteLength <= bound) return result;
  const receipt = await deliverArtifact(
    content,
    { source: { tool: options.tool, model: options.model } },
    runtime,
  );
  const properties = Object.fromEntries(
    Object.keys(result).map((name) => [
      name,
      { type: name === "records" ? "array" : name === "count" ? "integer" : "object" },
    ]),
  );
  return {
    ...receipt,
    format: "json",
    encoding: "utf-8",
    schema: { type: "object", properties },
    row_count: options.rowCount,
  };
}

export async function cleanupExpired(runtime: Runtime): Promise<number> {
  const store = storage(runtime);
  const cutoff = now(runtime).getTime();
  let deleted = 0;
  for await (const object of store.list("exports/v1/")) {
    const match = MANAGED_KEY.exec(object.key);
    if (!match) continue;
    const duration = Number(match[1]);
    const deadline = object.lastModified.getTime() + duration * 1000;
    if (!Number.isSafeInteger(duration) || !Number.isFinite(deadline) || deadline > cutoff)
      continue;
    try {
      await store.delete(object.key);
      deleted += 1;
    } catch (error) {
      if (error instanceof Error && error.name === "NotFoundError") continue;
      runtime.log?.({ event: "export_object_cleanup_failed" });
    }
  }
  return deleted;
}
