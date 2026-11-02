import { AwsClient } from "aws4fetch";
import { PublicError } from "./errors.ts";
import type { Config, ObjectStore, StoredObject } from "./types.ts";

function failure(message = "Private export storage operation failed"): PublicError {
  return new PublicError(message, "export_failed");
}

function encode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function path(value: string): string {
  return value.split("/").map(encode).join("/");
}

function endpoint(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw failure("Private export storage is not configured correctly");
  }
  return url;
}

function missing(): Error {
  const error = new Error("Stored artifact not found");
  error.name = "NotFoundError";
  return error;
}

function checkedDate(value: string | null | undefined): Date {
  const date = new Date(value ?? "");
  if (!Number.isFinite(date.getTime())) throw failure();
  return date;
}

async function check(response: Response): Promise<Response> {
  if (response.ok) return response;
  await response.body?.cancel();
  if (response.status === 404) throw missing();
  throw failure();
}

function xml(value: string): string {
  return value.replace(
    /&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/gi,
    (_match, entity: string) => {
      if (entity.startsWith("#x"))
        return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
      if (entity.startsWith("#")) return String.fromCodePoint(Number(entity.slice(1)));
      return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string, string>)[
        entity
      ];
    },
  );
}

function element(document: string, name: string): string | undefined {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(document);
  return match ? xml(match[1]) : undefined;
}

export type AwsCredentialsResolver = () => Promise<{
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}>;

function s3Storage(
  config: Config,
  fetchImpl: typeof fetch,
  resolveCredentials?: AwsCredentialsResolver,
): ObjectStore {
  const bucket = config.ODOO_EXPORT_BUCKET;
  const accessKeyId = config.AWS_ACCESS_KEY_ID;
  const secretAccessKey = config.AWS_SECRET_ACCESS_KEY;
  if (!bucket || (!resolveCredentials && (!accessKeyId || !secretAccessKey))) throw failure();
  const r2 = config.ODOO_EXPORT_PROVIDER?.toLowerCase() === "r2";
  const region = r2 ? "auto" : config.AWS_REGION || config.AWS_DEFAULT_REGION || "us-east-1";
  const address =
    config.ODOO_EXPORT_ENDPOINT || (!r2 && (config.AWS_ENDPOINT_URL_S3 || config.AWS_ENDPOINT_URL));
  if (r2 && !address) throw failure();
  const base = endpoint(address || `https://s3.${region}.amazonaws.com`);
  base.pathname = `${base.pathname.replace(/\/$/, "")}/${encode(bucket)}`;
  const client = async (): Promise<AwsClient> => {
    try {
      // The provider owns caching and refresh. Resolve before every signature so
      // long-running Node instances do not retain an expired workload identity.
      const credentials = resolveCredentials
        ? await resolveCredentials()
        : { accessKeyId, secretAccessKey, sessionToken: config.AWS_SESSION_TOKEN };
      if (!credentials.accessKeyId || !credentials.secretAccessKey) throw failure();
      return new AwsClient({
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        sessionToken: credentials.sessionToken,
        region,
        service: "s3",
        retries: 0,
      });
    } catch {
      throw failure();
    }
  };
  const url = (key?: string): URL => {
    const result = new URL(base);
    if (key !== undefined) result.pathname += `/${path(key)}`;
    return result;
  };
  const request = async (target: URL, init: RequestInit): Promise<Response> =>
    check(await fetchImpl(await (await client()).sign(target, init)));
  return {
    async sign(key, expiresInSeconds) {
      const target = url(key);
      target.searchParams.set("X-Amz-Expires", String(expiresInSeconds));
      return (await (await client()).sign(target, { method: "GET", aws: { signQuery: true } })).url;
    },
    async put(key, content, metadata) {
      const response = await request(url(key), {
        method: "PUT",
        headers: metadata,
        body: content as BodyInit,
      });
      await response.body?.cancel();
    },
    async head(key) {
      const response = await request(url(key), { method: "HEAD" });
      return { key, lastModified: checkedDate(response.headers.get("last-modified")) };
    },
    async *list(prefix) {
      let cursor: string | undefined;
      do {
        const target = url();
        target.searchParams.set("list-type", "2");
        target.searchParams.set("prefix", prefix);
        if (cursor) target.searchParams.set("continuation-token", cursor);
        const response = await request(target, { method: "GET" });
        const document = await response.text();
        if (!/<ListBucketResult(?:\s|>)/.test(document)) throw failure();
        for (const match of document.matchAll(/<Contents(?:\s[^>]*)?>([\s\S]*?)<\/Contents>/g)) {
          const key = element(match[1], "Key");
          if (key === undefined) throw failure();
          yield { key, lastModified: checkedDate(element(match[1], "LastModified")) };
        }
        const next = element(document, "NextContinuationToken");
        if (element(document, "IsTruncated") === "true" && (!next || next === cursor))
          throw failure();
        cursor = element(document, "IsTruncated") === "true" ? next : undefined;
      } while (cursor);
    },
    async delete(key) {
      const response = await request(url(key), { method: "DELETE" });
      await response.body?.cancel();
    },
  };
}

function bytesBase64(bytes: Uint8Array): string {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}

function base64Url(bytes: Uint8Array): string {
  return bytesBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function gcsStorage(config: Config, fetchImpl: typeof fetch): ObjectStore {
  const bucket = config.ODOO_EXPORT_BUCKET;
  const account = JSON.parse(config.GOOGLE_SERVICE_ACCOUNT_KEY || "{}") as Record<string, unknown>;
  if (
    !bucket ||
    typeof account.client_email !== "string" ||
    typeof account.private_key !== "string"
  ) {
    throw failure();
  }
  const email = account.client_email;
  const pem = account.private_key;
  let signingKey: Promise<CryptoKey> | undefined;
  const rsaSign = async (value: string): Promise<Uint8Array> => {
    signingKey ??= crypto.subtle.importKey(
      "pkcs8",
      Uint8Array.from(
        atob(pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "")),
        (character) => character.charCodeAt(0),
      ),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
    return new Uint8Array(
      await crypto.subtle.sign(
        "RSASSA-PKCS1-v1_5",
        await signingKey,
        new TextEncoder().encode(value),
      ),
    );
  };
  let cachedToken: { value: string; expiresAt: number } | undefined;
  let pendingToken: Promise<string> | undefined;
  const accessToken = async (): Promise<string> => {
    if (cachedToken && Date.now() < cachedToken.expiresAt - 60000) return cachedToken.value;
    pendingToken ??= (async () => {
      const issued = Math.floor(Date.now() / 1000);
      const header = base64Url(
        new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })),
      );
      const claims = base64Url(
        new TextEncoder().encode(
          JSON.stringify({
            iss: email,
            scope: "https://www.googleapis.com/auth/devstorage.read_write",
            aud: "https://oauth2.googleapis.com/token",
            iat: issued,
            exp: issued + 3600,
          }),
        ),
      );
      const unsigned = `${header}.${claims}`;
      const assertion = `${unsigned}.${base64Url(await rsaSign(unsigned))}`;
      const response = await check(
        await fetchImpl("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
            assertion,
          }),
        }),
      );
      const token = (await response.json()) as { access_token?: string; expires_in?: number };
      if (
        !token.access_token ||
        !Number.isFinite(token.expires_in) ||
        (token.expires_in ?? 0) <= 0
      ) {
        throw failure();
      }
      cachedToken = {
        value: token.access_token,
        expiresAt: Date.now() + (token.expires_in ?? 0) * 1000,
      };
      return token.access_token;
    })();
    try {
      return await pendingToken;
    } finally {
      pendingToken = undefined;
    }
  };
  const api = `https://storage.googleapis.com/storage/v1/b/${encode(bucket)}/o`;
  const request = async (target: string | URL, init: RequestInit): Promise<Response> => {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${await accessToken()}`);
    return check(await fetchImpl(target, { ...init, headers }));
  };
  return {
    async sign(key, expiresInSeconds) {
      const timestamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
      const scope = `${timestamp.slice(0, 8)}/auto/storage/goog4_request`;
      const pairs = [
        ["X-Goog-Algorithm", "GOOG4-RSA-SHA256"],
        ["X-Goog-Credential", `${email}/${scope}`],
        ["X-Goog-Date", timestamp],
        ["X-Goog-Expires", String(expiresInSeconds)],
        ["X-Goog-SignedHeaders", "host"],
      ];
      const query = pairs
        .map(([key, value]) => `${encode(key)}=${encode(value)}`)
        .sort()
        .join("&");
      const canonicalPath = `/${encode(bucket)}/${path(key)}`;
      const canonical = `GET\n${canonicalPath}\n${query}\nhost:storage.googleapis.com\n\nhost\nUNSIGNED-PAYLOAD`;
      const signature = await rsaSign(
        `GOOG4-RSA-SHA256\n${timestamp}\n${scope}\n${await sha256(canonical)}`,
      );
      const hex = Array.from(signature, (byte) => byte.toString(16).padStart(2, "0")).join("");
      return `https://storage.googleapis.com${canonicalPath}?${query}&X-Goog-Signature=${hex}`;
    },
    async put(key, content, metadata) {
      const start = new URL(
        `https://storage.googleapis.com/upload/storage/v1/b/${encode(bucket)}/o`,
      );
      start.searchParams.set("uploadType", "resumable");
      const response = await request(start, {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "X-Upload-Content-Type": metadata["Content-Type"] || "application/octet-stream",
          "X-Upload-Content-Length": String(content.byteLength),
        },
        body: JSON.stringify({
          name: key,
          contentType: metadata["Content-Type"],
          cacheControl: metadata["Cache-Control"],
          contentDisposition: metadata["Content-Disposition"],
        }),
      });
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw failure();
      const uploadUrl = new URL(location);
      if (
        uploadUrl.protocol !== "https:" ||
        uploadUrl.hostname !== "storage.googleapis.com" ||
        uploadUrl.username ||
        uploadUrl.password
      )
        throw failure();
      const uploaded = await request(location, { method: "PUT", body: content as BodyInit });
      await uploaded.body?.cancel();
    },
    async head(key) {
      const response = await request(`${api}/${encode(key)}?fields=updated`, { method: "GET" });
      const object = (await response.json()) as { updated?: string };
      return { key, lastModified: checkedDate(object.updated) };
    },
    async *list(prefix) {
      let cursor: string | undefined;
      do {
        const target = new URL(api);
        target.searchParams.set("prefix", prefix);
        target.searchParams.set("fields", "items(name,updated),nextPageToken");
        if (cursor) target.searchParams.set("pageToken", cursor);
        const response = await request(target, { method: "GET" });
        const page = (await response.json()) as {
          items?: { name: string; updated: string }[];
          nextPageToken?: string;
        };
        for (const item of page.items ?? []) {
          yield { key: item.name, lastModified: checkedDate(item.updated) };
        }
        if (page.nextPageToken && page.nextPageToken === cursor) throw failure();
        cursor = page.nextPageToken;
      } while (cursor);
    },
    async delete(key) {
      const response = await request(`${api}/${encode(key)}`, { method: "DELETE" });
      await response.body?.cancel();
    },
  };
}

export function createStorage(
  config: Config,
  fetchImpl: typeof fetch = fetch,
  resolveCredentials?: AwsCredentialsResolver,
): ObjectStore {
  try {
    const provider = config.ODOO_EXPORT_PROVIDER?.toLowerCase();
    if (!config.ODOO_EXPORT_BUCKET) throw failure();
    if (provider === "r2" || provider === "s3")
      return s3Storage(config, fetchImpl, resolveCredentials);
    if (provider === "gcs") return gcsStorage(config, fetchImpl);
    throw failure();
  } catch {
    throw failure("Private export storage is not configured correctly");
  }
}

export interface R2BucketLike {
  put(
    key: string,
    value: Uint8Array,
    options: {
      httpMetadata: { contentType?: string; cacheControl?: string; contentDisposition?: string };
    },
  ): Promise<unknown>;
  head(key: string): Promise<{ key: string; uploaded: Date } | null>;
  list(options: { prefix: string; cursor?: string }): Promise<{
    objects: { key: string; uploaded: Date }[];
    truncated: boolean;
    cursor?: string;
  }>;
  delete(key: string): Promise<void>;
}

export function createR2Storage(
  bucket: R2BucketLike,
  signer: Pick<ObjectStore, "sign"> | ObjectStore["sign"],
): ObjectStore {
  return {
    sign: typeof signer === "function" ? signer : signer.sign.bind(signer),
    async put(key, content, metadata) {
      await bucket.put(key, content, {
        httpMetadata: {
          contentType: metadata["Content-Type"],
          cacheControl: metadata["Cache-Control"],
          contentDisposition: metadata["Content-Disposition"],
        },
      });
    },
    async head(key): Promise<StoredObject> {
      const object = await bucket.head(key);
      if (!object) throw missing();
      return { key, lastModified: object.uploaded };
    },
    async *list(prefix) {
      let cursor: string | undefined;
      do {
        const result = await bucket.list({ prefix, ...(cursor ? { cursor } : {}) });
        for (const object of result.objects)
          yield { key: object.key, lastModified: object.uploaded };
        if (result.truncated && (!result.cursor || result.cursor === cursor)) throw failure();
        cursor = result.truncated ? result.cursor : undefined;
      } while (cursor);
    },
    async delete(key) {
      await bucket.delete(key);
    },
  };
}
