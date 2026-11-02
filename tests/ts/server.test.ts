import { describe, expect, it } from "vitest";
import { createHandler, protocolVersion } from "../../src/ts/server.js";
import contracts from "../../src/ts/tool-contracts.json" with { type: "json" };

const credentials = {
  "X-Odoo-Url": "https://private.example",
  "X-Odoo-Database": "private-db",
  "X-Odoo-Username": "private-user",
  "X-Odoo-Password": "private-secret",
};
export function rpcRequest(
  method: string,
  params: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) {
  return new Request("https://mcp.test/mcp", {
    method: "POST",
    headers: {
      ...credentials,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": protocolVersion,
      "MCP-Method": method,
      ...(params.name
        ? { "MCP-Name": String(params.name) }
        : params.uri
          ? { "MCP-Name": String(params.uri) }
          : {}),
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": protocolVersion,
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    }),
  });
}
export async function rpcValue(response: Response) {
  const text = await response.text();
  return JSON.parse(
    text
      .split(/\r?\n/)
      .find((line) => line.startsWith("data:"))
      ?.slice(5) || text,
  );
}

describe("public MCP contract", () => {
  it("advertises the baseline tools and input contracts with no session affinity", async () => {
    const handler = createHandler({ config: {} });
    const response = await handler.fetch(rpcRequest("tools/list"));
    expect(response.status).toBe(200);
    expect(response.headers.has("mcp-session-id")).toBe(false);
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    const value = await rpcValue(response);
    expect(value.result.tools).toHaveLength(Object.keys(contracts).length);
    for (const tool of value.result.tools) {
      const expected = contracts[tool.name as keyof typeof contracts];
      expect(tool.inputSchema).toEqual(expected.inputSchema);
      expect(tool.annotations).toEqual(expected.annotations);
      expect(tool.description).toEqual(expected.description);
    }
    await handler.close();
  });
  it("serves every guidance topic identically through resources and tools without Odoo", async () => {
    const handler = createHandler({
      config: {},
      fetch: async () => {
        throw new Error("Must not contact Odoo");
      },
    });
    const index = await rpcValue(
      await handler.fetch(rpcRequest("resources/read", { uri: "skill://index.json" })),
    );
    for (const topic of JSON.parse(index.result.contents[0].text).topics) {
      const resource = await rpcValue(
        await handler.fetch(rpcRequest("resources/read", { uri: topic.url })),
      );
      const tool = await rpcValue(
        await handler.fetch(
          rpcRequest("tools/call", { name: "guidance_get", arguments: { path: topic.path } }),
        ),
      );
      expect(tool.result.isError).not.toBe(true);
      expect(tool.result.content[0].text).toEqual(resource.result.contents[0].text);
      expect(tool.result.content[0].text.length).toBeGreaterThan(100);
    }
    await handler.close();
  });
  it("requires credentials, validates modern envelopes, and preserves safe request IDs", async () => {
    const handler = createHandler({ config: {} });
    expect((await handler.fetch(new Request("https://mcp.test/healthz"))).status).toBe(200);
    expect((await handler.fetch(new Request("https://mcp.test/mcp"))).status).toBe(401);
    const bad = rpcRequest("tools/list", {}, { "MCP-Method": "tools/call" });
    expect((await handler.fetch(bad)).status).toBe(400);
    const requestId = "0084a94f-b12b-4019-b5e6-62f6fe71ef10";
    const response = await handler.fetch(
      rpcRequest("server/discover", {}, { "x-request-id": requestId }),
    );
    expect(response.headers.get("x-request-id")).toBe(requestId);
    expect((await rpcValue(response)).result.supportedVersions).toEqual([protocolVersion]);
    await handler.close();
  });
  it("rejects invalid model context before authentication and sanitizes auth errors", async () => {
    let calls = 0;
    const events: Record<string, unknown>[] = [];
    const handler = createHandler({
      config: {},
      log: (event) => events.push(event),
      fetch: async () => {
        calls++;
        throw new Error("private-secret");
      },
    });
    const invalid = await rpcValue(
      await handler.fetch(
        rpcRequest("tools/call", {
          name: "model_call",
          arguments: { model: "res.partner", method: "create", kwargs: { context: [] } },
        }),
      ),
    );
    expect(invalid.result.isError).toBe(true);
    expect(calls).toBe(0);
    const failed = await rpcValue(
      await handler.fetch(rpcRequest("tools/call", { name: "users_whoami", arguments: {} })),
    );
    expect(failed.result.content[0].text).toBe("Odoo authentication connection failed");
    expect(JSON.stringify(events)).not.toContain("private");
    await handler.close();
  });
  it("propagates cancellation to upstream without cross-request state", async () => {
    const controller = new AbortController();
    let signal: AbortSignal | undefined;
    let start: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      start = resolve;
    });
    const handler = createHandler({
      config: {},
      fetch: async (_input, init) => {
        signal = init?.signal || undefined;
        start?.();
        await new Promise((_, reject) =>
          signal?.addEventListener("abort", () => reject(signal?.reason), { once: true }),
        );
        throw new Error("unreachable");
      },
    });
    const request = new Request(rpcRequest("tools/call", { name: "users_whoami", arguments: {} }), {
      signal: controller.signal,
    });
    const response = await handler.fetch(request);
    await started;
    controller.abort();
    expect(signal?.aborted).toBe(true);
    await response.body?.cancel();
    await handler.close();
  });
});
