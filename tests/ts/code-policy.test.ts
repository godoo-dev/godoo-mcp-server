import {
  OdooAccessError,
  OdooNetworkError,
  OdooProtocolError,
  OdooSafetyError,
} from "@godoo-dev/client";
import { EFFECTS, type Effect } from "@godoo-dev/client/effects";
import { describe, expect, it, vi } from "vitest";
import { CODE_RPC_LIMITS } from "../../src/ts/code-contract.js";
import { createCodeGate } from "../../src/ts/code-policy.js";
import type { Operation } from "../../src/ts/types.js";

const model = "res.partner";
function rpc(method = "read", args: unknown[] = [[1]], kwargs = {}) {
  return JSON.stringify({ model, method, args, kwargs });
}
function policy(
  method = "read",
  declared: readonly Effect[] = ["read"],
  granted: readonly Effect[] = declared,
) {
  return {
    schemaVersion: 1,
    targets: [
      {
        url: "https://odoo.test/base/",
        database: "demo",
        uids: [7],
        effective: {
          schemaVersion: 1,
          source: "installed-addons-revision",
          declarations: [{ model, method, effects: [...declared] }],
        },
        grants: [{ model, method, effects: [...granted] }],
      },
    ],
  };
}
function operation(call: (...args: unknown[]) => Promise<unknown> = async () => true) {
  const controller = new AbortController();
  const spy = vi.fn(call);
  const abort = vi.fn();
  const markWrite = vi.fn();
  const op = {
    client: { getSession: () => ({ uid: 7 }), call: spy },
    creds: {
      url: "https://odoo.test/base",
      database: "demo",
      username: "secret-user",
      password: "secret-password",
    },
    runtime: { config: {} },
    signal: controller.signal,
    markWrite,
    abort,
  } as unknown as Operation;
  return { op, controller, call: spy, abort, markWrite };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
async function value(promise: Promise<string>) {
  return JSON.parse(await promise);
}

describe("host Code Mode RPC authority", () => {
  it("refuses missing coverage, wrong targets, UID and malformed policy before any dispatch", async () => {
    const { op, call } = operation();
    const wrongUrl = policy();
    wrongUrl.targets[0].url = "https://odoo.test/other";
    const wrongDb = policy();
    wrongDb.targets[0].database = "another";
    const wrongUid = policy();
    wrongUid.targets[0].uids = [8];
    const noCoverage = policy();
    noCoverage.targets[0].effective.declarations = [];
    const duplicate = policy();
    duplicate.targets.push(duplicate.targets[0]);
    for (const candidate of [
      undefined,
      {},
      "{",
      wrongUrl,
      wrongDb,
      wrongUid,
      noCoverage,
      duplicate,
    ]) {
      const gate = createCodeGate(op, ["read"], candidate);
      expect((await value(gate.dispatch(rpc()))).error.category).toBe("policy_denied");
      expect(gate.snapshot()[0].outcome).toBe("policy_refused");
      gate.close("execution_finished");
    }
    expect(call).not.toHaveBeenCalled();
  });

  it("uses authenticated UID and exact base URL while preserving request context", async () => {
    const { op, call, markWrite } = operation(async () => [{ id: 1 }]);
    const gate = createCodeGate(op, ["read"], policy());
    const kwargs = { context: { allowed_company_ids: [2], lang: "es_ES" } };
    expect(await value(gate.dispatch(rpc("read", [[1], ["name"]], kwargs)))).toEqual({
      ok: true,
      value: [{ id: 1 }],
    });
    expect(call).toHaveBeenCalledWith(model, "read", [[1], ["name"]], kwargs);
    expect(markWrite).not.toHaveBeenCalled();
    expect(gate.snapshot()[0]).toMatchObject({ outcome: "acknowledged", effects: ["read"] });
    gate.close("execution_finished");
    expect(gate.status()).toBe("success");
  });

  it("requires the full resolved effect set in operator grants and caller ceiling", async () => {
    const { op, call } = operation();
    for (const [method, declaration, grant, requested] of [
      ["unlink", ["read"], ["read"], EFFECTS],
      ["write", ["mutate"], ["mutate"], ["read"]],
      ["message_post", ["mutate"], ["mutate"], EFFECTS],
      ["_portal_ensure_token", ["read"], ["read", "mutate"], EFFECTS],
    ] as const) {
      const gate = createCodeGate(op, requested, policy(method, declaration, grant));
      expect((await value(gate.dispatch(rpc(method)))).error.category).toBe("policy_denied");
      gate.close("execution_finished");
    }
    expect(call).not.toHaveBeenCalled();
  });

  it("additive addon effects cannot downgrade effective behavior", async () => {
    const { op, call } = operation();
    const candidate = {
      ...policy(),
      targets: policy().targets.map((target) => ({
        ...target,
        addons: [
          {
            schemaVersion: 1,
            source: "extra-addon",
            declarations: [{ model, method: "read", effects: ["external"] }],
          },
        ],
      })),
    };
    const gate = createCodeGate(op, ["read"], candidate);
    expect((await value(gate.dispatch(rpc()))).error.category).toBe("policy_denied");
    expect(call).not.toHaveBeenCalled();
    gate.close("execution_finished");
  });

  it("requires explicit all-effect grants for unclassified custom methods", async () => {
    const { op, call } = operation();
    const candidate = policy("custom", ["unknown"], EFFECTS);
    const denied = createCodeGate(
      op,
      ["read", "mutate", "destructive", "external", "schema", "disclose"],
      candidate,
    );
    expect((await value(denied.dispatch(rpc("custom")))).ok).toBe(false);
    denied.close("execution_finished");
    const allowed = createCodeGate(op, EFFECTS, candidate);
    expect((await value(allowed.dispatch(rpc("custom")))).ok).toBe(true);
    expect(call).toHaveBeenCalledTimes(1);
    allowed.close("execution_finished");
  });

  it("honors exact argument constraints and per-grant call budget", async () => {
    const { op, call } = operation();
    const candidate = policy("write", ["mutate"]);
    const target = candidate.targets[0];
    target.grants = [
      {
        ...target.grants[0],
        args: [[1], { name: "approved", active: true }],
        kwargs: { context: { lang: "en_US" } },
        maxCalls: 1,
      } as (typeof target.grants)[0],
    ];
    const gate = createCodeGate(op, ["mutate"], candidate);
    expect(
      (
        await value(
          gate.dispatch(
            rpc("write", [[2], { name: "approved", active: true }], { context: { lang: "en_US" } }),
          ),
        )
      ).ok,
    ).toBe(false);
    const approved = rpc("write", [[1], { active: true, name: "approved" }], {
      context: { lang: "en_US" },
    });
    expect((await value(gate.dispatch(approved))).ok).toBe(true);
    expect((await value(gate.dispatch(approved))).ok).toBe(false);
    expect(call).toHaveBeenCalledTimes(1);
    gate.close("execution_finished");
  });

  it("rejects guest policy fields and invalid context without leaking their values", async () => {
    const { op, call } = operation();
    const gate = createCodeGate(op, EFFECTS, policy());
    const malicious = JSON.stringify({
      model,
      method: "read",
      args: [],
      kwargs: {},
      safetyLevel: "READ",
      effective: { password: "secret-password" },
    });
    expect((await value(gate.dispatch(malicious))).error.category).toBe("invalid_rpc");
    expect((await value(gate.dispatch(rpc("read", [], { context: [] })))).error.category).toBe(
      "invalid_rpc",
    );
    expect(JSON.stringify(gate.snapshot())).not.toContain("secret");
    expect(call).not.toHaveBeenCalled();
    gate.close("execution_finished");
  });
});

describe("RPC outcome and lifecycle accounting", () => {
  it("keeps acknowledged writes, closes after unknown write and refuses a caught retry", async () => {
    let writes = 0;
    const { op, call } = operation(async () => {
      writes += 1;
      if (writes === 2) throw new OdooNetworkError("secret-password", new Error("private-host"));
      return true;
    });
    const gate = createCodeGate(op, ["mutate"], policy("write", ["mutate"]));
    expect((await value(gate.dispatch(rpc("write")))).ok).toBe(true);
    expect((await value(gate.dispatch(rpc("write")))).error.category).toBe("unknown_write");
    expect((await value(gate.dispatch(rpc("write")))).error.category).toBe("gate_closed");
    expect(call).toHaveBeenCalledTimes(2);
    expect(gate.status()).toBe("uncertain");
    expect(gate.snapshot().map((entry) => entry.outcome)).toEqual([
      "acknowledged",
      "unknown",
      "not_dispatched",
    ]);
    expect(JSON.stringify(gate.snapshot())).not.toContain("secret");
  });

  it("distinguishes definite Odoo rejection and local guard from transport uncertainty", async () => {
    for (const [error, outcome, category] of [
      [new OdooAccessError("secret"), "rejected", "access_denied"],
      [new OdooProtocolError("secret"), "unknown", "unknown_write"],
      [
        new OdooSafetyError({ name: "write", level: "WRITE", model, description: "secret" }),
        "not_dispatched",
        "write_not_approved",
      ],
    ] as const) {
      const { op } = operation(async () => {
        throw error;
      });
      const gate = createCodeGate(op, ["mutate"], policy("write", ["mutate"]));
      const result = await value(gate.dispatch(rpc("write")));
      expect(result.error.category).toBe(category);
      expect(gate.snapshot()[0].outcome).toBe(outcome);
      expect(JSON.stringify(result)).not.toContain("secret");
      gate.close("execution_finished");
    }
  });

  it("preserves acknowledged mutation when its result exceeds the bridge limit", async () => {
    const { op, call } = operation(async () => "x".repeat(CODE_RPC_LIMITS.resultBytes));
    const gate = createCodeGate(op, ["mutate"], policy("write", ["mutate"]));
    expect((await value(gate.dispatch(rpc("write")))).error.category).toBe("result_limit");
    expect(gate.snapshot()[0]).toMatchObject({ outcome: "acknowledged", category: "result_limit" });
    expect(gate.status()).toBe("failed");
    expect((await value(gate.dispatch(rpc("write")))).error.category).toBe("gate_closed");
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("preserves acknowledged mutation after serialization failure", async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const { op } = operation(async () => circular);
    const gate = createCodeGate(op, ["mutate"], policy("write", ["mutate"]));
    expect((await value(gate.dispatch(rpc("write")))).error.category).toBe("result_serialization");
    expect(gate.snapshot()[0].outcome).toBe("acknowledged");
    expect(gate.status()).toBe("failed");
    gate.close("execution_finished");
  });

  it("freezes in-flight unknown outcomes on close even when the transport settles later", async () => {
    const pending = deferred<unknown>();
    const { op, abort } = operation(() => pending.promise);
    const gate = createCodeGate(op, ["mutate"], policy("write", ["mutate"]));
    const executing = gate.dispatch(rpc("write"));
    gate.close("execution_finished");
    const snapshot = gate.snapshot();
    expect(snapshot[0].outcome).toBe("unknown");
    expect((await value(executing)).error.category).toBe("unknown_write");
    pending.resolve(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(gate.snapshot()).toEqual(snapshot);
    expect(gate.status()).toBe("uncertain");
    expect(abort).toHaveBeenCalledTimes(1);
    snapshot[0].outcome = "acknowledged";
    expect(gate.snapshot()[0].outcome).toBe("unknown");
  });

  it("serializes guest Promise.all requests in FIFO order", async () => {
    let active = 0;
    let maximum = 0;
    const observed: number[] = [];
    const { op } = operation(async (_model, _method, args) => {
      active += 1;
      maximum = Math.max(maximum, active);
      const id = (args as number[][])[0][0];
      observed.push(id);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      return id;
    });
    const gate = createCodeGate(op, ["read"], policy());
    const results = await Promise.all(
      [1, 2, 3, 4].map((id) => value(gate.dispatch(rpc("read", [[id]])))),
    );
    expect(results.map((result) => result.value)).toEqual([1, 2, 3, 4]);
    expect(observed).toEqual([1, 2, 3, 4]);
    expect(maximum).toBe(1);
    expect(gate.snapshot().map((entry) => entry.outcome)).toEqual(Array(4).fill("acknowledged"));
    gate.close("execution_finished");
    expect(gate.status()).toBe("success");
  });

  it("finalizes active and queued entries synchronously on cancellation", async () => {
    const pending = deferred<unknown>();
    const { op, controller, call } = operation(() => pending.promise);
    const gate = createCodeGate(op, ["read"], policy());
    const calls = [gate.dispatch(rpc()), gate.dispatch(rpc()), gate.dispatch(rpc())];
    controller.abort();
    const snapshot = gate.snapshot();
    expect(snapshot.map((entry) => entry.outcome)).toEqual([
      "unknown",
      "not_dispatched",
      "not_dispatched",
    ]);
    expect(snapshot.map((entry) => entry.category)).toEqual([
      "connection_failed",
      "gate_closed",
      "gate_closed",
    ]);
    const responses = await Promise.all(calls.map(value));
    expect(responses.map((response) => response.error.category)).toEqual([
      "connection_failed",
      "gate_closed",
      "gate_closed",
    ]);
    pending.resolve(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(gate.snapshot()).toEqual(snapshot);
    expect(gate.status()).toBe("failed");
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("refuses queued writes after an uncertain predecessor without spending another RPC", async () => {
    const pending = deferred<unknown>();
    const { op, call } = operation(async () => {
      await pending.promise;
      throw new OdooNetworkError("lost reply", new Error("private transport"));
    });
    const gate = createCodeGate(op, ["mutate"], policy("write", ["mutate"]));
    const first = gate.dispatch(rpc("write"));
    const second = gate.dispatch(rpc("write"));
    pending.resolve(true);
    expect((await value(first)).error.category).toBe("unknown_write");
    const snapshot = gate.snapshot();
    expect(snapshot.map((entry) => entry.outcome)).toEqual(["unknown", "not_dispatched"]);
    expect((await value(second)).error.category).toBe("gate_closed");
    expect(gate.snapshot()).toEqual(snapshot);
    expect(call).toHaveBeenCalledTimes(1);
    expect(gate.status()).toBe("uncertain");
  });

  it("closes unawaited queued mutations without later ledger changes", async () => {
    const pending = deferred<unknown>();
    const { op, call } = operation(() => pending.promise);
    const gate = createCodeGate(op, ["mutate"], policy("write", ["mutate"]));
    const calls = [gate.dispatch(rpc("write")), gate.dispatch(rpc("write"))];
    gate.close("execution_finished");
    const snapshot = gate.snapshot();
    expect(snapshot.map((entry) => entry.outcome)).toEqual(["unknown", "not_dispatched"]);
    await Promise.all(calls);
    pending.resolve(true);
    await Promise.resolve();
    expect(gate.snapshot()).toEqual(snapshot);
    expect(call).toHaveBeenCalledTimes(1);
    expect(gate.status()).toBe("uncertain");
  });

  it("reserves queued grants from a detached policy snapshot", async () => {
    const pending = deferred<unknown>();
    const { op, call } = operation(() => pending.promise);
    const candidate = policy();
    candidate.targets[0].grants[0] = {
      ...candidate.targets[0].grants[0],
      maxCalls: 2,
    } as (typeof candidate.targets)[0]["grants"][0];
    const gate = createCodeGate(op, ["read"], candidate);
    const first = gate.dispatch(rpc());
    const second = gate.dispatch(rpc());
    expect((await value(gate.dispatch(rpc()))).error.category).toBe("policy_denied");
    candidate.targets[0].effective.declarations[0].effects = ["unknown"];
    candidate.targets[0].grants.length = 0;
    pending.resolve(true);
    await Promise.all([first, second]);
    expect(call).toHaveBeenCalledTimes(2);
    gate.close("execution_finished");
  });

  it("bounds malformed attempts and oversized arguments without host dispatch", async () => {
    const { op, call } = operation();
    const gate = createCodeGate(op, ["read"], policy());
    for (let i = 0; i < CODE_RPC_LIMITS.attempts + 5; i += 1) await gate.dispatch("{");
    expect(gate.snapshot()).toHaveLength(CODE_RPC_LIMITS.attempts);
    expect(gate.signal.aborted).toBe(true);
    const large = createCodeGate(op, ["read"], policy());
    expect(
      (await value(large.dispatch("x".repeat(CODE_RPC_LIMITS.argumentBytes + 1)))).error.category,
    ).toBe("argument_limit");
    expect(call).not.toHaveBeenCalled();
  });
});
