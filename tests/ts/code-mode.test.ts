import type { OdooClient } from "@godoo-dev/client";
import { OdooNetworkError } from "@godoo-dev/client";
import type { Effect } from "@godoo-dev/client/effects";
import { describe, expect, it, vi } from "vitest";
import { CODE_LIMITS, executeCode } from "../../src/ts/code-engine.js";
import { codeReference, registerCodeMode } from "../../src/ts/code-mode.js";
import { createCodeGate } from "../../src/ts/code-policy.js";
import type { ObjectStore, Operation, Registration, ToolHandler } from "../../src/ts/types.js";

function fixture(
  call: (...args: unknown[]) => Promise<unknown> = async () => [{ id: 1 }],
  effects: Effect[] = ["read"],
) {
  const declarations = [
    "res.partner",
    "ir.model",
    "ir.model.fields",
    "account.journal",
    "project.task",
    "project.project",
    "godoo.cdc",
  ].flatMap((model) =>
    [
      "read",
      "search",
      "search_read",
      "search_count",
      "fields_get",
      "create",
      "write",
      "unlink",
      "commit_drop",
    ].map((method) => ({ model, method, effects })),
  );
  const controller = new AbortController();
  const spy = vi.fn(call);
  const operation: Operation = {
    client: { getSession: () => ({ uid: 7 }), call: spy } as unknown as OdooClient,
    creds: {
      url: "https://fixture.test",
      database: "disposable",
      username: "host-user",
      password: "host-secret-canary",
    },
    runtime: {
      executeCode,
      config: {
        ODOO_CODE_POLICY: JSON.stringify({
          schemaVersion: 1,
          targets: [
            {
              url: "https://fixture.test",
              database: "disposable",
              uids: [7],
              effective: { schemaVersion: 1, source: "test-installation", declarations },
              grants: declarations,
            },
          ],
        }),
      },
    },
    signal: controller.signal,
    markWrite: vi.fn(),
    abort: vi.fn(),
  };
  const handlers: Record<string, ToolHandler> = {};
  registerCodeMode({
    register: (name, _schema, handler) => {
      handlers[name] = handler;
    },
  } as Registration);
  const run = (code: string, extra: Record<string, unknown> = {}) =>
    handlers.code_execute(
      { code, effects, max_return_bytes: null, ...extra },
      operation,
    ) as Promise<Record<string, unknown>>;
  return { operation, run, spy, controller };
}

describe("native SDK sandbox", () => {
  it("runs real client helpers, passes context/JSON values, and keeps credentials/host APIs outside", async () => {
    const { run, spy } = fixture(async (...args) => ({ args }));
    const result = await run(
      `const value=await client.call('res.partner','read',[[1],false,null,0],{context:{lang:'es_ES',allowed_company_ids:[2]}}); return {value,uid:client.getSession().uid,fetch:typeof fetch,process:typeof process,require:typeof require,transport:typeof client.authenticate,secret:JSON.stringify(client).includes('host-secret-canary')};`,
    );
    expect(result.status).toBe("success");
    expect(result.result).toMatchObject({
      uid: 7,
      fetch: "undefined",
      process: "undefined",
      require: "undefined",
      transport: "undefined",
      secret: false,
    });
    expect(spy).toHaveBeenCalledWith("res.partner", "read", [[1], false, null, 0], {
      context: { lang: "es_ES", allowed_company_ids: [2] },
    });
  });
  it("retains actual introspection Maps and cache identity", async () => {
    const { run, spy } = fixture(async (model, method) =>
      method === "fields_get"
        ? { name: { type: "char", translate: true } }
        : model === "ir.model"
          ? [{ id: 1, model: "res.partner", name: "Contacts" }]
          : [{ name: "name", ttype: "char", model: "res.partner" }],
    );
    const result = await run(
      `const a=await introspect.getModelMetadata('res.partner'); const b=await introspect.getModelMetadata('res.partner'); const attrs=await introspect.getFieldAttributes('res.partner'); return {cached:a===b,map:attrs instanceof Map,entries:[...attrs],name:formatters.modelNameToInterfaceName('res.partner')};`,
    );
    expect(result).toMatchObject({
      status: "success",
      result: { cached: true, map: true, name: "ResPartner" },
    });
    expect(spy.mock.calls.filter((call) => call[1] === "fields_get")).toHaveLength(1);
  });
  it("runs native accounting and property scopes/bindings", async () => {
    const { run } = fixture(async (model, method, args) => {
      if (model === "account.journal")
        return [{ id: 5, type: "bank", default_account_id: [57, "Cash"] }];
      if (method === "fields_get")
        return (args as string[][])[0][0] === "project_id"
          ? { project_id: { type: "many2one", relation: "project.project" } }
          : {
              task_properties: {
                type: "properties",
                definition_record: "project_id",
                definition_record_field: "task_properties_definition",
              },
            };
      if (model === "project.project")
        return [
          {
            id: 4,
            task_properties_definition: [
              { name: "estimate", string: "Estimate", type: "float", default: 0 },
            ],
          },
        ];
      return [
        {
          id: 9,
          project_id: [4, "Project"],
          task_properties: [{ name: "estimate", type: "float", string: "Estimate", value: 3.5 }],
        },
      ];
    });
    const result = await run(
      `const cash=await client.accounting.getCashAccountIds(); const scope=await client.properties.scope('project.task','task_properties',{parentId:4}); const binding=scope.bind({estimate:{label:'Estimate',type:'float'}}); const rows=await binding.read([9]); return {cash,properties:rows[0].properties};`,
    );
    expect(result).toMatchObject({
      status: "success",
      result: { cash: [57], properties: { estimate: 3.5 } },
    });
  });
  it("blocks guest safety overrides before RPC dispatch", async () => {
    const { run, spy } = fixture();
    const result = await run(
      `client.setSafetyContext(null); try { await client.call('res.partner','unlink',[[1]],{}, {safetyLevel:'READ'}); }catch{} return 'claimed success';`,
    );
    expect(result.status).toBe("failed");
    expect(result.ledger).toMatchObject([
      { outcome: "policy_refused", effects: ["read", "mutate", "destructive"] },
    ]);
    expect(spy).not.toHaveBeenCalled();
  });
  it("preserves acknowledged A and uncertain B despite guest catches and retries", async () => {
    const effects: Effect[] = ["read", "mutate"];
    const { run, spy } = fixture(async (_model, method) => {
      if (method === "commit_drop") throw new OdooNetworkError("host-secret-canary", new Error());
      return true;
    }, effects);
    const result = await run(
      `await client.write('res.partner',[1],{name:'A'}); try{await client.call('res.partner','commit_drop');}catch{} try{await client.write('res.partner',[1],{name:'C'});}catch{} return 'success';`,
    );
    expect(result.status).toBe("uncertain");
    expect(result.ledger).toMatchObject([
      { outcome: "acknowledged" },
      { outcome: "unknown", category: "unknown_write" },
    ]);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(result)).not.toContain("host-secret-canary");
  });
  it("bounds hostile CPU, heap and logs, then runs a healthy sibling", async () => {
    const { run } = fixture();
    for (const code of [
      "while(true){}",
      "const a=[];for(let i=0;i<100000;i++)a.push(new Array(10000).fill(i));",
      "console.log('x'.repeat(5000));",
    ]) {
      const result = await run(code);
      expect(result.status).toBe("failed");
      expect(await run("return 42;")).toMatchObject({ status: "success", result: 42 });
    }
  });
  it("cancels unawaited writes at return and freezes late acknowledgments", async () => {
    let release!: (value: boolean) => void;
    const { run } = fixture(
      () =>
        new Promise<boolean>((resolve) => {
          release = resolve;
        }),
      ["read", "mutate"],
    );
    const result = await run(
      "client.write('res.partner',[1],{name:'x'}).catch(()=>{}); return 'done';",
    );
    expect(result).toMatchObject({ status: "uncertain", ledger: [{ outcome: "unknown" }] });
    release(true);
    await Promise.resolve();
    expect(result).toMatchObject({ ledger: [{ outcome: "unknown" }] });
  });
  it("routes only final UTF-8 JSON to actual artifact machinery and preserves ledger on storage failure", async () => {
    const { run, operation, spy } = fixture(async () => true, ["read", "mutate"]);
    const objects = new Map<string, Uint8Array>();
    operation.runtime.storage = {
      sign: async () => "https://private.test/object",
      put: async (key, value) => {
        objects.set(key, value);
      },
      head: async (key) => ({ key, lastModified: new Date() }),
      delete: async () => {},
      list: async function* () {},
    } satisfies ObjectStore;
    const code =
      "await client.write('res.partner',[1],{name:'A'}); return {value:'résumé'.repeat(200)};";
    const result = await run(code, { max_return_bytes: 500 });
    expect(result).toMatchObject({
      status: "success",
      ledger: [{ outcome: "acknowledged" }],
      result: { delivery: "artifact" },
    });
    expect(JSON.parse(new TextDecoder().decode([...objects.values()][0]))).toEqual({
      value: "résumé".repeat(200),
    });
    operation.runtime.storage.put = async () => {
      throw new Error("private provider error");
    };
    expect(await run(code, { max_return_bytes: 0 })).toMatchObject({
      status: "failed",
      error: "result_delivery_failed",
      ledger: [{ outcome: "acknowledged" }],
    });
    expect(spy).toHaveBeenCalledTimes(2);
  });
  it("rejects source/final byte overflow and admission saturation without waiting", async () => {
    const { operation } = fixture();
    const port = () => createCodeGate(operation, ["read"]);
    expect(await executeCode("x".repeat(65537), 7, port())).toMatchObject({
      ok: false,
      error: "source_limit",
    });
    const { run } = fixture();
    expect(await run("return 'x'.repeat(1048576);")).toMatchObject({
      status: "failed",
      error: "final_limit",
    });
    const abort = new AbortController();
    const hung = () => ({
      signal: abort.signal,
      dispatch: async () => new Promise<string>(() => {}),
      close: () => {},
    });
    const a = executeCode("await client.searchCount('res.partner');", 7, hung());
    const b = executeCode("await client.searchCount('res.partner');", 7, hung());
    expect(await executeCode("return 1;", 7, port())).toMatchObject({
      ok: false,
      error: "sandbox_busy",
    });
    abort.abort();
    const results = await Promise.all([a, b]);
    expect(results.every((item) => item.wasm_bytes <= CODE_LIMITS.wasm_bytes)).toBe(true);
    expect(await run("return 1;")).toMatchObject({ status: "success", result: 1 });
  });
  it("delivers supplied declarations progressively without Odoo", () => {
    expect(codeReference("index")).toMatchObject({ revision: "portable-v1" });
    expect(codeReference("type/BoundClientConfig")).toMatchObject({
      declaration: expect.stringContaining("rpc: ModelRpc"),
    });
    expect(() => codeReference("type/__proto__")).toThrow();
  });

  it("bounds empty log entries and preserves SDK URL/error helpers", async () => {
    const { run } = fixture();
    const logs = await run("for(let i=0;i<10000;i++)console.log(''); return true;");
    expect(logs.status).toBe("failed");
    expect((logs.logs as string[]).length).toBeLessThanOrEqual(CODE_LIMITS.log_entries);
    expect(new TextEncoder().encode(JSON.stringify(logs.logs)).length).toBeLessThanOrEqual(
      CODE_LIMITS.log_bytes + 2,
    );
    // Pure client implementation satisfies the SDK's local cache/URL contract without network access.
    expect(
      await run(
        "const c=sdk.createBoundClient({rpc:async()=> 'https://example.test/'}); return await c.urls.getRecordUrl('res.partner',42);",
      ),
    ).toMatchObject({
      status: "success",
      result: "https://example.test/mail/view?model=res.partner&res_id=42",
    });
  });

  it("preserves acknowledged ledger when final JSON is too deep for host serialization", async () => {
    const { run, spy } = fixture(async () => true, ["read", "mutate"]);
    const result = await run(
      `await client.write('res.partner',[1],{name:'A'});globalThis.__codeOutcome='{"ok":true,"result":'+'['.repeat(10000)+'0'+']'.repeat(10000)+'}';await new Promise(()=>{});`,
    );
    expect(result).toMatchObject({
      status: "failed",
      error: "final_structure_limit",
      ledger: [{ outcome: "acknowledged" }],
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("code_execute envelope", () => {
  const executed = (value: Partial<Record<string, unknown>>) => ({
    ok: true,
    logs: ["l"],
    elapsed_ms: 3,
    wasm_bytes: 0,
    ...value,
  });

  it("reports an unavailable runtime with a closed gate", async () => {
    const { operation, run } = fixture();
    operation.runtime.executeCode = undefined;
    expect(await run("return 1;")).toEqual({
      status: "failed",
      error: "code_runtime_unavailable",
      ledger: [],
      logs: [],
    });
  });

  it("maps executor outcomes onto envelope status, error and result", async () => {
    const { operation, run } = fixture();
    const stub = vi.fn();
    operation.runtime.executeCode = stub;
    stub.mockResolvedValueOnce(executed({ result: undefined }));
    expect(await run("x")).toEqual({
      status: "success",
      ledger: [],
      logs: ["l"],
      elapsed_ms: 3,
      result: null,
    });
    stub.mockResolvedValueOnce(executed({ ok: false, error: "guest_error", result: 5 }));
    expect(await run("x")).toEqual({
      status: "failed",
      error: "guest_error",
      ledger: [],
      logs: ["l"],
      elapsed_ms: 3,
    });
    stub.mockResolvedValueOnce(executed({ result: 1n }));
    expect(await run("x")).toEqual({
      status: "failed",
      error: "result_serialization_failed",
      ledger: [],
      logs: ["l"],
      elapsed_ms: 3,
    });
    stub.mockResolvedValueOnce(executed({ result: "abc" }));
    expect(await run("x", { max_return_bytes: 5 })).toMatchObject({
      status: "success",
      result: "abc",
    });
    expect(stub).toHaveBeenCalledWith("x", 7, expect.anything());
  });

  it("keeps uncertain gate status over executor failure and delivery failure", async () => {
    const { operation, run } = fixture(() => new Promise(() => undefined), ["read", "mutate"]);
    const real = executeCode;
    operation.runtime.executeCode = async (code, uid, port) => {
      const result = await real(code, uid, port);
      return { ...result, ok: code.includes("ok"), result: 1n };
    };
    const code = "client.write('res.partner',[1],{name:'x'}).catch(()=>{}); return 'ok';";
    expect(await run(code)).toMatchObject({
      status: "uncertain",
      error: "result_serialization_failed",
    });
    expect(await run(code.replace("ok", "no"))).toMatchObject({ status: "uncertain" });
  });
});

describe("code engine limits", () => {
  it.each([
    ["a thrown guest error", "throw new Error('x');", "guest_error"],
    [
      "a guest-reported failure",
      "globalThis.__codeOutcome='{\"ok\":false}'; await new Promise(()=>{});",
      "guest_error",
    ],
    [
      "a non-string outcome",
      "globalThis.__codeOutcome=1; await new Promise(()=>{});",
      "guest_error",
    ],
    [
      "too many rpc attempts",
      "for(let i=0;i<65;i++) client.searchCount('res.partner').catch(()=>{}); await new Promise(()=>{});",
      "rpc_limit",
    ],
    [
      "an oversized rpc argument",
      "await client.call('res.partner','read',['x'.repeat(262145)]).catch(()=>{}); await new Promise(()=>{});",
      "argument_limit",
    ],
    ["too many final JSON nodes", "return new Array(50001).fill(0);", "final_structure_limit"],
    ["a syntax error", "return )(;", "guest_error"],
  ])("fails on %s", async (_name, code, error) => {
    const { operation } = fixture();
    const port = createCodeGate(operation, ["read"]);
    const result = await executeCode(code, 7, port);
    expect(result).toMatchObject({ ok: false, error });
  });

  it("accepts brackets, quotes and escapes inside final JSON strings", async () => {
    const { run } = fixture();
    const text = `${"[".repeat(100)}\\"{${"{".repeat(100)}`;
    expect(
      await run(`return [${JSON.stringify(text)}, new Array(40000).fill(0).length];`),
    ).toMatchObject({
      status: "success",
      result: [text, 40000],
    });
  });

  it("keeps successful logs and refuses pre-cancelled work", async () => {
    const { run } = fixture();
    expect(await run("console.log('a', 1); console.warn('b'); return null;")).toMatchObject({
      status: "success",
      logs: ["a 1", "b"],
      result: null,
    });
    const controller = new AbortController();
    controller.abort();
    const closed: string[] = [];
    const result = await executeCode("return 1;", 7, {
      signal: controller.signal,
      dispatch: async () => "",
      close: (reason) => closed.push(reason),
    });
    expect(result).toMatchObject({ ok: false, error: "sandbox_failed", logs: [], wasm_bytes: 0 });
    expect(closed).toEqual(["execution_finished"]);
  });

  it("cancels running guest code and keeps the first terminal reason", async () => {
    const controller = new AbortController();
    const closed: string[] = [];
    const running = executeCode("await new Promise(()=>{});", 7, {
      signal: controller.signal,
      dispatch: async () => "",
      close: (reason) => closed.push(reason),
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    controller.abort();
    expect(await running).toMatchObject({ ok: false, error: "cancelled" });
    // Abort stops first; the run loop then closes with deadline; cleanup repeats the terminal reason.
    expect(closed).toEqual(["cancelled", "deadline", "cancelled"]);
  });
});
