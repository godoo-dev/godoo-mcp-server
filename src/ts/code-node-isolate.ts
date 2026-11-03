import { parentPort, workerData } from "node:worker_threads";
import { CODE_LIMITS, CODE_RPC_LIMITS, type CodePort } from "./code-contract.js";
import { executeCode } from "./code-engine.js";

if (!parentPort) throw new Error("Code Mode requires an isolated worker");
const channel = parentPort;
const stopped = new AbortController();
const pending = new Map<number, { resolve: (value: string) => void; reject: () => void }>();
let nextId = 0;
let closed = false;

function close(reason: string): void {
  if (closed) return;
  closed = true;
  channel.postMessage({ kind: "close", reason });
  stopped.abort(reason);
  for (const item of pending.values()) item.reject();
  pending.clear();
}
channel.on("message", (message: unknown) => {
  if (!message || typeof message !== "object" || Array.isArray(message))
    return close("bridge_failed");
  const response = message as Record<string, unknown>;
  if (
    response.kind !== "response" ||
    Object.keys(response).length !== 3 ||
    !["kind", "id", "encoded"].every((key) => Object.hasOwn(response, key)) ||
    !Number.isSafeInteger(response.id) ||
    typeof response.encoded !== "string" ||
    response.encoded.length > CODE_RPC_LIMITS.resultBytes ||
    new TextEncoder().encode(response.encoded).byteLength > CODE_RPC_LIMITS.resultBytes
  )
    return close("bridge_failed");
  const item = pending.get(response.id as number);
  if (!item || closed) return close("bridge_failed");
  pending.delete(response.id as number);
  item.resolve(response.encoded);
});

const port: CodePort = {
  signal: stopped.signal,
  close,
  dispatch(encoded) {
    if (
      closed ||
      nextId >= CODE_RPC_LIMITS.attempts ||
      typeof encoded !== "string" ||
      encoded.length > CODE_RPC_LIMITS.argumentBytes
    )
      return Promise.reject(new Error("Bridge closed"));
    const id = ++nextId;
    const response = new Promise<string>((resolve, reject) =>
      pending.set(id, { resolve, reject: () => reject(new Error("Bridge closed")) }),
    );
    channel.postMessage({ kind: "rpc", id, encoded });
    return response;
  },
};

try {
  const input = workerData as { code?: unknown; uid?: unknown };
  if (
    typeof input?.code !== "string" ||
    input.code.length > CODE_LIMITS.source_bytes ||
    !Number.isSafeInteger(input.uid) ||
    Number(input.uid) <= 0
  )
    throw new Error("Invalid isolated execution input");
  const result = await executeCode(input.code, Number(input.uid), port, () => {
    const usage = process.threadCpuUsage();
    return (usage.user + usage.system) / 1000;
  });
  channel.postMessage({ kind: "result", result });
} catch {
  close("sandbox_failed");
  channel.postMessage({
    kind: "result",
    result: { ok: false, error: "sandbox_failed", logs: [], elapsed_ms: 0, wasm_bytes: 0 },
  });
} finally {
  channel.removeAllListeners("message");
  channel.close();
}
