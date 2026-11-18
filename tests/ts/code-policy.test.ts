import {
  OdooAccessError,
  OdooAuthError,
  OdooMissingError,
  OdooNetworkError,
  OdooProtocolError,
  OdooRpcError,
  OdooSafetyError,
  OdooValidationError,
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

describe("characterization of admission and outcome branches", () => {
  it("compares grant arguments as JSON ignoring only object key order", async () => {
    for (const [granted, requested, admitted] of [
      [[{ a: 1, b: [1, 2] }], [{ b: [1, 2], a: 1 }], true],
      [[null], [null], true],
      [[[1]], [{ 0: 1 }], false],
      [[{ 0: 1 }], [[1]], false],
      [[{ a: 1 }], [{ a: 1, b: 2 }], false],
      [[{ a: 1, b: 2 }], [{ a: 1 }], false],
      [[{ a: 1, b: 2 }], [{ a: 1, c: 2 }], false],
      [[null], [{}], false],
      [[{}], [null], false],
      [[1], ["1"], false],
      [[[1, 2]], [[2, 1]], false],
      [[{ a: { b: 1 } }], [{ a: { b: 2 } }], false],
    ] as const) {
      const { op, call } = operation();
      const candidate = policy();
      candidate.targets[0].grants = [
        {
          ...candidate.targets[0].grants[0],
          args: granted,
        } as (typeof candidate.targets)[0]["grants"][0],
      ];
      const gate = createCodeGate(op, ["read"], candidate);
      const result = await value(gate.dispatch(rpc("read", [...requested])));
      expect(result.ok).toBe(admitted);
      if (!admitted) expect(result.error.category).toBe("policy_denied");
      expect(call).toHaveBeenCalledTimes(admitted ? 1 : 0);
      gate.close("execution_finished");
    }
  });

  it("compares grant kwargs including absent keys", async () => {
    for (const [granted, requested, admitted] of [
      [{}, {}, true],
      [{ context: { lang: "en_US" } }, {}, false],
      [{}, { context: { lang: "en_US" } }, false],
    ] as const) {
      const { op } = operation();
      const candidate = policy();
      candidate.targets[0].grants = [
        {
          ...candidate.targets[0].grants[0],
          kwargs: granted,
        } as (typeof candidate.targets)[0]["grants"][0],
      ];
      const gate = createCodeGate(op, ["read"], candidate);
      expect((await value(gate.dispatch(rpc("read", [[1]], requested)))).ok).toBe(admitted);
      gate.close("execution_finished");
    }
  });

  it("refuses invalid caller effect ceilings as policy denials", async () => {
    for (const requested of [["bogus"], ["read", "bogus"], "read"]) {
      const { op, call } = operation();
      const gate = createCodeGate(op, requested as never, policy());
      const result = await value(gate.dispatch(rpc()));
      expect(result.error).toEqual({
        category: "policy_denied",
        message: "Host policy does not authorize this Odoo RPC and its effects",
      });
      expect(gate.snapshot()[0]).toMatchObject({ outcome: "policy_refused", effects: ["read"] });
      expect(call).not.toHaveBeenCalled();
      gate.close("execution_finished");
    }
  });

  it("rejects malformed requests as invalid_rpc without closing the gate", async () => {
    const deep = `${"[".repeat(70)}${"]".repeat(70)}`;
    for (const encoded of [
      "{",
      deep,
      JSON.stringify({ model, method: "read", args: [], kwargs: {}, nested: JSON.parse(deep) }),
      rpc("read", [], { context: null }),
      rpc("read", [], { context: "en_US" }),
      JSON.stringify({ model, method: "read", args: [] }),
      JSON.stringify({ model: "1bad", method: "read", args: [], kwargs: {} }),
    ]) {
      const { op, call } = operation();
      const gate = createCodeGate(op, ["read"], policy());
      expect(await value(gate.dispatch(encoded))).toEqual({
        ok: false,
        error: { category: "invalid_rpc", message: "Invalid Code Mode model RPC request" },
      });
      expect(gate.snapshot()[0]).toMatchObject({
        outcome: "not_dispatched",
        category: "invalid_rpc",
        model: "",
        method: "",
      });
      expect(gate.signal.aborted).toBe(false);
      expect((await value(gate.dispatch(rpc()))).ok).toBe(true);
      expect(call).toHaveBeenCalledTimes(1);
      gate.close("execution_finished");
      expect(gate.status()).toBe("failed");
    }
  });

  it("enforces attempt, argument type and cumulative argument limits", async () => {
    const { op, call, abort } = operation();
    const attempts = createCodeGate(op, ["read"], policy());
    for (let i = 0; i < CODE_RPC_LIMITS.attempts; i += 1) await attempts.dispatch("{");
    expect(await value(attempts.dispatch(rpc()))).toEqual({
      ok: false,
      error: { category: "rpc_limit", message: "Code Mode RPC attempt limit exceeded" },
    });
    expect(abort).toHaveBeenCalledWith("rpc_limit");
    expect(attempts.snapshot()).toHaveLength(CODE_RPC_LIMITS.attempts);

    const typed = createCodeGate(op, ["read"], policy());
    expect(await value(typed.dispatch(42 as never))).toEqual({
      ok: false,
      error: {
        category: "argument_limit",
        message: "Code Mode RPC arguments exceed the size limit",
      },
    });
    expect(typed.signal.aborted).toBe(true);
    expect(typed.snapshot()[0]).toMatchObject({
      outcome: "not_dispatched",
      category: "argument_limit",
    });
    expect((await value(typed.dispatch(rpc()))).error.category).toBe("gate_closed");

    const total = createCodeGate(op, ["read"], policy());
    const chunk = "x".repeat(CODE_RPC_LIMITS.argumentBytes);
    const count = CODE_RPC_LIMITS.totalArgumentBytes / CODE_RPC_LIMITS.argumentBytes;
    for (let i = 0; i < count; i += 1)
      expect((await value(total.dispatch(chunk))).error.category).toBe("invalid_rpc");
    expect((await value(total.dispatch(rpc()))).error.category).toBe("argument_limit");
    expect(total.status()).toBe("failed");
    expect(call).not.toHaveBeenCalled();
  });

  it("enforces the cumulative result limit after acknowledgement", async () => {
    const { op, call, abort } = operation(async () =>
      "x".repeat(CODE_RPC_LIMITS.resultBytes - 100),
    );
    const gate = createCodeGate(op, ["read"], policy());
    const count = CODE_RPC_LIMITS.totalResultBytes / CODE_RPC_LIMITS.resultBytes;
    for (let i = 0; i < count; i += 1) expect((await value(gate.dispatch(rpc()))).ok).toBe(true);
    expect(await value(gate.dispatch(rpc()))).toEqual({
      ok: false,
      error: { category: "result_limit", message: "Code Mode RPC results exceed the size limit" },
    });
    expect(gate.snapshot()[count]).toMatchObject({
      outcome: "acknowledged",
      category: "result_limit",
    });
    expect(abort).toHaveBeenCalledWith("result_limit");
    expect(gate.status()).toBe("failed");
    expect(call).toHaveBeenCalledTimes(count + 1);
  });

  it("maps definite Odoo rejections to categories and keeps the gate open", async () => {
    for (const [error, category, message] of [
      [new OdooAccessError("secret"), "access_denied", "Odoo access denied"],
      [new OdooAuthError("secret"), "auth_failed", "Odoo rejected the request"],
      [new OdooMissingError("secret"), "missing_record", "Odoo rejected the request"],
      [new OdooValidationError("secret"), "odoo_rejected", "Odoo rejected the request"],
      [new OdooRpcError("secret"), "odoo_rejected", "Odoo rejected the request"],
    ] as const) {
      const { op, markWrite } = operation(async () => {
        throw error;
      });
      const gate = createCodeGate(op, ["mutate"], policy("write", ["mutate"]));
      expect(await value(gate.dispatch(rpc("write")))).toEqual({
        ok: false,
        error: { category, message },
      });
      expect(gate.snapshot()[0]).toMatchObject({ outcome: "rejected", category });
      expect(markWrite).toHaveBeenCalledTimes(1);
      expect(gate.signal.aborted).toBe(false);
      expect(gate.status()).toBe("failed");
      gate.close("execution_finished");
      expect(gate.status()).toBe("failed");
    }
  });

  it("maps safety refusals and transport failures by mutation state", async () => {
    const safety = operation(async () => {
      throw new OdooSafetyError({ name: "write", level: "WRITE", model, description: "secret" });
    });
    const refused = createCodeGate(safety.op, ["mutate"], policy("write", ["mutate"]));
    expect((await value(refused.dispatch(rpc("write")))).error).toEqual({
      category: "write_not_approved",
      message: "Odoo operation was not approved",
    });
    expect(refused.signal.aborted).toBe(false);
    expect(refused.status()).toBe("failed");

    for (const error of [new OdooNetworkError("secret", new Error("x")), new Error("secret")]) {
      const read = operation(async () => {
        throw error;
      });
      const readGate = createCodeGate(read.op, ["read"], policy());
      expect((await value(readGate.dispatch(rpc()))).error).toEqual({
        category: "connection_failed",
        message: "Odoo connection failed",
      });
      expect(readGate.snapshot()[0]).toMatchObject({
        outcome: "unknown",
        category: "connection_failed",
      });
      expect(readGate.signal.aborted).toBe(false);
      expect(readGate.status()).toBe("failed");

      const write = operation(async () => {
        throw error;
      });
      const writeGate = createCodeGate(write.op, ["mutate"], policy("write", ["mutate"]));
      expect((await value(writeGate.dispatch(rpc("write")))).error).toEqual({
        category: "unknown_write",
        message: "Odoo write outcome is unknown; do not retry automatically",
      });
      expect(writeGate.signal.aborted).toBe(true);
      expect(write.abort).toHaveBeenCalledWith("unknown_write");
      expect(writeGate.status()).toBe("uncertain");
    }
  });

  it("reports closure messages for in-flight calls closed before or after settlement", async () => {
    for (const [method, effects, category, status] of [
      ["read", ["read"], "connection_failed", "failed"],
      ["write", ["mutate"], "unknown_write", "uncertain"],
    ] as const) {
      const settled = deferred<unknown>();
      const after = operation(() => settled.promise);
      const gate = createCodeGate(after.op, [...effects], policy(method, [...effects]));
      const executing = gate.dispatch(rpc(method));
      settled.promise.then(() => gate.close("execution_finished"));
      settled.resolve(true);
      expect(await value(executing)).toEqual({
        ok: false,
        error: { category, message: "Code Mode RPC dispatch is closed" },
      });
      expect(gate.snapshot()[0]).toMatchObject({ outcome: "unknown", category });
      expect(gate.status()).toBe(status);

      const hanging = deferred<unknown>();
      const before = operation(() => hanging.promise);
      const closing = createCodeGate(before.op, [...effects], policy(method, [...effects]));
      const pending = closing.dispatch(rpc(method));
      closing.close("execution_finished");
      expect(await value(pending)).toEqual({
        ok: false,
        error: {
          category,
          message:
            status === "uncertain"
              ? "Odoo write outcome is unknown; do not retry automatically"
              : "Code Mode RPC dispatch is closed",
        },
      });
      expect(closing.status()).toBe(status);
    }
  });

  it("closes once and treats only execution_finished as a clean close", async () => {
    const clean = operation();
    const finished = createCodeGate(clean.op, ["read"], policy());
    finished.close("execution_finished");
    finished.close("cancelled");
    expect(clean.abort).toHaveBeenCalledTimes(1);
    expect(clean.abort).toHaveBeenCalledWith("execution_finished");
    expect(finished.status()).toBe("success");
    expect(finished.signal.aborted).toBe(true);

    const dirty = operation();
    const cancelled = createCodeGate(dirty.op, ["read"], policy());
    cancelled.close("cancelled");
    expect(cancelled.status()).toBe("failed");
    dirty.controller.abort();
    expect(dirty.abort).toHaveBeenCalledTimes(1);

    const early = operation();
    early.controller.abort();
    const aborted = createCodeGate(early.op, ["read"], policy());
    expect(early.abort).toHaveBeenCalledWith("cancelled");
    expect((await value(aborted.dispatch(rpc()))).error).toEqual({
      category: "gate_closed",
      message: "Code Mode RPC dispatch is closed",
    });
    expect(aborted.status()).toBe("failed");
    expect(early.call).not.toHaveBeenCalled();
  });

  it("marks writes before dispatch and finalizes an active entry closed before dispatch", async () => {
    const order: string[] = [];
    const ok = operation(async () => {
      order.push("call");
      return true;
    });
    ok.markWrite.mockImplementation(() => order.push("markWrite"));
    const gate = createCodeGate(ok.op, ["mutate"], policy("write", ["mutate"]));
    expect((await value(gate.dispatch(rpc("write")))).ok).toBe(true);
    expect(order).toEqual(["markWrite", "call"]);
    gate.close("execution_finished");

    const host = operation(async () => true);
    host.markWrite.mockImplementation(() => host.controller.abort());
    const closing = createCodeGate(host.op, ["mutate"], policy("write", ["mutate"]));
    expect((await value(closing.dispatch(rpc("write")))).error).toEqual({
      category: "gate_closed",
      message: "Code Mode RPC dispatch is closed",
    });
    expect(closing.snapshot()[0]).toMatchObject({
      outcome: "not_dispatched",
      category: "gate_closed",
    });
    expect(closing.status()).toBe("failed");
  });
});
