import { once } from "node:events";
import { createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createNodeCodeExecutor } from "../../src/ts/code-node.js";
import { createCodeGate } from "../../src/ts/code-policy.js";
import type { Operation } from "../../src/ts/types.js";

const execute = createNodeCodeExecutor(
  new URL("../../dist/code-node-isolate.mjs", import.meta.url),
);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function port(
  dispatch: (encoded: string) => Promise<string> = async () =>
    JSON.stringify({ ok: true, value: 3 }),
) {
  const controller = new AbortController();
  const close = vi.fn((reason: string) => controller.abort(reason));
  return { signal: controller.signal, close, dispatch: vi.fn(dispatch) };
}

describe("Node isolated Code Mode", () => {
  const server = createServer((_request, response) => response.end("healthy"));
  let origin = "";
  beforeAll(async () => {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No test port");
    origin = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => {
    server.close();
    await once(server, "close");
  });

  it("runs the native client over the credential-free parent bridge", async () => {
    const bridge = port(async (encoded) => {
      expect(JSON.parse(encoded)).toEqual({
        model: "res.partner",
        method: "search_count",
        args: [[]],
        kwargs: {},
      });
      return JSON.stringify({ ok: true, value: 9 });
    });
    const result = await execute(
      "return {count:await client.searchCount('res.partner'),uid:client.getSession().uid,globals:[typeof process,typeof fetch,typeof require]};",
      7,
      bridge,
    );
    expect(result).toMatchObject({
      ok: true,
      result: { count: 9, uid: 7, globals: ["undefined", "undefined", "undefined"] },
    });
    expect(result.wasm_bytes).toBeLessThanOrEqual(32 * 1024 * 1024);
    expect(bridge.dispatch).toHaveBeenCalledTimes(1);
    expect(bridge.close).toHaveBeenCalledTimes(1);
    expect(bridge.close).toHaveBeenCalledWith("execution_finished");
  });

  it("keeps parent HTTP responsive while a native builtin consumes its child CPU budget", async () => {
    const bridge = port();
    // This native QuickJS BigInt exponentiation does not observe its JS interrupt callback.
    const running = execute(
      "const n=BigInt('9'.repeat(100000)); return (n*n).toString().length;",
      7,
      bridge,
    );
    const latencies: number[] = [];
    for (let i = 0; i < 15; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const started = performance.now();
      expect(await (await fetch(origin)).text()).toBe("healthy");
      latencies.push(performance.now() - started);
    }
    const result = await running;
    expect(result.ok).toBe(false);
    expect(["fuel_limit", "cpu_limit"]).toContain(result.error);
    expect(Math.max(...latencies)).toBeLessThan(250);
    expect(result.elapsed_ms).toBeLessThan(4000);
    expect(bridge.close).toHaveBeenCalledTimes(1);
    expect(await execute("return 42;", 7, port())).toMatchObject({ ok: true, result: 42 });
  });

  it("bounds aggregate admission across executor instances and recovers after cancellation", async () => {
    const started = deferred<void>();
    let calls = 0;
    const hanging = () =>
      port(async () => {
        calls += 1;
        if (calls === 2) started.resolve();
        return new Promise<string>(() => undefined);
      });
    const a = hanging();
    const b = hanging();
    const first = execute("return await client.searchCount('res.partner');", 7, a);
    const otherExecutor = createNodeCodeExecutor(
      new URL("../../dist/code-node-isolate.mjs", import.meta.url),
    );
    const second = otherExecutor("return await client.searchCount('res.partner');", 7, b);
    await started.promise;
    const refused = port();
    expect(await execute("return 1;", 7, refused)).toMatchObject({
      ok: false,
      error: "sandbox_busy",
    });
    expect(refused.dispatch).not.toHaveBeenCalled();
    a.close("caller_cancelled");
    b.close("caller_cancelled");
    expect((await first).error).toBe("cancelled");
    expect((await second).error).toBe("cancelled");
    expect(await execute("return 2;", 7, port())).toMatchObject({ ok: true, result: 2 });
  });

  it("externally terminates an unresponsive worker even when the engine cannot report failure", async () => {
    const unresponsive = createNodeCodeExecutor(new URL("data:text/javascript,while(true){}"));
    const bridge = port();
    expect(await unresponsive("return 1;", 7, bridge)).toMatchObject({
      ok: false,
      error: "cpu_limit",
    });
    expect(bridge.close).toHaveBeenCalledTimes(1);
    expect(await execute("return 4;", 7, port())).toMatchObject({ ok: true, result: 4 });
  });

  it("closes a pending mutation as unknown exactly once when its caller cancels", async () => {
    const started = deferred<void>();
    const reply = deferred<unknown>();
    const controller = new AbortController();
    const clientCall = vi.fn(async () => {
      started.resolve();
      return reply.promise;
    });
    const operation = {
      client: { getSession: () => ({ uid: 7 }), call: clientCall },
      creds: {
        url: "https://odoo.test",
        database: "demo",
        username: "private-user",
        password: "private-password",
      },
      runtime: { config: {} },
      signal: controller.signal,
      markWrite: vi.fn(),
      abort: vi.fn(),
    } as unknown as Operation;
    const gate = createCodeGate(operation, ["mutate"], {
      schemaVersion: 1,
      targets: [
        {
          url: "https://odoo.test",
          database: "demo",
          uids: [7],
          effective: {
            schemaVersion: 1,
            source: "test-addon",
            declarations: [{ model: "res.partner", method: "write", effects: ["mutate"] }],
          },
          grants: [{ model: "res.partner", method: "write", effects: ["mutate"] }],
        },
      ],
    });
    const running = execute(
      "await client.write('res.partner',[1],{name:'Approved'}); return true;",
      7,
      gate,
    );
    await started.promise;
    controller.abort();
    const result = await running;
    expect(result).toMatchObject({ ok: false, error: "cancelled" });
    expect(gate.status()).toBe("uncertain");
    const snapshot = gate.snapshot();
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]).toMatchObject({ outcome: "unknown", category: "unknown_write" });
    reply.resolve(true);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(gate.snapshot()).toEqual(snapshot);
    expect(clientCall).toHaveBeenCalledTimes(1);
  });

  it("strips inherited environment credentials and parent startup flags", async () => {
    const previous = process.env.CODE_NODE_PRIVATE_SENTINEL;
    process.env.CODE_NODE_PRIVATE_SENTINEL = "host-only-secret";
    const source = `import {parentPort} from "node:worker_threads";
      parentPort.postMessage({kind:"close",reason:"execution_finished"});
      parentPort.postMessage({kind:"result",result:{ok:true,result:{keys:Object.keys(process.env),secret:process.env.CODE_NODE_PRIVATE_SENTINEL??null,argv:process.execArgv},logs:[],elapsed_ms:0,wasm_bytes:0}});
      parentPort.close();`;
    const isolated = createNodeCodeExecutor(
      new URL(`data:text/javascript,${encodeURIComponent(source)}`),
    );
    try {
      expect(await isolated("return 1;", 7, port())).toMatchObject({
        ok: true,
        result: { keys: [], secret: null, argv: [] },
      });
    } finally {
      if (previous === undefined) delete process.env.CODE_NODE_PRIVATE_SENTINEL;
      else process.env.CODE_NODE_PRIVATE_SENTINEL = previous;
    }
  });

  it("rejects startup failure and pre-cancelled work without retaining admission", async () => {
    const missing = createNodeCodeExecutor(
      new URL("../../dist/does-not-exist.mjs", import.meta.url),
    );
    expect((await missing("return 1;", 7, port())).ok).toBe(false);
    const cancelled = port();
    cancelled.close("caller_cancelled");
    expect(await execute("return 1;", 7, cancelled)).toMatchObject({
      ok: false,
      error: "cancelled",
    });
    expect(await execute("return 3;", 7, port())).toMatchObject({ ok: true, result: 3 });
  });
});
