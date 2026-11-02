import { readFile } from "node:fs/promises";
import { createServer, request as httpRequest, type IncomingMessage, type Server } from "node:http";
import { Miniflare, Response as MiniflareResponse } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import contracts from "../../src/ts/tool-contracts.json" with { type: "json" };

const protocol = "2026-07-28";
function rpc(
  method: string,
  params: Record<string, unknown> = {},
  target = "http://unused.invalid",
) {
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": protocol,
      "MCP-Method": method,
      ...(params.name
        ? { "MCP-Name": String(params.name) }
        : params.uri
          ? { "MCP-Name": String(params.uri) }
          : {}),
      "X-Odoo-Url": target,
      "X-Odoo-Database": "worker-test",
      "X-Odoo-Username": "alice",
      "X-Odoo-Password": "disposable-key",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": protocol,
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    }),
  };
}
async function value(response: { text(): Promise<string> }): Promise<Record<string, unknown>> {
  const body = await response.text();
  return JSON.parse(
    body
      .split(/\r?\n/u)
      .find((line) => line.startsWith("data:"))
      ?.slice(5) || body,
  );
}
function object(value: unknown): Record<string, unknown> {
  expect(typeof value).toBe("object");
  expect(value).not.toBeNull();
  return value as Record<string, unknown>;
}
function array(value: unknown): Record<string, unknown>[] {
  expect(Array.isArray(value)).toBe(true);
  return value as Record<string, unknown>[];
}
function deferred() {
  let resolve: (() => void) | undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve: () => resolve?.() };
}
async function bounded(promise: Promise<unknown>, timeoutMs = 5000): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("Worker cancellation did not reach upstream")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

describe("built native Cloudflare Worker", () => {
  let worker: Miniflare;
  let upstream: Server;
  let upstreamUrl: string;
  let workerUrl: string;
  let directWorkerUrl: string;
  let writes = 0;
  const s3Uploads: { url: string; content: string; authorization: string | null }[] = [];
  const writeStarted = deferred();
  const writeClosed = deferred();

  beforeAll(async () => {
    upstream = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        const rpc = JSON.parse(Buffer.concat(chunks).toString()) as {
          id: number;
          params: { service: string; args: unknown[] };
        };
        const args = rpc.params.args;
        if (rpc.params.service === "common") {
          response.setHeader("Content-Type", "application/json");
          response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: 11 }));
          return;
        }
        if (args[4] === "hold_write") {
          writes += 1;
          response.writeHead(200, { "Content-Type": "application/json" });
          response.write('{"jsonrpc":"2.0","id":');
          response.on("close", () => writeClosed.resolve());
          writeStarted.resolve();
          return;
        }
        const result =
          args[4] === "echo"
            ? { args: args[5], kwargs: args[6] }
            : [{ id: 7, name: "Native R2 résumé" }];
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result }));
      });
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const address = upstream.address();
    if (!address || typeof address === "string") throw new Error("Missing disposable HTTP port");
    upstreamUrl = `http://127.0.0.1:${address.port}`;
    // Loading the actual candidate bundle also rejects unsupported Node imports.
    const bundle = await readFile("dist/worker.mjs", "utf8");
    worker = new Miniflare({
      host: "127.0.0.1",
      port: 0,
      cf: false,
      enableDevRegistry: false,
      unsafeTriggerHandlers: true,
      logRequests: false,
      telemetry: { enabled: false },
      workers: [
        {
          dev: { unsafeDirectSockets: [{ host: "127.0.0.1", port: 0 }] },
          config: {
            name: "native-mcp",
            compatibilityDate: "2026-11-02",
            compatibilityFlags: ["enable_request_signal"],
            manifest: {
              mainModule: "worker.mjs",
              modules: {
                "worker.mjs": { type: "esm", contents: bundle },
              },
            },
            env: {
              EXPORTS: { type: "r2", name: "private-exports" },
              ODOO_EXPORT_PROVIDER: { type: "text", value: "r2" },
              ODOO_EXPORT_BUCKET: { type: "text", value: "private-exports" },
              ODOO_EXPORT_ENDPOINT: {
                type: "text",
                value: "https://worker-test.r2.cloudflarestorage.com",
              },
              AWS_ACCESS_KEY_ID: { type: "text", value: "disposable-access" },
              AWS_SECRET_ACCESS_KEY: { type: "text", value: "disposable-secret" },
              ODOO_REQUEST_TIMEOUT_MS: { type: "text", value: "60000" },
            },
          },
        },
        ...["missing-signer", "s3-with-binding"].map((name) => ({
          config: {
            name,
            compatibilityDate: "2026-11-02",
            compatibilityFlags: ["enable_request_signal"],
            manifest: {
              mainModule: "worker.mjs",
              modules: {
                "worker.mjs": { type: "esm" as const, contents: bundle },
              },
            },
            env: {
              EXPORTS: { type: "r2" as const, name },
              ...(name === "s3-with-binding"
                ? {
                    ODOO_EXPORT_PROVIDER: { type: "text" as const, value: "s3" },
                    ODOO_EXPORT_BUCKET: { type: "text" as const, value: "s3-exports" },
                    ODOO_EXPORT_ENDPOINT: {
                      type: "text" as const,
                      value: "https://s3-test.invalid",
                    },
                    AWS_ACCESS_KEY_ID: { type: "text" as const, value: "disposable-access" },
                    AWS_SECRET_ACCESS_KEY: { type: "text" as const, value: "disposable-secret" },
                  }
                : {}),
            },
          },
          ...(name === "s3-with-binding"
            ? {
                dev: {
                  outboundService: {
                    type: "fetcher" as const,
                    async handler(request: import("miniflare").Request) {
                      if (new URL(request.url).hostname === "s3-test.invalid") {
                        if (request.method === "HEAD")
                          return new MiniflareResponse(null, {
                            status: 200,
                            headers: { "last-modified": new Date().toUTCString() },
                          });
                        expect(request.method).toBe("PUT");
                        s3Uploads.push({
                          url: request.url,
                          content: await request.text(),
                          authorization: request.headers.get("authorization"),
                        });
                        return new MiniflareResponse(null, { status: 200 });
                      }
                      const response = await fetch(request.url, {
                        method: request.method,
                        headers: Object.fromEntries(request.headers),
                        body: request.body ? await request.arrayBuffer() : undefined,
                      });
                      return new MiniflareResponse(await response.arrayBuffer(), {
                        status: response.status,
                        headers: Object.fromEntries(response.headers),
                      });
                    },
                  },
                },
              }
            : {}),
        })),
      ],
    });
    workerUrl = (await worker.ready).origin;
    directWorkerUrl = (await worker.unsafeGetDirectURL("native-mcp")).origin;
  }, 30000);

  afterAll(async () => {
    await worker?.dispose();
    upstream?.closeAllConnections();
    await new Promise<void>((resolve) => upstream?.close(() => resolve()));
  });

  it("loads without nodejs_compat and exposes every baseline tool and guidance resource", async () => {
    const response = await worker.dispatchFetch("https://mcp.test/mcp", rpc("tools/list"));
    expect(response.status).toBe(200);
    expect(response.headers.has("mcp-session-id")).toBe(false);
    const tools = array(object((await value(response)).result).tools);
    expect(tools).toHaveLength(Object.keys(contracts).length);
    for (const tool of tools) {
      const expected = contracts[tool.name as keyof typeof contracts];
      expect(tool.inputSchema).toEqual(expected.inputSchema);
      expect(tool.annotations).toEqual(expected.annotations);
    }
    const resourceList = await value(
      await worker.dispatchFetch("https://mcp.test/mcp", rpc("resources/list")),
    );
    expect(
      array(object(resourceList.result).resources).some(
        (item) => item.uri === "skill://index.json",
      ),
    ).toBe(true);
    const index = await value(
      await worker.dispatchFetch(
        "https://mcp.test/mcp",
        rpc("resources/read", { uri: "skill://index.json" }),
      ),
    );
    const topics = JSON.parse(String(array(object(index.result).contents)[0].text)).topics as {
      path: string;
      url: string;
    }[];
    expect(topics.length).toBeGreaterThan(5);
    for (const topic of topics) {
      const resource = await value(
        await worker.dispatchFetch(
          "https://mcp.test/mcp",
          rpc("resources/read", { uri: topic.url }),
        ),
      );
      const tool = await value(
        await worker.dispatchFetch(
          "https://mcp.test/mcp",
          rpc("tools/call", { name: "guidance_get", arguments: { path: topic.path } }),
        ),
      );
      expect(array(object(tool.result).content)[0].text).toEqual(
        array(object(resource.result).contents)[0].text,
      );
    }
    const templates = await value(
      await worker.dispatchFetch("https://mcp.test/mcp", rpc("resources/templates/list")),
    );
    expect(
      array(object(templates.result).resourceTemplates).map((item) => item.uriTemplate),
    ).toEqual(
      expect.arrayContaining([
        "skill://odoo/{+path}",
        "odoo://model/{name}",
        "odoo://action/{id}",
        "odoo://menu/{id}",
      ]),
    );
  });

  it("preserves native model arguments and JSON results through workerd fetch", async () => {
    const args = [[7], { nested: [false, null, 0, "á"] }];
    const kwargs = { context: { lang: "es_ES" }, option: false };
    const result = await value(
      await worker.dispatchFetch(
        "https://mcp.test/mcp",
        rpc(
          "tools/call",
          { name: "model_call", arguments: { model: "res.partner", method: "echo", args, kwargs } },
          upstreamUrl,
        ),
      ),
    );
    expect(object(result.result).structuredContent).toEqual({ result: { args, kwargs } });
  });

  it("writes exact artifact bytes through the native R2 binding and returns only a signed receipt", async () => {
    const result = await value(
      await worker.dispatchFetch(
        "https://mcp.test/mcp",
        rpc(
          "tools/call",
          {
            name: "record_search",
            arguments: { model: "res.partner", fields: ["name"], max_return_bytes: 0 },
          },
          upstreamUrl,
        ),
      ),
    );
    const receipt = object(object(result.result).structuredContent);
    expect(receipt.delivery).toBe("artifact");
    expect(JSON.stringify(result)).not.toContain("Native R2 résumé");
    expect(receipt.expires_in_seconds).toBe(3600);
    expect(receipt.retention_seconds).toBe(5400);
    const url = new URL(String(receipt.download_url));
    expect(url.protocol).toBe("https:");
    expect(url.hostname).toBe("worker-test.r2.cloudflarestorage.com");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("3600");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/u);
    const bucket = await worker.getR2Bucket("EXPORTS");
    const stored = await bucket.get(`exports/v1/5400/${receipt.artifact_id}.json`);
    expect(stored).not.toBeNull();
    if (!stored) throw new Error("Missing native R2 artifact");
    const bytes = new Uint8Array(await stored.arrayBuffer());
    expect(bytes.byteLength).toBe(receipt.size_bytes);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    expect(
      Array.from(new Uint8Array(digest), (item) => item.toString(16).padStart(2, "0")).join(""),
    ).toBe(receipt.sha256);
    expect(JSON.parse(new TextDecoder().decode(bytes))).toEqual({
      records: [{ id: 7, name: "Native R2 résumé" }],
      count: 1,
      web_urls: { "7": `${upstreamUrl}/web#model=res.partner&id=7` },
    });
    expect(stored?.httpMetadata?.contentType).toBe("application/json");
    expect(stored?.httpMetadata?.cacheControl).toBe("no-store");
  });

  it("keeps health, discovery and inline tools available when an R2 binding lacks signing credentials", async () => {
    const native = await worker.getWorker("missing-signer");
    expect(await (await native.fetch("https://mcp.test/healthz")).json()).toEqual({ status: "ok" });
    const listing = await value(await native.fetch("https://mcp.test/mcp", rpc("tools/list")));
    expect(array(object(listing.result).tools)).toHaveLength(Object.keys(contracts).length);
    const inline = await value(
      await native.fetch(
        "https://mcp.test/mcp",
        rpc(
          "tools/call",
          {
            name: "model_call",
            arguments: { model: "res.partner", method: "echo", args: [7] },
          },
          upstreamUrl,
        ),
      ),
    );
    expect(object(inline.result).structuredContent).toEqual({ result: { args: [7], kwargs: {} } });
    const exported = await value(
      await native.fetch(
        "https://mcp.test/mcp",
        rpc(
          "tools/call",
          {
            name: "record_search",
            arguments: { model: "res.partner", fields: ["id", "name"], max_return_bytes: 0 },
          },
          upstreamUrl,
        ),
      ),
    );
    expect(object(exported.result).isError).toBe(true);
    expect(JSON.stringify(exported)).not.toContain("Native R2 résumé");
  });

  it("honors an explicit S3 provider when an unused R2 binding remains configured", async () => {
    const native = await worker.getWorker("s3-with-binding");
    const exported = await value(
      await native.fetch(
        "https://mcp.test/mcp",
        rpc(
          "tools/call",
          {
            name: "record_search",
            arguments: { model: "res.partner", fields: ["id", "name"], max_return_bytes: 0 },
          },
          upstreamUrl,
        ),
      ),
    );
    const receipt = object(object(exported.result).structuredContent);
    expect(receipt.delivery).toBe("artifact");
    expect(new URL(String(receipt.download_url)).hostname).toBe("s3-test.invalid");
    expect(s3Uploads).toHaveLength(1);
    expect(s3Uploads[0]?.url).toContain("/s3-exports/exports/v1/5400/");
    expect(s3Uploads[0]?.authorization).toMatch(/^AWS4-HMAC-SHA256 /u);
    expect(s3Uploads[0]?.content).toContain("Native R2 résumé");
    const unusedBucket = await worker.getR2Bucket("EXPORTS", "s3-with-binding");
    expect((await unusedBucket.list()).objects).toEqual([]);
  });

  it("runs scheduled cleanup against native R2 without deleting unexpired or unmanaged keys", async () => {
    const bucket = await worker.getR2Bucket("EXPORTS");
    const expired = `exports/v1/1/${"a".repeat(32)}.bin`;
    const unexpired = `exports/v1/5400/${"b".repeat(32)}.json`;
    await bucket.put(expired, "expired");
    await bucket.put(unexpired, "retain");
    await bucket.put("unrelated", "retain");
    await bucket.put("exports/v1/1/not-managed.json", "retain");
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const response = await fetch(`${workerUrl}/cdn-cgi/local/scheduled?cron=*+*+*+*+*`);
    expect(response.status).toBe(200);
    expect(await bucket.head(expired)).toBeNull();
    expect(await bucket.head(unexpired)).not.toBeNull();
    expect(await bucket.head("unrelated")).not.toBeNull();
    expect(await bucket.head("exports/v1/1/not-managed.json")).not.toBeNull();
  });

  it("cancels a disconnected native HTTP mutation on the next heartbeat without replay", async () => {
    const options = rpc(
      "tools/call",
      { name: "model_call", arguments: { model: "res.partner", method: "hold_write" } },
      upstreamUrl,
    );
    let connection: ReturnType<typeof httpRequest> | undefined;
    const response = await new Promise<IncomingMessage>((resolve, reject) => {
      connection = httpRequest(
        `${directWorkerUrl}/mcp`,
        { method: options.method, headers: options.headers },
        resolve,
      );
      connection.on("error", reject);
      connection.end(options.body);
    });
    response.on("error", () => undefined);
    response.resume();
    await bounded(writeStarted.promise);
    response.destroy();
    connection?.destroy();
    // workerd detects a quiet socket disconnect when the 15s SSE heartbeat
    // writes again. The 60s Odoo timeout cannot satisfy this 20s bound.
    await bounded(writeClosed.promise, 20000);
    expect(writes).toBe(1);
    const healthy = await worker.dispatchFetch("https://mcp.test/healthz");
    expect(await healthy.json()).toEqual({ status: "ok" });
  });
});
