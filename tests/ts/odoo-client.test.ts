import { describe, expect, it } from "vitest";
import { PublicError } from "../../src/ts/errors.js";
import { withOperation } from "../../src/ts/server.js";
import type { Credentials, Runtime } from "../../src/ts/types.js";

interface Rpc {
  id: number;
  params: { service: string; method: string; args: unknown[] };
}
function deferred() {
  let resolve: (() => void) | undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve: () => resolve?.() };
}
function credentials(username: string): Credentials {
  return {
    url: `https://${username}.invalid`,
    database: `${username}-db`,
    username,
    password: `${username}-key`,
  };
}
function response(rpc: Rpc, result: unknown): Response {
  return Response.json({ jsonrpc: "2.0", id: rpc.id, result });
}
function payload(init?: RequestInit): Rpc {
  return JSON.parse(String(init?.body)) as Rpc;
}

describe("published Odoo client request-scoped transport", () => {
  it("keeps simultaneous fetch implementations, signals, sessions and credentials independent", async () => {
    const globalFetch = globalThis.fetch;
    const aliceStarted = deferred();
    const bobStarted = deferred();
    const bobRelease = deferred();
    const aliceController = new AbortController();
    const bobController = new AbortController();
    const observations: { user: string; rpc: Rpc; signal?: AbortSignal | null }[] = [];
    const clients: { isAuthenticated(): boolean }[] = [];
    const runtime = (user: string, uid: number): Runtime => ({
      config: {},
      fetch: async (_input, init) => {
        const rpc = payload(init);
        observations.push({ user, rpc, signal: init?.signal });
        if (rpc.params.service === "common") return response(rpc, uid);
        if (user === "alice") {
          aliceStarted.resolve();
          await new Promise<never>((_resolve, reject) =>
            init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
              once: true,
            }),
          );
        }
        bobStarted.resolve();
        await bobRelease.promise;
        return response(rpc, { uid, target: user });
      },
    });
    const alice = withOperation(
      new Request("https://mcp.test/mcp", { signal: aliceController.signal }),
      runtime("alice", 11),
      credentials("alice"),
      async (operation) => {
        clients.push(operation.client);
        expect(operation.client.getSession()?.uid).toBe(11);
        return operation.client.call("res.partner", "read", [[1]], {});
      },
    );
    const bob = withOperation(
      new Request("https://mcp.test/mcp", { signal: bobController.signal }),
      runtime("bob", 22),
      credentials("bob"),
      async (operation) => {
        clients.push(operation.client);
        expect(operation.client.getSession()?.uid).toBe(22);
        return operation.client.call("res.partner", "read", [[2]], {});
      },
    );
    await Promise.all([aliceStarted.promise, bobStarted.promise]);
    const aliceResult = expect(alice).rejects.toMatchObject({ category: "connection_failed" });
    aliceController.abort();
    await aliceResult;
    const aliceSignal = observations.find((item) => item.user === "alice")?.signal;
    const bobSignal = observations.find((item) => item.user === "bob")?.signal;
    expect(aliceSignal?.aborted).toBe(true);
    expect(bobSignal?.aborted).toBe(false);
    expect(aliceSignal).not.toBe(bobSignal);
    bobRelease.resolve();
    expect(await bob).toEqual({ uid: 22, target: "bob" });
    const objectCalls = observations.filter((item) => item.rpc.params.service === "object");
    expect(objectCalls).toHaveLength(2);
    expect(objectCalls.map((item) => item.rpc.params.args.slice(0, 3))).toEqual([
      ["alice-db", 11, "alice-key"],
      ["bob-db", 22, "bob-key"],
    ]);
    expect(clients.every((client) => !client.isAuthenticated())).toBe(true);
    expect(globalThis.fetch).toBe(globalFetch);
  });

  it("does not replay a possibly dispatched mutation and clears authentication", async () => {
    const calls: Rpc[] = [];
    let client: { isAuthenticated(): boolean } | undefined;
    const operation = withOperation(
      new Request("https://mcp.test/mcp"),
      {
        config: {},
        fetch: async (_input, init) => {
          const rpc = payload(init);
          calls.push(rpc);
          if (rpc.params.service === "common") return response(rpc, 11);
          throw new Error("private upstream reply vanished");
        },
      },
      credentials("alice"),
      async (current) => {
        client = current.client;
        current.markWrite();
        return current.client.create("res.partner", { name: "private payload" });
      },
    );
    await expect(operation).rejects.toEqual(
      new PublicError("Odoo write outcome is unknown; do not retry automatically", "unknown_write"),
    );
    expect(calls.filter((rpc) => rpc.params.service === "object")).toHaveLength(1);
    expect(client?.isAuthenticated()).toBe(false);
  });

  it("distinguishes failed authentication from dispatched writes", async () => {
    let calls = 0;
    let callbackEntered = false;
    await expect(
      withOperation(
        new Request("https://mcp.test/mcp"),
        {
          config: {},
          fetch: async () => {
            calls += 1;
            throw new Error("private auth endpoint");
          },
        },
        credentials("alice"),
        async () => {
          callbackEntered = true;
        },
      ),
    ).rejects.toMatchObject({
      category: "auth_connection_failed",
      message: "Odoo authentication connection failed",
    });
    expect(calls).toBe(1);
    expect(callbackEntered).toBe(false);
  });

  it("preserves a client's refusal before mutation dispatch", async () => {
    const calls: Rpc[] = [];
    const guards: unknown[] = [];
    const operation = withOperation(
      new Request("https://mcp.test/mcp"),
      {
        config: {},
        fetch: async (_input, init) => {
          const rpc = payload(init);
          calls.push(rpc);
          return response(rpc, 11);
        },
      },
      credentials("alice"),
      async (current) => {
        current.client.setSafetyContext({
          confirm: async (operation) => {
            guards.push(operation);
            return false;
          },
        });
        current.markWrite();
        return current.client.create("res.partner", { name: "refused" });
      },
    );
    await expect(operation).rejects.toBeInstanceOf(PublicError);
    await expect(operation).rejects.not.toMatchObject({ category: "unknown_write" });
    expect(guards).toHaveLength(1);
    expect(calls.filter((rpc) => rpc.params.service === "object")).toHaveLength(0);
  });
});
