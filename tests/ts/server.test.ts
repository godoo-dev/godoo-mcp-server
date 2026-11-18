import { describe, expect, it } from "vitest";
import type { CodePort } from "../../src/ts/code-contract.js";
import { createHandler, protocolVersion, withOperation } from "../../src/ts/server.js";
import contracts from "../../src/ts/tool-contracts.json" with { type: "json" };
import type { ObjectStore } from "../../src/ts/types.js";

const credentials = {
  "X-Odoo-Url": "https://private.example",
  "X-Odoo-Database": "private-db",
  "X-Odoo-Username": "private-user",
  "X-Odoo-Password": "private-secret",
};
function rpcRequest(
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
async function rpcValue(response: Response) {
  const text = await response.text();
  return JSON.parse(
    text
      .split(/\r?\n/)
      .find((line) => line.startsWith("data:"))
      ?.slice(5) || text,
  );
}

describe("public MCP contract", () => {
  it("refuses oversized Code Mode bodies before parsing or authentication", async () => {
    const handler = createHandler({
      config: {},
      fetch: async () => {
        throw new Error("Must not authenticate");
      },
    });
    const response = await handler.fetch(
      rpcRequest("tools/call", { name: "code_execute", arguments: { code: " ".repeat(600000) } }),
    );
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "code_request_limit" });
    await handler.close();
  });
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
      expect(tool.outputSchema).toEqual(expected.outputSchema);
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

  it.each([
    "caller",
    "response",
  ])("rolls back an upload that commits after %s cancellation and records no success", async (cancellation) => {
    const controller = new AbortController();
    let start: (() => void) | undefined;
    let release: (() => void) | undefined;
    let finish: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      start = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const objects = new Set<string>();
    const events: Record<string, unknown>[] = [];
    let uploadSignal: AbortSignal | undefined;
    let cleanupSignal: AbortSignal | undefined;
    const store: ObjectStore = {
      sign: async () => "https://private.test/owned-export",
      async put(key, _content, _metadata, signal) {
        uploadSignal = signal;
        start?.();
        // Native R2 does not accept a signal: cancellation must wait until
        // this late commit settles, then remove only the invocation's key.
        await held;
        objects.add(key);
      },
      head: async (key) => ({ key, lastModified: new Date() }),
      async *list() {},
      async delete(key, signal) {
        cleanupSignal = signal;
        signal?.throwIfAborted();
        objects.delete(key);
      },
    };
    const handler = createHandler({
      config: {},
      storage: store,
      log(event) {
        events.push(event);
        if (event.event === "tool_call_finished") finish?.();
      },
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body));
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: body.params.service === "common" ? 2 : [{ id: 1, name: "Private row" }],
        });
      },
    });
    try {
      const response = await handler.fetch(
        new Request(
          rpcRequest("tools/call", {
            name: "record_read",
            arguments: { model: "res.partner", ids: [1], max_return_bytes: 0 },
          }),
          { signal: controller.signal },
        ),
      );
      await started;
      if (cancellation === "caller") controller.abort();
      else await response.body?.cancel();
      expect(uploadSignal?.aborted).toBe(true);
      release?.();
      await finished;
      expect(objects.size).toBe(0);
      expect(cleanupSignal).toBeInstanceOf(AbortSignal);
      expect(cleanupSignal).not.toBe(uploadSignal);
      expect(cleanupSignal?.aborted).toBe(false);
      expect(events.find((event) => event.event === "tool_call_finished")).toMatchObject({
        outcome: "error",
        category: "export_failed",
      });
      expect(JSON.stringify(events)).not.toContain("Private row");
      if (cancellation === "caller") await response.body?.cancel();
    } finally {
      release?.();
      await handler.close();
    }
  });
});

const operationCreds = {
  url: "https://private.example",
  database: "private-db",
  username: "private-user",
  password: "private-secret",
};
function odooFetch(
  result: (body: { params: { service: string } }) => unknown,
  signals: (AbortSignal | undefined)[] = [],
): typeof fetch {
  return async (_input, init) => {
    signals.push(init?.signal || undefined);
    const body = JSON.parse(String(init?.body));
    return Response.json({
      jsonrpc: "2.0",
      id: body.id,
      result: body.params.service === "common" ? 2 : result(body),
    });
  };
}
async function operationError(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as { name: string; message: string; category: string };
  }
  throw new Error("Expected operation failure");
}
const huge = "x".repeat(2 * 1024 * 1024 + 1);
const deep = JSON.parse(`${"[".repeat(70)}${"]".repeat(70)}`);

describe("characterization of operation transport bounds", () => {
  it("passes upstream responses through unchanged outside Code Mode", async () => {
    for (const value of [[{ id: 1 }], huge, deep]) {
      const runtime = { config: {}, fetch: odooFetch(() => value) };
      const request = new Request("https://mcp.test/mcp");
      expect(
        await withOperation(request, runtime, operationCreds, ({ client }) =>
          client.call("res.partner", "read", [[1]], {}),
        ),
      ).toEqual(value);
    }
  });

  it("buffers bounded Code Mode responses and preserves their content", async () => {
    const runtime = { config: {}, fetch: odooFetch(() => [{ id: 1, name: "ñ" }]) };
    expect(
      await withOperation(
        new Request("https://mcp.test/mcp"),
        runtime,
        operationCreds,
        ({ client }) => client.call("res.partner", "read", [[1]], {}),
        true,
      ),
    ).toEqual([{ id: 1, name: "ñ" }]);
  });

  it("refuses oversized or deep Code Mode responses as connection or write uncertainty", async () => {
    for (const [value, write, category] of [
      [huge, false, "connection_failed"],
      [deep, false, "connection_failed"],
      [huge, true, "unknown_write"],
      [deep, true, "unknown_write"],
    ] as const) {
      const signals: (AbortSignal | undefined)[] = [];
      const runtime = { config: {}, fetch: odooFetch(() => value, signals) };
      const error = await operationError(
        withOperation(
          new Request("https://mcp.test/mcp"),
          runtime,
          operationCreds,
          async ({ client, markWrite }) => {
            if (write) markWrite();
            return client.call("res.partner", "read", [[1]], {});
          },
          true,
        ),
      );
      expect(error).toMatchObject({ name: "PublicError", category });
      expect(signals.at(-1)?.aborted).toBe(value === huge);
    }
  });

  it("classifies empty and failing upstream responses", async () => {
    for (const ledger of [false, true]) {
      const empty = await operationError(
        withOperation(
          new Request("https://mcp.test/mcp"),
          { config: {}, fetch: async () => new Response(null) },
          operationCreds,
          async () => true,
          ledger,
        ),
      );
      // A null body is handed to the SDK untouched, so it is not a transport failure.
      expect(empty.category).toBe("auth_failed");
      const malformed = await operationError(
        withOperation(
          new Request("https://mcp.test/mcp"),
          { config: {}, fetch: async () => new Response("not json") },
          operationCreds,
          async () => true,
          ledger,
        ),
      );
      // A buffered but unparsable reply is the SDK's failure, not a transport failure.
      expect(malformed.category).toBe("auth_failed");
      let calls = 0;
      const failing = await operationError(
        withOperation(
          new Request("https://mcp.test/mcp"),
          {
            config: {},
            fetch: async (input, init) => {
              calls += 1;
              if (calls > 1) throw new Error("private-secret");
              return odooFetch(() => true)(input, init);
            },
          },
          operationCreds,
          ({ client }) => client.call("res.partner", "read", [[1]], {}),
          ledger,
        ),
      );
      expect(failing).toMatchObject({ category: "connection_failed" });
      expect(failing.message).toBe("Odoo connection failed");
    }
  });
});

const writePolicy = {
  schemaVersion: 1,
  targets: [
    {
      url: "https://private.example",
      database: "private-db",
      uids: [2],
      effective: {
        schemaVersion: 1,
        source: "test",
        declarations: [{ model: "res.partner", method: "write", effects: ["mutate"] }],
      },
      grants: [{ model: "res.partner", method: "write", effects: ["mutate"] }],
    },
  ],
};

describe("characterization of tool call outcomes and logging", () => {
  async function callTool(
    name: string,
    args: Record<string, unknown>,
    runtime: Record<string, unknown> = {},
    headers: Record<string, string> = {},
  ) {
    const events: Record<string, unknown>[] = [];
    const handler = createHandler({
      config: {},
      fetch: async () => {
        throw new Error("private-secret");
      },
      ...runtime,
      log: (event) => events.push(event),
    });
    const response = await handler.fetch(
      rpcRequest("tools/call", { name, arguments: args }, headers),
    );
    const value = await rpcValue(response);
    await handler.close();
    const finished = events.find((event) => event.event === "tool_call_finished");
    return { response, value, events, finished };
  }

  it("serves local tools without Odoo and reports unknown paths as public errors", async () => {
    const reference = await callTool("code_reference", {});
    expect(reference.value.result.isError).not.toBe(true);
    expect(reference.finished).toMatchObject({ outcome: "success", category: "success" });
    for (const [name, args, text] of [
      [
        "guidance_get",
        { path: "missing.md" },
        "Unknown guidance path; use a path listed in the guidance index",
      ],
      ["code_reference", { section: "missing" }, "Unknown SDK reference section"],
      [
        "model_call",
        { model: "res.partner", method: "read", kwargs: { context: "x" } },
        "kwargs.context must be an object",
      ],
    ] as const) {
      const { value, finished, events } = await callTool(name, args);
      expect(value.result).toMatchObject({ isError: true, content: [{ type: "text", text }] });
      expect(finished).toMatchObject({
        event: "tool_call_finished",
        tool: name,
        outcome: "error",
        category: "invalid_arguments",
      });
      expect(events[0]).toMatchObject({ event: "tool_call_started", tool: name });
      expect(typeof finished?.elapsed_ms).toBe("number");
    }
  });

  it("logs sanitized Odoo failures with their public category", async () => {
    const { value, finished } = await callTool("users_whoami", {});
    expect(value.result.content[0].text).toBe("Odoo authentication connection failed");
    expect(finished).toMatchObject({ outcome: "error", category: "auth_connection_failed" });
  });

  it("maps code_execute status to log outcome", async () => {
    const fetch = odooFetch(() => true);
    const unavailable = await callTool("code_execute", { code: "return 1" }, { fetch });
    expect(unavailable.value.result.structuredContent.status).toBe("failed");
    expect(unavailable.value.result.isError).not.toBe(true);
    expect(unavailable.finished).toMatchObject({ outcome: "error", category: "code_failed" });

    const executeCode = async () => ({ ok: true, logs: [], elapsed_ms: 1, result: 1 });
    const success = await callTool("code_execute", { code: "return 1" }, { fetch, executeCode });
    expect(success.value.result.structuredContent).toMatchObject({ status: "success", result: 1 });
    expect(success.finished).toMatchObject({ outcome: "success", category: "success" });

    let calls = 0;
    const uncertain = await callTool(
      "code_execute",
      { code: "return 1", effects: ["mutate"] },
      {
        config: { ODOO_CODE_POLICY: writePolicy },
        fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
          calls += 1;
          if (calls > 1) throw new Error("private-secret");
          return fetch(input, init);
        },
        executeCode: async (_code: string, _uid: number, gate: CodePort) => {
          await gate.dispatch(
            JSON.stringify({ model: "res.partner", method: "write", args: [[1], {}], kwargs: {} }),
          );
          return { ok: true, logs: [], elapsed_ms: 1, result: null };
        },
      },
    );
    expect(uncertain.value.result.structuredContent.status).toBe("uncertain");
    expect(uncertain.finished).toMatchObject({ outcome: "uncertain", category: "unknown_write" });
  });

  it("hides non-public failures behind a generic internal error", async () => {
    const fetch = odooFetch(() => true);
    const unserializable = await callTool(
      "code_execute",
      { code: "return 1" },
      {
        fetch,
        executeCode: async () => ({ ok: true, logs: [1n], elapsed_ms: 1, result: 1 }),
      },
    );
    expect(unserializable.value.result).toMatchObject({
      isError: true,
      content: [{ type: "text", text: "Tool operation failed" }],
    });
    expect(unserializable.finished).toMatchObject({
      outcome: "error",
      category: "internal_error",
    });

    const thrown = await callTool(
      "code_execute",
      { code: "return 1" },
      {
        fetch,
        executeCode: async () => {
          throw new Error("private-secret");
        },
      },
    );
    expect(thrown.value.result.content[0].text).toBe("Odoo request failed");
    expect(thrown.finished).toMatchObject({ outcome: "error", category: "odoo_error" });
    expect(JSON.stringify(thrown.events)).not.toContain("private");
  });

  it("logs the normalized request ID", async () => {
    const supplied = "0084A94F-B12B-4019-B5E6-62F6FE71EF10";
    const valid = await callTool("code_reference", {}, {}, { "x-request-id": supplied });
    expect(valid.response.headers.get("x-request-id")).toBe(supplied.toLowerCase());
    expect(valid.finished?.request_id).toBe(supplied.toLowerCase());
    const invalid = await callTool("code_reference", {}, {}, { "x-request-id": "not-a-uuid" });
    const generated = invalid.response.headers.get("x-request-id");
    expect(generated).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(generated).not.toBe("not-a-uuid");
    expect(invalid.finished?.request_id).toBe(generated);
  });
});

describe("characterization of HTTP routing", () => {
  it("routes health, credentials, redirects and unknown paths in order", async () => {
    const handler = createHandler({ config: {} });
    const health = await handler.fetch(new Request("https://mcp.test/healthz"));
    expect(await health.json()).toEqual({ status: "ok" });
    expect(health.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    const anonymous = await handler.fetch(new Request("https://mcp.test/other"));
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toEqual({
      error: "missing_credentials",
      missing: [
        "X-Odoo-Url (or ODOO_URL)",
        "X-Odoo-Database (or ODOO_DATABASE / ODOO_DB)",
        "X-Odoo-Username (or ODOO_USERNAME / ODOO_USER)",
        "X-Odoo-Password (or ODOO_PASSWORD)",
      ],
    });
    const redirect = await handler.fetch(
      new Request("https://mcp.test/mcp/", { headers: credentials }),
    );
    expect(redirect.status).toBe(307);
    expect(redirect.headers.get("location")).toBe("/mcp");
    expect(redirect.body).toBeNull();
    const missing = await handler.fetch(
      new Request("https://mcp.test/other", { headers: credentials }),
    );
    expect(missing.status).toBe(404);
    expect(await missing.text()).toBe("Not Found");
    await handler.close();
  });

  it("forwards Code Mode bodies up to the limit intact", async () => {
    const handler = createHandler({
      config: {},
      fetch: async () => {
        throw new Error("private-secret");
      },
    });
    const limit = 512 * 1024;
    const base = await rpcRequest("tools/call", {
      name: "code_execute",
      arguments: { code: "" },
    }).text();
    for (const [extra, status] of [
      [0, 200],
      [1, 413],
    ] as const) {
      const response = await handler.fetch(
        rpcRequest("tools/call", {
          name: "code_execute",
          arguments: { code: " ".repeat(limit - base.length + extra) },
        }),
      );
      expect(response.status).toBe(status);
      if (status === 200) expect((await rpcValue(response)).result.isError).toBe(true);
      else expect(await response.json()).toEqual({ error: "code_request_limit" });
    }
    const bodiless = await handler.fetch(
      new Request("https://mcp.test/mcp", {
        headers: { ...credentials, "MCP-Name": "code_execute" },
      }),
    );
    const ordinary = await handler.fetch(
      new Request("https://mcp.test/mcp", { headers: credentials }),
    );
    expect(bodiless.status).toBe(ordinary.status);
    await handler.close();
  });
});
