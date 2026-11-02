import type { OdooClient } from "@godoo-dev/client";
import type { McpServer } from "@modelcontextprotocol/server";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { getCatalogSnapshot, getModelEntryFromCache } from "../../src/ts/catalog.js";
import { PublicError } from "../../src/ts/errors.js";
import {
  htmlBody,
  publicOdooUrl,
  recordWebUrls,
  registerTools,
  validateModelCallArguments,
} from "../../src/ts/tools.js";
import type { Operation, Runtime, ToolHandler } from "../../src/ts/types.js";

function tools(client: Partial<OdooClient> = {}, runtime: Runtime = { config: {} }) {
  const registered = new Map<
    string,
    { schema: z.ZodObject<z.ZodRawShape>; handler: ToolHandler }
  >();
  registerTools({
    server: {} as McpServer,
    runtime,
    register(name, schema, handler) {
      registered.set(name, { schema: z.object(schema as z.ZodRawShape), handler });
    },
  });
  const markWrite = vi.fn();
  const operation: Operation = {
    client: client as OdooClient,
    creds: {
      url: "https://odoo.test",
      database: "testdb",
      username: "tester",
      password: "private",
    },
    runtime,
    signal: new AbortController().signal,
    markWrite,
  };
  return {
    registered,
    markWrite,
    async invoke(name: string, args: Record<string, unknown> = {}) {
      const tool = registered.get(name);
      if (!tool) throw new Error(`Missing tool ${name}`);
      return tool.handler(tool.schema.parse(args), operation);
    },
  };
}

describe("operational tools", () => {
  it("registers every operational tool with strict native input types", () => {
    const { registered } = tools();
    expect(registered.size).toBe(22);
    expect(
      registered.get("record_update")?.schema.safeParse({ model: "res.partner", ids: [true] })
        .success,
    ).toBe(false);
    expect(
      registered
        .get("mail_post_message")
        ?.schema.safeParse({ model: "res.partner", res_id: 1, body: "hello", is_internal: "false" })
        .success,
    ).toBe(false);
    for (const value of [-1, 0.5, "5", true]) {
      expect(
        registered
          .get("record_read")
          ?.schema.safeParse({ model: "res.partner", ids: [1], max_return_bytes: value }).success,
      ).toBe(false);
    }
  });

  it.each([
    false,
    null,
    { nested: [0, false, "á"] },
  ])("preserves native model_call results: %j", async (value) => {
    const call = vi.fn().mockResolvedValue(value);
    const { invoke, markWrite } = tools({ call });
    const args = [[7], { extra: [false, null, 0] }];
    const kwargs = { context: { lang: "es_ES" }, option: 3 };
    expect(
      await invoke("model_call", { model: "custom.model", method: "custom_method", args, kwargs }),
    ).toEqual({ result: value });
    expect(call).toHaveBeenCalledExactlyOnceWith("custom.model", "custom_method", args, kwargs);
    expect(markWrite).toHaveBeenCalledOnce();
    expect(markWrite.mock.invocationCallOrder[0]).toBeLessThan(call.mock.invocationCallOrder[0]);
  });

  it("defaults omitted model_call arrays and objects without mutating inputs", async () => {
    const call = vi.fn().mockResolvedValue(false);
    const { invoke } = tools({ call });
    const input = { model: "custom.model", method: "custom_method", args: null, kwargs: null };
    await invoke("model_call", input);
    expect(call).toHaveBeenCalledExactlyOnceWith("custom.model", "custom_method", [], {});
    expect(input.args).toBeNull();
    expect(input.kwargs).toBeNull();
  });

  it.each([
    null,
    [],
    false,
    "context",
  ])("rejects invalid context before dispatch: %j", async (context) => {
    const call = vi.fn();
    const { invoke, markWrite } = tools({ call });
    expect(() => validateModelCallArguments({ kwargs: { context } })).toThrow(
      "kwargs.context must be an object",
    );
    await expect(
      invoke("model_call", { model: "m", method: "f", kwargs: { context } }),
    ).rejects.toThrow(PublicError);
    expect(call).not.toHaveBeenCalled();
    expect(markWrite).not.toHaveBeenCalled();
  });

  it("preserves record selection and returns inline read envelopes", async () => {
    const read = vi.fn().mockResolvedValue([{ id: 7, name: "á" }]);
    const { invoke, markWrite } = tools({ read });
    expect(
      await invoke("record_read", {
        model: "res.partner",
        ids: [7],
        fields: ["name"],
        max_return_bytes: null,
      }),
    ).toEqual({
      records: [{ id: 7, name: "á" }],
      web_urls: { "7": "https://odoo.test/web#model=res.partner&id=7" },
    });
    expect(read).toHaveBeenCalledExactlyOnceWith("res.partner", [7], ["name"]);
    expect(markWrite).not.toHaveBeenCalled();
  });

  it("does not dispatch an update without values", async () => {
    const write = vi.fn();
    const { invoke, markWrite } = tools({ write });
    await expect(invoke("record_update", { model: "res.partner", ids: [7] })).rejects.toThrow(
      "Supply values or properties",
    );
    expect(write).not.toHaveBeenCalled();
    expect(markWrite).not.toHaveBeenCalled();
  });

  it("merges attachment filters without changing the caller's domain", async () => {
    const searchRead = vi.fn().mockResolvedValue([]);
    const { invoke } = tools({ searchRead });
    const domain = [["name", "ilike", "report"]];
    await invoke("attachments_list", { domain, res_model: "res.partner", res_id: 7 });
    expect(searchRead.mock.calls[0][1]).toEqual([
      ...domain,
      ["res_model", "=", "res.partner"],
      ["res_id", "=", 7],
    ]);
    expect(domain).toEqual([["name", "ilike", "report"]]);
  });

  it("does not create a stored copy of an empty attachment", async () => {
    const read = vi.fn().mockResolvedValue([{ datas: false }]);
    const { invoke } = tools({ read });
    expect(await invoke("attachments_download", { attachment_id: 7 })).toEqual({
      error: "attachment_has_no_content",
      id: 7,
    });
    expect(read).toHaveBeenCalledOnce();
  });

  it.each([
    41,
    [41],
    "41",
    "mail.activity(41,)",
    "mail.activity(41)",
  ])("normalizes singleton activity acknowledgment %j", async (result) => {
    const call = vi.fn().mockResolvedValue(result);
    const { invoke } = tools({ call });
    expect(
      await invoke("mail_schedule_activity", {
        model: "res.partner",
        res_id: 7,
        activity_type_id: 3,
        date_deadline: "2026-12-31",
      }),
    ).toEqual({ activity_id: 41 });
    expect(call).toHaveBeenCalledExactlyOnceWith("res.partner", "activity_schedule", [7], {
      activity_type_id: 3,
      date_deadline: "2026-12-31",
    });
  });

  it.each([
    [],
    [41, 42],
    [true],
    ["41"],
    "mail.activity(41,) private-suffix",
    null,
  ])("marks malformed activity acknowledgment uncertain without replay: %j", async (result) => {
    const call = vi.fn().mockResolvedValue(result);
    const { invoke } = tools({ call });
    await expect(
      invoke("mail_schedule_activity", {
        model: "res.partner",
        res_id: 7,
        activity_type_id: 3,
        date_deadline: "2026-12-31",
      }),
    ).rejects.toMatchObject({
      category: "unknown_write",
      message: "Odoo write outcome is unknown; do not retry automatically",
    });
    expect(call).toHaveBeenCalledOnce();
  });
});

describe("chatter formats and navigation", () => {
  it("renders existing Markdown features and preserves explicit HTML", () => {
    expect(htmlBody("**Title**\n\n- Item", "md")).toBe(
      "<p><strong>Title</strong></p>\n<ul>\n<li>Item</li>\n</ul>\n",
    );
    expect(htmlBody("1 < 2 & 3\nnext", "md")).toBe("<p>1 &lt; 2 &amp; 3<br />\nnext</p>\n");
    expect(htmlBody("<p><b>x</b></p>", "html")).toBe("<p><b>x</b></p>");
    expect(htmlBody("<p>**x**</p> &\nnext", "txt")).toBe(
      "<p>&lt;p&gt;**x**&lt;/p&gt; &amp;<br>next</p>",
    );
    expect(() => htmlBody(" ", "md")).toThrow("Message body must not be empty");
  });

  it("removes URL capabilities and encodes record-link parameters", () => {
    expect(publicOdooUrl("https://user:secret@odoo.test/base/?token=private#fragment")).toBe(
      "https://odoo.test/base",
    );
    expect(publicOdooUrl("file:///tmp/private")).toBeNull();
    expect(recordWebUrls("invalid", "res.partner", [7])).toEqual({});
    expect(recordWebUrls("https://odoo.test", "x space", [7])).toEqual({
      "7": "https://odoo.test/web#model=x+space&id=7",
    });
  });
});

describe("catalog identity isolation", () => {
  it("reuses only the same authenticated user's target and returns detached data", async () => {
    const searchRead = vi.fn(
      async (model: string, _domain: unknown, options: { fields: string[] }) =>
        options.fields.includes("write_date")
          ? [{ write_date: "2026-11-02 12:00:00" }]
          : [{ model, name: "Model", info: "Private to this user" }],
    );
    const first = { searchRead, getSession: () => ({ uid: 71 }) } as unknown as OdooClient;
    const second = { searchRead, getSession: () => ({ uid: 72 }) } as unknown as OdooClient;
    const url = "https://catalog-isolation.test";
    const one = await getCatalogSnapshot(first, url, "db");
    expect(one.cached).toBe(false);
    one.models[0].name = "changed by caller";
    const cached = await getCatalogSnapshot(first, url, "db");
    expect(cached.cached).toBe(true);
    expect(cached.models[0].name).toBe("Model");
    expect(searchRead).toHaveBeenCalledTimes(7);
    expect(getModelEntryFromCache("ir.model", { url, database: "db", uid: 72 })).toBeUndefined();
    expect(
      getModelEntryFromCache("ir.model", { url, database: "different", uid: 71 }),
    ).toBeUndefined();
    expect((await getCatalogSnapshot(second, url, "db")).cached).toBe(false);
    expect(searchRead).toHaveBeenCalledTimes(11);
  });

  it("does not cache a failed schema probe or expose its error", async () => {
    const searchRead = vi.fn().mockRejectedValue(new Error("private schema detail"));
    const client = { searchRead } as unknown as OdooClient;
    expect(await getCatalogSnapshot(client, "https://catalog-failure.test", "db")).toEqual({
      schema_hash: null,
      models: [],
      cached: false,
    });
  });
});
