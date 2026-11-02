import { createHash, createHmac } from "node:crypto";
import { Miniflare } from "miniflare";
import { describe, expect, it, vi } from "vitest";
import { createR2Storage, createStorage, type R2BucketLike } from "../../src/ts/storage.ts";
import type { Config } from "../../src/ts/types.ts";

const CONFIG: Config = {
  ODOO_EXPORT_PROVIDER: "r2",
  ODOO_EXPORT_BUCKET: "private-exports",
  ODOO_EXPORT_ENDPOINT: "https://account.r2.cloudflarestorage.com",
  AWS_ACCESS_KEY_ID: "test-key",
  AWS_SECRET_ACCESS_KEY: "test-secret",
};

const key = `exports/v1/5400/${"a".repeat(32)}.json`;
const modified = "Mon, 02 Nov 2026 12:00:00 GMT";

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of items) result.push(item);
  return result;
}

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Expected fixture value");
  return value;
}

describe("S3 and R2 fetch storage", () => {
  it("independently verifies SigV4 links and detects a tampered object key or expiry", async () => {
    const store = createStorage(CONFIG);
    const signed = await store.sign(key, 3600);
    const verify = (value: string): boolean => {
      const url = new URL(value);
      const signature = url.searchParams.get("X-Amz-Signature");
      const timestamp = required(url.searchParams.get("X-Amz-Date"));
      const credential = required(url.searchParams.get("X-Amz-Credential")).split("/");
      url.searchParams.delete("X-Amz-Signature");
      const encode = (text: string): string =>
        encodeURIComponent(text).replace(
          /[!'()*]/g,
          (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
        );
      const query = [...url.searchParams]
        .map(([name, value]) => `${encode(name)}=${encode(value)}`)
        .sort()
        .join("&");
      const canonical = `GET\n${url.pathname}\n${query}\nhost:${url.host}\n\nhost\nUNSIGNED-PAYLOAD`;
      let signingKey = Buffer.from(`AWS4${CONFIG.AWS_SECRET_ACCESS_KEY}`);
      for (const part of credential.slice(1))
        signingKey = createHmac("sha256", signingKey).update(part).digest();
      const message = `AWS4-HMAC-SHA256\n${timestamp}\n${credential.slice(1).join("/")}\n${createHash("sha256").update(canonical).digest("hex")}`;
      return createHmac("sha256", signingKey).update(message).digest("hex") === signature;
    };
    expect(verify(signed)).toBe(true);
    const tampered = new URL(signed);
    tampered.searchParams.set("X-Amz-Expires", "604800");
    expect(verify(tampered.href)).toBe(false);
    expect(verify(signed.replace(key, `${key}.other`))).toBe(false);
  });

  it("resolves current workload credentials before every signature and storage request", async () => {
    let revision = 0;
    const resolve = vi.fn(async () => ({
      accessKeyId: `role-key-${revision++}`,
      secretAccessKey: "role-secret",
      sessionToken: `session-${revision}`,
    }));
    const requests: Request[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      requests.push(input as Request);
      return new Response(null, { headers: { "Last-Modified": modified } });
    };
    const store = createStorage(
      { ...CONFIG, AWS_ACCESS_KEY_ID: undefined, AWS_SECRET_ACCESS_KEY: undefined },
      fetchImpl,
      resolve,
    );
    expect(new URL(await store.sign(key, 60)).searchParams.get("X-Amz-Credential")).toContain(
      "role-key-0/",
    );
    expect(new URL(await store.sign(key, 60)).searchParams.get("X-Amz-Credential")).toContain(
      "role-key-1/",
    );
    await store.head(key);
    expect(requests[0].headers.get("Authorization")).toContain("Credential=role-key-2/");
    expect(resolve).toHaveBeenCalledTimes(3);
  });

  it("sanitizes workload credential resolution failures", async () => {
    const store = createStorage(CONFIG, fetch, async () => {
      throw new Error("private role credentials");
    });
    await expect(store.sign(key, 60)).rejects.toThrow("Private export storage operation failed");
  });

  it("generates HTTPS S3 presigned URLs without performing a request", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const store = createStorage(
      {
        ...CONFIG,
        AWS_ENDPOINT_URL_S3: "https://wrong.test",
        AWS_SESSION_TOKEN: "temporary-session",
      },
      fetchImpl,
    );
    const url = new URL(await store.sign(key, 3600));
    expect(url.origin).toBe(CONFIG.ODOO_EXPORT_ENDPOINT);
    expect(url.pathname).toBe(`/private-exports/${key}`);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("3600");
    expect(url.searchParams.get("X-Amz-Credential")).toContain("/auto/s3/aws4_request");
    expect(url.searchParams.get("X-Amz-Security-Token")).toBe("temporary-session");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[a-f0-9]{64}$/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("supports standard AWS region and optional environment endpoint without exposing credentials", async () => {
    const store = createStorage({
      ...CONFIG,
      ODOO_EXPORT_PROVIDER: "s3",
      ODOO_EXPORT_ENDPOINT: undefined,
      AWS_REGION: "eu-west-1",
    });
    const url = new URL(await store.sign(key, 60));
    expect(url.hostname).toBe("s3.eu-west-1.amazonaws.com");
    expect(url.searchParams.get("X-Amz-Credential")).toContain("/eu-west-1/s3/");
    expect(url.href).not.toContain("test-secret");
  });

  it("uploads exact bytes with private download metadata and gets provider timestamp", async () => {
    const calls: Request[] = [];
    const payloads: Uint8Array[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      calls.push(request);
      if (request.method === "PUT") payloads.push(new Uint8Array(await request.arrayBuffer()));
      return new Response(null, { headers: { "Last-Modified": modified } });
    };
    const store = createStorage(CONFIG, fetchImpl);
    const content = new Uint8Array([0, 255, 1, 10]);
    await store.put(key, content, {
      "Content-Type": "image/png",
      "Cache-Control": "no-store",
      "Content-Disposition": "attachment; filename=test.png",
    });
    expect(payloads).toEqual([content]);
    expect(calls[0].headers.get("Authorization")).toMatch(/^AWS4-HMAC-SHA256 /);
    expect(calls[0].headers.get("Content-Disposition")).toBe("attachment; filename=test.png");
    expect(calls[0].headers.get("Cache-Control")).toBe("no-store");
    expect(await store.head(key)).toEqual({ key, lastModified: new Date(modified) });
    await store.delete(key);
    expect(calls.map((request) => request.method)).toEqual(["PUT", "HEAD", "DELETE"]);
  });

  it("lists every page, decodes XML names and preserves continuation tokens", async () => {
    const calls: URL[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL((input as Request).url);
      calls.push(url);
      const contents =
        calls.length === 1
          ? "<Contents><Key>exports/v1/a&amp;b&#x2f;c</Key><LastModified>2026-11-02T12:00:00Z</LastModified></Contents><IsTruncated>true</IsTruncated><NextContinuationToken>next+&amp;/token</NextContinuationToken>"
          : "<Contents><Key>exports/v1/second</Key><LastModified>2026-11-02T12:00:01Z</LastModified></Contents><IsTruncated>false</IsTruncated>";
      return new Response(
        `<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">${contents}</ListBucketResult>`,
      );
    };
    const store = createStorage(CONFIG, fetchImpl);
    const objects = await collect(store.list("exports/v1/"));
    expect(objects.map((object) => object.key)).toEqual(["exports/v1/a&b/c", "exports/v1/second"]);
    expect(calls[1].searchParams.get("continuation-token")).toBe("next+&/token");
    expect(calls[0].searchParams.get("prefix")).toBe("exports/v1/");
  });

  it("rejects failed, malformed and nonadvancing listings", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    fetchImpl.mockResolvedValueOnce(new Response("private details", { status: 403 }));
    const store = createStorage(CONFIG, fetchImpl);
    await expect(store.head(key)).rejects.toThrow("Private export storage operation failed");
    fetchImpl.mockResolvedValueOnce(new Response("not a listing"));
    await expect(collect(store.list("exports/v1/"))).rejects.toThrow(
      "Private export storage operation failed",
    );
    fetchImpl.mockResolvedValueOnce(
      new Response("<ListBucketResult><IsTruncated>true</IsTruncated></ListBucketResult>"),
    );
    await expect(collect(store.list("exports/v1/"))).rejects.toThrow(
      "Private export storage operation failed",
    );
  });

  it.each([
    { ODOO_EXPORT_ENDPOINT: "http://insecure.test" },
    { ODOO_EXPORT_ENDPOINT: "https://user:secret@private.test" },
    { ODOO_EXPORT_ENDPOINT: "https://private.test?token=secret" },
    { AWS_SECRET_ACCESS_KEY: undefined },
    { ODOO_EXPORT_BUCKET: "" },
    { ODOO_EXPORT_PROVIDER: "other" },
    { ODOO_EXPORT_ENDPOINT: undefined },
  ])("rejects invalid configuration without echoing it: %o", (changes) => {
    expect(() => createStorage({ ...CONFIG, ...changes })).toThrow(
      "Private export storage is not configured correctly",
    );
  });
});

describe("native R2 binding", () => {
  it("uses native object operations while keeping the signer separate", async () => {
    const mf = new Miniflare({
      modules: true,
      script: "export default { fetch() { return new Response('ok'); } };",
      r2Buckets: ["EXPORTS"],
    });
    try {
      const bucket = await mf.getR2Bucket("EXPORTS");
      const signer = vi.fn(
        async (objectKey: string, ttl: number) => `https://private.test/${objectKey}?ttl=${ttl}`,
      );
      const store = createR2Storage(bucket as unknown as R2BucketLike, signer);
      const bytes = new Uint8Array([0, 255, 7]);
      await store.put(key, bytes, {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
        "Content-Disposition": "attachment; filename=hello.png",
      });
      const object = required(await bucket.get(key));
      expect(new Uint8Array(await object.arrayBuffer())).toEqual(bytes);
      expect(object.httpMetadata).toMatchObject({
        contentType: "image/png",
        cacheControl: "no-store",
        contentDisposition: "attachment; filename=hello.png",
      });
      expect(await store.head(key)).toEqual({ key, lastModified: object.uploaded });
      expect((await collect(store.list("exports/v1/"))).map((item) => item.key)).toEqual([key]);
      expect(await store.sign(key, 60)).toBe(`https://private.test/${key}?ttl=60`);
      expect(signer).toHaveBeenCalledExactlyOnceWith(key, 60);
      await store.delete(key);
      expect(await bucket.head(key)).toBeNull();
      await expect(store.head(key)).rejects.toMatchObject({ name: "NotFoundError" });
    } finally {
      await mf.dispose();
    }
  });

  it("paginates native listings", async () => {
    const bucket = {
      list: vi
        .fn()
        .mockResolvedValueOnce({
          objects: [{ key: "first", uploaded: new Date(modified) }],
          truncated: true,
          cursor: "next",
        })
        .mockResolvedValueOnce({
          objects: [{ key: "second", uploaded: new Date(modified) }],
          truncated: false,
        }),
    } as unknown as R2BucketLike;
    const store = createR2Storage(bucket, async () => "https://private.test");
    expect((await collect(store.list("exports/v1/"))).map((item) => item.key)).toEqual([
      "first",
      "second",
    ]);
    expect(bucket.list).toHaveBeenLastCalledWith({ prefix: "exports/v1/", cursor: "next" });
  });
});

function hex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (character) =>
    character.charCodeAt(0),
  );
}

async function gcsFixture(fetchImpl: typeof fetch) {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const privateKey = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...pkcs8))}\n-----END PRIVATE KEY-----`;
  const store = createStorage(
    {
      ODOO_EXPORT_PROVIDER: "gcs",
      ODOO_EXPORT_BUCKET: "private-exports",
      GOOGLE_SERVICE_ACCOUNT_KEY: JSON.stringify({
        client_email: "exporter@example.iam.gserviceaccount.com",
        private_key: privateKey,
      }),
    },
    fetchImpl,
  );
  return { store, pair };
}

describe("GCS service account storage", () => {
  it("generates an independently verifiable V4 RSA signature without a network call", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const { store, pair } = await gcsFixture(fetchImpl);
    const url = new URL(await store.sign(key, 3600));
    const signature = required(url.searchParams.get("X-Goog-Signature"));
    expect(url.origin).toBe("https://storage.googleapis.com");
    expect(url.searchParams.get("X-Goog-Expires")).toBe("3600");
    const timestamp = required(url.searchParams.get("X-Goog-Date"));
    const credential = required(url.searchParams.get("X-Goog-Credential"));
    url.searchParams.delete("X-Goog-Signature");
    const query = [...url.searchParams]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
      .join("&");
    const canonical = `GET\n${url.pathname}\n${query}\nhost:storage.googleapis.com\n\nhost\nUNSIGNED-PAYLOAD`;
    const digest = hex(
      new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical))),
    );
    const signed = `GOOG4-RSA-SHA256\n${timestamp}\n${credential.slice(credential.indexOf("/") + 1)}\n${digest}`;
    const bytes = Uint8Array.from(required(signature.match(/../g)), (byte) =>
      Number.parseInt(byte, 16),
    );
    expect(
      await crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        pair.publicKey,
        bytes,
        new TextEncoder().encode(signed),
      ),
    ).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses service-account OAuth, resumable upload metadata and provider timestamps", async () => {
    const calls: { url: URL; init?: RequestInit }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      calls.push({ url, init });
      if (url.hostname === "oauth2.googleapis.com")
        return Response.json({ access_token: "private-token", expires_in: 3600 });
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer private-token");
      if (init?.method === "POST")
        return new Response(null, {
          headers: { Location: "https://storage.googleapis.com/upload/session?upload_id=owned" },
        });
      if (init?.method === "GET") return Response.json({ updated: "2026-11-02T12:00:00Z" });
      return new Response(null);
    };
    const { store, pair } = await gcsFixture(fetchImpl);
    const content = new Uint8Array([1, 2, 3]);
    await store.put(key, content, {
      "Content-Type": "image/png",
      "Cache-Control": "no-store",
      "Content-Disposition": "attachment; filename=a.png",
    });
    const jwt = required(
      new URLSearchParams(calls[0].init?.body as URLSearchParams).get("assertion"),
    );
    const [header, claims, signature] = jwt.split(".");
    expect(
      await crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        pair.publicKey,
        decodeBase64Url(signature),
        new TextEncoder().encode(`${header}.${claims}`),
      ),
    ).toBe(true);
    const payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(claims)));
    expect(payload).toMatchObject({
      iss: "exporter@example.iam.gserviceaccount.com",
      aud: "https://oauth2.googleapis.com/token",
      scope: "https://www.googleapis.com/auth/devstorage.read_write",
    });
    expect(payload.exp - payload.iat).toBe(3600);
    expect(JSON.parse(calls[1].init?.body as string)).toEqual({
      name: key,
      contentType: "image/png",
      cacheControl: "no-store",
      contentDisposition: "attachment; filename=a.png",
    });
    expect(calls[2].init?.body).toBe(content);
    expect(await store.head(key)).toEqual({ key, lastModified: new Date(modified) });
    await store.delete(key);
    expect(calls.filter((call) => call.url.hostname === "oauth2.googleapis.com")).toHaveLength(1);
  });

  it("lists every GCS page using provider timestamps", async () => {
    let listing = 0;
    const pages: URL[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(input.toString());
      if (url.hostname === "oauth2.googleapis.com")
        return Response.json({ access_token: "token", expires_in: 3600 });
      pages.push(url);
      listing += 1;
      return Response.json({
        items: [{ name: `exports/v1/${listing}`, updated: "2026-11-02T12:00:00Z" }],
        ...(listing === 1 ? { nextPageToken: "next/page" } : {}),
      });
    };
    const { store } = await gcsFixture(fetchImpl);
    expect((await collect(store.list("exports/v1/"))).map((item) => item.key)).toEqual([
      "exports/v1/1",
      "exports/v1/2",
    ]);
    expect(pages[1].searchParams.get("pageToken")).toBe("next/page");
  });

  it("rejects malformed GCS signing credentials without exposing key material", () => {
    expect(() =>
      createStorage({
        ODOO_EXPORT_PROVIDER: "gcs",
        ODOO_EXPORT_BUCKET: "bucket",
        GOOGLE_SERVICE_ACCOUNT_KEY: "private malformed key",
      }),
    ).toThrow("Private export storage is not configured correctly");
  });
});
