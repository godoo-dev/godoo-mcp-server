import { describe, expect, it, vi } from "vitest";
import {
  cleanupExpired,
  deliverArtifact,
  deliverRecordResult,
  MAX_ARTIFACT_BYTES,
} from "../../src/ts/artifacts.ts";
import type { ObjectStore, Runtime, StoredObject } from "../../src/ts/types.ts";

const START = new Date("2026-11-02T12:00:00Z");

function fixture() {
  const objects = new Map<
    string,
    { content: Uint8Array; metadata: Record<string, string>; lastModified: Date }
  >();
  const events: string[] = [];
  const store: ObjectStore = {
    sign: vi.fn(async (key, ttl) => {
      events.push("sign");
      return `https://private.test/${key}?ttl=${ttl}`;
    }),
    put: vi.fn(async (key, content, metadata) => {
      events.push("put");
      objects.set(key, { content, metadata, lastModified: new Date(START.getTime() + 2000) });
    }),
    head: vi.fn(async (key) => {
      events.push("head");
      const object = objects.get(key);
      if (!object) throw new Error("Fixture object missing");
      return { key, lastModified: object.lastModified };
    }),
    async *list(prefix) {
      for (const [key, object] of objects)
        if (key.startsWith(prefix)) yield { key, lastModified: object.lastModified };
    },
    delete: vi.fn(async (key) => {
      objects.delete(key);
    }),
  };
  const runtime: Runtime = { config: {}, storage: store, now: () => START, log: vi.fn() };
  return { objects, events, store, runtime };
}

const options = { model: "res.partner", tool: "record_search", rowCount: 1 };

describe("record result delivery", () => {
  it("counts UTF-8 bytes and leaves an exact-boundary result inline", async () => {
    const { runtime, objects } = fixture();
    const result = {
      records: [{ id: 1, name: "mañana ☀" }],
      count: 1,
      web_urls: { "1": "https://odoo.test/1" },
    };
    const size = new TextEncoder().encode(JSON.stringify(result)).byteLength;
    expect(await deliverRecordResult(result, { ...options, maxReturnBytes: size }, runtime)).toBe(
      result,
    );
    const receipt = await deliverRecordResult(
      result,
      { ...options, maxReturnBytes: size - 1 },
      runtime,
    );
    expect(receipt).toMatchObject({
      delivery: "artifact",
      row_count: 1,
      format: "json",
      encoding: "utf-8",
      size_bytes: size,
    });
    expect(receipt.schema).toEqual({
      type: "object",
      properties: {
        records: { type: "array" },
        count: { type: "integer" },
        web_urls: { type: "object" },
      },
    });
    expect(JSON.parse(new TextDecoder().decode([...objects.values()][0].content))).toEqual(result);
  });

  it("supports default 500, null inline and zero forced artifact without requiring storage for inline", async () => {
    const result = { records: [], count: 0 };
    const runtime = { config: {} };
    expect(await deliverRecordResult(result, options, runtime)).toBe(result);
    expect(
      await deliverRecordResult(
        { records: ["x".repeat(1000)] },
        { ...options, maxReturnBytes: null },
        runtime,
      ),
    ).toHaveProperty("records");
    await expect(
      deliverRecordResult(result, { ...options, maxReturnBytes: 0 }, runtime),
    ).rejects.toThrow("Private export storage is not configured correctly");
    await expect(
      deliverRecordResult({ records: ["x".repeat(1000)] }, options, runtime),
    ).rejects.toThrow("Private export storage is not configured correctly");
  });

  it.each([
    -1,
    0.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])("rejects invalid byte limit %s", async (maxReturnBytes) => {
    await expect(
      deliverRecordResult({}, { ...options, maxReturnBytes }, fixture().runtime),
    ).rejects.toThrow("max_return_bytes");
  });
});

describe("private artifacts", () => {
  it("signs before upload and uses provider upload time for persisted retention", async () => {
    const { runtime, events, objects } = fixture();
    const receipt = await deliverArtifact(
      new TextEncoder().encode("hello"),
      { source: { tool: "record_read" } },
      runtime,
    );
    expect(events).toEqual(["sign", "put", "head"]);
    expect(receipt).toMatchObject({
      delivery: "artifact",
      expires_at: "2026-11-02T13:00:00.000Z",
      expires_in_seconds: 3600,
      retention_seconds: 5400,
      cleanup_grace_seconds: 1800,
      delete_after: "2026-11-02T13:30:02.000Z",
      sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    });
    const [key, object] = [...objects.entries()][0];
    expect(key).toMatch(/^exports\/v1\/5400\/[a-f0-9]{32}\.json$/);
    expect(object.metadata).toEqual({
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    expect(receipt).not.toHaveProperty("content");
  });

  it("uploads binary and safely encodes the attachment filename", async () => {
    const { runtime, objects } = fixture();
    await deliverArtifact(
      new Uint8Array([0, 255, 13, 10]),
      {
        source: { tool: "attachments_download" },
        mimetype: "image/png",
        filename: "a'!雪\r\n.png",
      },
      runtime,
    );
    const [key, object] = [...objects.entries()][0];
    expect(key.endsWith(".bin")).toBe(true);
    expect(object.metadata["Content-Disposition"]).toBe(
      "attachment; filename*=UTF-8''a%27%21%E9%9B%AA%0D%0A.png",
    );
    expect(object.content).toEqual(new Uint8Array([0, 255, 13, 10]));
  });

  it.each([
    "sign",
    "put",
    "head",
  ] as const)("sanitizes %s failure and rolls back the invocation key", async (step) => {
    const { runtime, objects, store } = fixture();
    const original = store[step];
    vi.spyOn(store, step).mockImplementationOnce(async (...args: unknown[]) => {
      if (step === "put") await (original as (...args: unknown[]) => Promise<unknown>)(...args);
      throw new Error("secret-password and business content");
    });
    await expect(
      deliverArtifact(new Uint8Array([1]), { source: {} }, runtime),
    ).rejects.toMatchObject({
      message: "Private export delivery failed",
      category: "export_failed",
    });
    expect(store.delete).toHaveBeenCalledOnce();
    expect(objects.size).toBe(0);
  });

  it("rolls back uploads rejected by cancellation", async () => {
    const { runtime, store, objects } = fixture();
    const put = store.put;
    store.put = async (...args) => {
      await put(...args);
      throw new DOMException("Request aborted with private details", "AbortError");
    };
    await expect(deliverArtifact(new Uint8Array([1]), { source: {} }, runtime)).rejects.toThrow(
      "Private export delivery failed",
    );
    expect(objects.size).toBe(0);
  });

  it("rejects unsafe signed URLs and cleans up expired slow uploads", async () => {
    const { runtime, store } = fixture();
    vi.mocked(store.sign).mockResolvedValueOnce("https://user:password@private.test/key");
    await expect(deliverArtifact(new Uint8Array([1]), { source: {} }, runtime)).rejects.toThrow(
      "Private export delivery failed",
    );
    expect(store.put).not.toHaveBeenCalled();
    let calls = 0;
    runtime.now = () => new Date(START.getTime() + (calls++ >= 2 ? 3600000 : 0));
    await expect(deliverArtifact(new Uint8Array([1]), { source: {} }, runtime)).rejects.toThrow(
      "Private export delivery failed",
    );
  });

  it("enforces decoded size before contacting storage", async () => {
    const { runtime, store } = fixture();
    await expect(
      deliverArtifact(new Uint8Array(MAX_ARTIFACT_BYTES + 1), { source: {} }, runtime),
    ).rejects.toThrow("100 MiB");
    expect(store.sign).not.toHaveBeenCalled();
  });

  it.each([
    { ODOO_EXPORT_URL_TTL_MINUTES: "0" },
    { ODOO_EXPORT_URL_TTL_MINUTES: "10081" },
    { ODOO_EXPORT_CLEANUP_GRACE_MINUTES: "-1" },
    { ODOO_EXPORT_URL_TTL_MINUTES: "1.5" },
    { ODOO_EXPORT_CLEANUP_GRACE_MINUTES: "999999999999999" },
  ])("rejects invalid timing configuration %o", async (config) => {
    const { runtime, store } = fixture();
    runtime.config = config;
    await expect(deliverArtifact(new Uint8Array([1]), { source: {} }, runtime)).rejects.toThrow(
      "Private export storage is not configured correctly",
    );
    expect(store.sign).not.toHaveBeenCalled();
  });

  it("logs cleanup failure without exposing provider exception text", async () => {
    const { runtime, store } = fixture();
    vi.mocked(store.sign).mockRejectedValue(new Error("secret"));
    vi.mocked(store.delete).mockRejectedValue(new Error("private object key"));
    await expect(deliverArtifact(new Uint8Array([1]), { source: {} }, runtime)).rejects.toThrow(
      "Private export delivery failed",
    );
    expect(runtime.log).toHaveBeenCalledWith({ event: "export_object_cleanup_failed" });
  });
});

describe("cleanup", () => {
  it("uses persisted per-object deadlines across config changes and exact expiry", async () => {
    const { runtime, objects } = fixture();
    const key = (duration: string, suffix = "json") =>
      `exports/v1/${duration}/${"a".repeat(32)}.${suffix}`;
    for (const name of [
      key("60"),
      key("5400", "bin"),
      key("5400"),
      key("0"),
      "other/file",
      key("60", "txt"),
      key("999999999999999999999999"),
    ]) {
      objects.set(name, { content: new Uint8Array(), metadata: {}, lastModified: START });
    }
    runtime.config = { ODOO_EXPORT_URL_TTL_MINUTES: "1", ODOO_EXPORT_CLEANUP_GRACE_MINUTES: "0" };
    runtime.now = () => new Date(START.getTime() + 60000);
    expect(await cleanupExpired(runtime)).toBe(1);
    expect(objects.has(key("5400", "bin"))).toBe(true);
    runtime.now = () => new Date(START.getTime() + 5400000);
    expect(await cleanupExpired(runtime)).toBe(2);
    expect(objects.size).toBe(4);
  });

  it("continues past individual delete failures", async () => {
    const { runtime, store } = fixture();
    store.list = async function* () {
      for (let i = 0; i < 3; i++)
        yield {
          key: `exports/v1/60/${String(i).repeat(32)}.json`,
          lastModified: START,
        } satisfies StoredObject;
    };
    vi.mocked(store.delete)
      .mockRejectedValueOnce(Object.assign(new Error(), { name: "NotFoundError" }))
      .mockRejectedValueOnce(new Error("secret"));
    runtime.now = () => new Date(START.getTime() + 60000);
    expect(await cleanupExpired(runtime)).toBe(1);
    expect(runtime.log).toHaveBeenCalledExactlyOnceWith({ event: "export_object_cleanup_failed" });
  });
});
