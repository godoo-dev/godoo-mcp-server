import guest from "godoo:code-guest";
import wasm from "godoo:wasm";
import type { QuickJSSyncVariant } from "@jitl/quickjs-ffi-types";
import variant from "@jitl/quickjs-wasmfile-release-sync";
import {
  newQuickJSWASMModuleFromVariant,
  newVariant,
  type QuickJSContext,
  type QuickJSDeferredPromise,
  type QuickJSRuntime,
} from "quickjs-emscripten-core";
import { CODE_LIMITS, type CodePort, type ExecutionResult } from "./code-contract.js";
import { codeJsonDepth } from "./code-json.js";

export { CODE_LIMITS, type CodePort, type ExecutionResult } from "./code-contract.js";

// Module scope deliberately spans handler instances, including native Worker requests.
let admitted = 0;
let compiled: Promise<WebAssembly.Module> | undefined;
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
interface Settlement {
  active: boolean;
  response?: string;
  failed?: boolean;
}
// Late transport callbacks must not retain a WASM context, promise or executor closure.
function dispatch(port: CodePort, encoded: string, settlement: Settlement): void {
  let pending: Promise<string>;
  try {
    pending = port.dispatch(encoded);
  } catch {
    settlement.failed = true;
    return;
  }
  pending
    .then(
      (response) => {
        if (settlement.active) settlement.response = response;
      },
      () => {
        if (settlement.active) settlement.failed = true;
      },
    )
    .catch(() => undefined);
}

export async function executeCode(
  program: string,
  uid: number,
  port: CodePort,
  cpuClock: () => number = Date.now,
): Promise<ExecutionResult> {
  const started = Date.now();
  const logs: string[] = [];
  let runtime: QuickJSRuntime | undefined;
  let vm: QuickJSContext | undefined;
  let memory: WebAssembly.Memory | undefined;
  let fuelExports:
    | { __godoo_set_fuel(value: number): void; __godoo_get_fuel(): number }
    | undefined;
  let exhausted = false;
  let terminal = "";
  let held = false;
  let burst = 0;
  let cpu = 0;
  let logBytes = 0;
  let attempts = 0;
  let burstInterrupts = 0;
  let interrupts = 0;
  const pending = new Set<{ promise: QuickJSDeferredPromise; settlement: Settlement }>();
  let outcome: { ok: boolean; result?: unknown; error?: string } = {
    ok: false,
    error: "sandbox_failed",
  };
  const stop = (reason: string) => {
    terminal ||= reason;
    port.close(reason);
  };
  const onAbort = () => stop("cancelled");
  // Every synchronous guest entry has its own fatal burst cap and a cumulative CPU cap.
  const enter = <T>(fn: () => T, allowance: number = CODE_LIMITS.burst_ms): T => {
    burst = cpuClock() + allowance;
    burstInterrupts = 0;
    const before = cpuClock();
    try {
      return fn();
    } finally {
      const elapsed = cpuClock() - before;
      cpu += elapsed;
      if (elapsed > allowance || cpu > CODE_LIMITS.cpu_ms) stop("cpu_limit");
    }
  };
  try {
    if (bytes(program) > CODE_LIMITS.source_bytes) throw new Error("source_limit");
    if (admitted >= CODE_LIMITS.concurrent_executions) throw new Error("sandbox_busy");
    admitted += 1;
    held = true;
    port.signal.throwIfAborted();
    port.signal.addEventListener("abort", onAbort, { once: true });
    compiled ??=
      wasm instanceof WebAssembly.Module ? Promise.resolve(wasm) : WebAssembly.compile(wasm);
    memory = new WebAssembly.Memory({ initial: 256, maximum: 512 });
    const binary = await compiled;
    const module = await newQuickJSWASMModuleFromVariant(
      newVariant(variant as unknown as QuickJSSyncVariant, {
        wasmMemory: memory,
        emscriptenModule: {
          wasmMemory: memory,
          instantiateWasm(imports, success) {
            const instance = new WebAssembly.Instance(binary, imports);
            fuelExports = instance.exports as typeof fuelExports;
            if (
              typeof fuelExports?.__godoo_set_fuel !== "function" ||
              typeof fuelExports.__godoo_get_fuel !== "function"
            )
              throw new Error("unmetered_engine");
            // One budget for setup, SDK initialization, every guest entry and pending job.
            fuelExports.__godoo_set_fuel(
              Math.min(fuelExports.__godoo_get_fuel(), CODE_LIMITS.wasm_fuel),
            );
            success(instance);
            return instance.exports;
          },
          ...{ print: () => undefined, printErr: () => undefined },
        },
      }),
    );
    port.signal.throwIfAborted();
    runtime = module.newRuntime();
    runtime.setMemoryLimit(CODE_LIMITS.heap_bytes);
    runtime.setMaxStackSize(CODE_LIMITS.stack_bytes);
    runtime.setInterruptHandler(() => {
      if (terminal || port.signal.aborted) return true;
      if (Date.now() - started > CODE_LIMITS.deadline_ms) stop("deadline");
      else if (
        ++burstInterrupts > 200 ||
        ++interrupts > 1000 ||
        cpuClock() > burst ||
        cpu > CODE_LIMITS.cpu_ms
      )
        stop("cpu_limit");
      return Boolean(terminal);
    });
    vm = runtime.newContext();
    const context = vm;
    const hostLog = context.newFunction("log", (value) => {
      const text = context.getString(value);
      logBytes += bytes(JSON.stringify(text)) + 1;
      if (logBytes > CODE_LIMITS.log_bytes || logs.length >= CODE_LIMITS.log_entries)
        stop("log_limit");
      else logs.push(text);
    });
    context.setProp(context.global, "__hostLog", hostLog);
    hostLog.dispose();
    const bridge = context.newFunction("rpc", (value) => {
      attempts += 1;
      if (attempts > 64) {
        stop("rpc_limit");
        return context.undefined;
      }
      const encoded = context.getString(value);
      if (bytes(encoded) > 256 * 1024) {
        stop("argument_limit");
        return context.undefined;
      }
      const item = { promise: context.newPromise(), settlement: { active: true } as Settlement };
      pending.add(item);
      // Settlement only queues strings. It never enters guest code from a host continuation.
      dispatch(port, encoded, item.settlement);
      return item.promise.handle;
    });
    context.setProp(context.global, "__hostCall", bridge);
    bridge.dispose();
    const evaluate = (source: string, allowance?: number) => {
      const result = enter(() => context.evalCode(source), allowance);
      if (result.error) {
        result.error.dispose();
        throw new Error(terminal || "guest_error");
      }
      result.value.dispose();
    };
    evaluate(
      `globalThis.__identity={uid:${uid}}; globalThis.console={log(){},warn(){},error(){},info(){},debug(){}};`,
    );
    evaluate(guest, 250);
    evaluate(
      `globalThis.__codeOutcome=undefined;(async()=>{try{const result=await(async()=>{${program}\n})();globalThis.__codeOutcome=JSON.stringify({ok:true,result:result===undefined?null:result});}catch(e){globalThis.__codeOutcome=JSON.stringify({ok:false,error:"guest_error"});}})()`,
    );
    for (;;) {
      if (port.signal.aborted || Date.now() - started > CODE_LIMITS.deadline_ms) stop("deadline");
      if (terminal) throw new Error(terminal);
      for (const item of pending) {
        if (item.settlement.failed) throw new Error("bridge_failed");
        if (item.settlement.response === undefined) continue;
        const handle = context.newString(item.settlement.response);
        try {
          item.promise.resolve(handle);
        } finally {
          handle.dispose();
          item.promise.dispose();
          pending.delete(item);
        }
      }
      const jobs = enter(() => runtime?.executePendingJobs(20));
      if (jobs?.error) {
        jobs.error.dispose();
        throw new Error(terminal || "guest_error");
      }
      const value = enter(() => context.evalCode("globalThis.__codeOutcome"));
      if (value.error) {
        value.error.dispose();
        throw new Error(terminal || "guest_error");
      }
      let encoded: string | undefined;
      try {
        const kind = context.typeof(value.value);
        if (kind !== "undefined" && kind !== "string") throw new Error("guest_error");
        if (kind === "string") encoded = context.getString(value.value);
      } finally {
        value.value.dispose();
      }
      if (terminal) throw new Error(terminal);
      if (encoded !== undefined) {
        if (typeof encoded !== "string" || bytes(encoded) > CODE_LIMITS.final_bytes)
          throw new Error("final_limit");
        if (!codeJsonDepth(encoded)) throw new Error("final_structure_limit");
        const parsed = JSON.parse(encoded);
        outcome =
          parsed?.ok === true
            ? { ok: true, result: parsed.result }
            : { ok: false, error: "guest_error" };
        break;
      }
      // Yield to HTTP, cancellation and siblings even during a promise-job storm.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  } catch (error) {
    exhausted = fuelExports?.__godoo_get_fuel() === 0;
    const category = error instanceof Error ? error.message : "sandbox_failed";
    outcome = {
      ok: false,
      error: exhausted ? "fuel_limit" : /^[a-z_]+$/.test(category) ? category : "sandbox_failed",
    };
  } finally {
    port.signal.removeEventListener("abort", onAbort);
    port.close(terminal || "execution_finished");
    const dispose = (fn: () => void) => {
      try {
        fn();
      } catch {
        outcome = { ok: false, error: exhausted ? "fuel_limit" : "sandbox_cleanup_failed" };
      }
    };
    for (const item of pending) {
      item.settlement.active = false;
      delete item.settlement.response;
      dispose(() => item.promise.dispose());
    }
    pending.clear();
    dispose(() => vm?.dispose());
    dispose(() => runtime?.dispose());
    if (held) admitted -= 1;
  }
  return {
    ...outcome,
    logs,
    elapsed_ms: Date.now() - started,
    wasm_bytes: memory?.buffer.byteLength ?? 0,
  };
}
