import { Worker } from "node:worker_threads";
import {
  CODE_LIMITS,
  CODE_RPC_LIMITS,
  type CodePort,
  type ExecutionResult,
} from "./code-contract.js";
import { codeJsonDepth } from "./code-json.js";

const CPU_LIMIT_MS = 1000;
const CPU_SAMPLE_MS = 20;
const encoder = new TextEncoder();
// Admission spans executor instances, initialization and worker termination.
let admitted = 0;
interface Reply {
  worker?: Worker;
  id: number;
  fail?: () => void;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  return (
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}
function boundedString(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length <= maximum &&
    encoder.encode(value).byteLength <= maximum
  );
}
function validResult(value: unknown): value is ExecutionResult {
  if (
    !record(value) ||
    Object.keys(value).some(
      (key) => !["ok", "result", "error", "logs", "elapsed_ms", "wasm_bytes"].includes(key),
    )
  )
    return false;
  if (
    typeof value.ok !== "boolean" ||
    !Array.isArray(value.logs) ||
    value.logs.length > CODE_LIMITS.log_entries ||
    !value.logs.every((log) => boundedString(log, CODE_LIMITS.log_bytes))
  )
    return false;
  if (
    !Number.isFinite(value.elapsed_ms) ||
    Number(value.elapsed_ms) < 0 ||
    Number(value.elapsed_ms) > 60000 ||
    !Number.isSafeInteger(value.wasm_bytes) ||
    Number(value.wasm_bytes) < 0 ||
    Number(value.wasm_bytes) > CODE_LIMITS.wasm_bytes
  )
    return false;
  if (
    value.error !== undefined &&
    (typeof value.error !== "string" || !/^[a-z_]{1,64}$/.test(value.error))
  )
    return false;
  try {
    const encoded = JSON.stringify(value.result ?? null);
    return (
      boundedString(encoded, CODE_LIMITS.final_bytes) &&
      codeJsonDepth(encoded) &&
      encoder.encode(JSON.stringify(value.logs)).byteLength <= CODE_LIMITS.log_bytes + 2
    );
  } catch {
    return false;
  }
}
// Late host transport settlements retain a clearable reply, never a live Worker closure.
function attachReply(pending: Promise<string>, reply: Reply): void {
  pending
    .then(
      (encoded) => {
        if (!reply.worker) return;
        if (!boundedString(encoded, CODE_RPC_LIMITS.resultBytes)) return reply.fail?.();
        try {
          reply.worker.postMessage({ kind: "response", id: reply.id, encoded });
        } catch {
          reply.fail?.();
        }
      },
      () => {
        if (!reply.worker) return;
        reply.fail?.();
      },
    )
    .catch(() => undefined);
}

/** Execute untrusted programs on fresh Node threads; credentials and policy stay on this thread. */
export function createNodeCodeExecutor(
  workerUrl = new URL("./code-node-isolate.mjs", import.meta.url),
) {
  return async (code: string, uid: number, port: CodePort): Promise<ExecutionResult> => {
    const started = Date.now();
    const failed = (error: string): ExecutionResult => ({
      ok: false,
      error,
      logs: [],
      elapsed_ms: Date.now() - started,
      wasm_bytes: 0,
    });
    let result = failed("sandbox_setup_failed");
    let held = false;
    let worker: Worker | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let sampler: ReturnType<typeof setInterval> | undefined;
    let onAbort: (() => void) | undefined;
    const replies = new Set<Reply>();
    let closed = false;
    const close = (reason: string) => {
      if (closed) return;
      closed = true;
      if (onAbort) port.signal.removeEventListener("abort", onAbort);
      for (const reply of replies) {
        reply.worker = undefined;
        reply.fail = undefined;
      }
      port.close(reason);
    };
    try {
      if (!boundedString(code, CODE_LIMITS.source_bytes) || !Number.isSafeInteger(uid) || uid <= 0)
        throw new Error("source_limit");
      if (port.signal.aborted) throw new Error("cancelled");
      if (admitted >= CODE_LIMITS.concurrent_executions) throw new Error("sandbox_busy");
      if (typeof Worker.prototype.cpuUsage !== "function") throw new Error("sandbox_unavailable");
      admitted += 1;
      held = true;
      worker = new Worker(workerUrl, {
        workerData: { code, uid },
        // Do not inherit credential-bearing environment or agent/test startup hooks.
        env: {},
        execArgv: [],
        resourceLimits: { maxOldGenerationSizeMb: 48, stackSizeMb: 2 },
      });
      const isolate = worker;
      result = await new Promise<ExecutionResult>((resolve) => {
        let settled = false;
        let sampling = false;
        let lastRpc = 0;
        const finish = (outcome: ExecutionResult) => {
          if (settled) return;
          settled = true;
          try {
            close(outcome.error ?? "execution_finished");
          } catch {
            outcome = failed("sandbox_failed");
          }
          resolve(outcome);
        };
        const invalid = () => finish(failed("bridge_failed"));
        onAbort = () => finish(failed("cancelled"));
        port.signal.addEventListener("abort", onAbort, { once: true });
        if (port.signal.aborted) onAbort();
        timer = setTimeout(() => finish(failed("deadline")), CODE_LIMITS.deadline_ms);
        isolate.on("message", (message: unknown) => {
          if (settled) return;
          if (!record(message)) return invalid();
          if (message.kind === "rpc") {
            if (
              closed ||
              !exactKeys(message, ["kind", "id", "encoded"]) ||
              message.id !== lastRpc + 1 ||
              lastRpc >= CODE_RPC_LIMITS.attempts ||
              !boundedString(message.encoded, CODE_RPC_LIMITS.argumentBytes)
            )
              return invalid();
            lastRpc += 1;
            const reply: Reply = { worker: isolate, id: lastRpc, fail: invalid };
            replies.add(reply);
            let pending: Promise<string>;
            try {
              pending = port.dispatch(message.encoded);
            } catch {
              return invalid();
            }
            attachReply(pending, reply);
          } else if (message.kind === "close") {
            if (
              closed ||
              !exactKeys(message, ["kind", "reason"]) ||
              typeof message.reason !== "string" ||
              !/^[a-z_]{1,64}$/.test(message.reason)
            )
              return invalid();
            // The engine has stopped guest execution. Preserve its final ledger before it tears down.
            // close() can abort the gate signal; this is not a caller cancellation.
            try {
              close(message.reason);
            } catch {
              invalid();
            }
          } else if (message.kind === "result") {
            if (!closed || !exactKeys(message, ["kind", "result"]) || !validResult(message.result))
              return invalid();
            finish(message.result);
          } else invalid();
        });
        isolate.on("error", () => finish(failed("sandbox_crashed")));
        isolate.on("exit", () => {
          if (!settled) finish(failed("sandbox_crashed"));
        });
        isolate.once("online", () => {
          sampler = setInterval(() => {
            if (settled || sampling) return;
            sampling = true;
            isolate
              .cpuUsage()
              .then(
                (usage) => {
                  if (!settled && usage.user + usage.system > CPU_LIMIT_MS * 1000)
                    finish(failed("cpu_limit"));
                },
                () => {
                  if (!settled && !closed) finish(failed("sandbox_failed"));
                },
              )
              .finally(() => {
                sampling = false;
              });
          }, CPU_SAMPLE_MS);
        });
      });
    } catch (error) {
      const category =
        error instanceof Error && /^[a-z_]{1,64}$/.test(error.message)
          ? error.message
          : "sandbox_setup_failed";
      result = failed(category);
      try {
        close(category);
      } catch {
        result = failed("sandbox_failed");
      }
    } finally {
      if (timer) clearTimeout(timer);
      if (sampler) clearInterval(sampler);
      replies.clear();
      if (worker) {
        // Keep the error listener until termination: an already queued OOM error
        // must not become an unhandled parent-thread EventEmitter error.
        try {
          await worker.terminate();
        } catch {
          result = failed("sandbox_shutdown_failed");
        } finally {
          worker.removeAllListeners();
        }
      }
      if (held) admitted -= 1;
    }
    return { ...result, elapsed_ms: Date.now() - started };
  };
}
