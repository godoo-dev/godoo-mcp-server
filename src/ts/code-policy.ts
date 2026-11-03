import {
  OdooAccessError,
  OdooAuthError,
  OdooMissingError,
  OdooNetworkError,
  OdooProtocolError,
  OdooRpcError,
  OdooSafetyError,
} from "@godoo-dev/client";
import { EFFECTS, type Effect, resolveRpcEffects } from "@godoo-dev/client/effects";
import { z } from "zod";
import { CODE_RPC_LIMITS, type CodePort } from "./code-contract.js";
import { codeJsonDepth } from "./code-json.js";
import type { Operation } from "./types.js";

const name = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[a-zA-Z_][a-zA-Z0-9_.]*$/);
const effects = z.array(z.enum(EFFECTS)).max(EFFECTS.length);
const manifest = z
  .object({
    schemaVersion: z.literal(1),
    source: z.string().min(1).max(1024),
    declarations: z.array(z.object({ model: name, method: name, effects }).strict()).max(10000),
  })
  .strict();
const grant = z
  .object({
    model: name,
    method: name,
    effects,
    maxCalls: z.number().int().min(1).max(CODE_RPC_LIMITS.attempts).optional(),
    args: z.array(z.unknown()).optional(),
    kwargs: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
const policySchema = z
  .object({
    schemaVersion: z.literal(1),
    targets: z
      .array(
        z
          .object({
            url: z.string().min(1).max(2048),
            database: z.string().min(1).max(256),
            uids: z.array(z.number().int().positive()).min(1).max(10000),
            effective: manifest,
            addons: z.array(manifest).max(100).optional(),
            grants: z.array(grant).max(10000),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
const requestSchema = z
  .object({
    model: name,
    method: name,
    args: z.array(z.unknown()),
    kwargs: z.record(z.string(), z.unknown()),
  })
  .strict();

type Policy = z.infer<typeof policySchema>;
type Grant = z.infer<typeof grant>;
export interface CodeLedgerEntry {
  id: number;
  model: string;
  method: string;
  effects: readonly Effect[];
  outcome: "acknowledged" | "rejected" | "policy_refused" | "not_dispatched" | "unknown";
  category?: string;
}
export interface CodeGate extends CodePort {
  snapshot(): CodeLedgerEntry[];
  status(): "success" | "failed" | "uncertain";
}

const encoder = new TextEncoder();
function bytes(value: string): number {
  return encoder.encode(value).byteLength;
}
function failure(category: string, message: string): string {
  return JSON.stringify({ ok: false, error: { category, message } });
}
function targetUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return;
    // Preserve the configured base path. Do not treat another installation on the same origin as equal.
    return url.href.replace(/\/+$/, "");
  } catch {
    return;
  }
}
function readPolicy(input: unknown): Policy | undefined {
  try {
    const encoded = typeof input === "string" ? input : JSON.stringify(input);
    if (
      !encoded ||
      encoded.length > CODE_RPC_LIMITS.policyBytes ||
      bytes(encoded) > CODE_RPC_LIMITS.policyBytes
    )
      return;
    const parsed = policySchema.safeParse(JSON.parse(encoded));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return;
  }
}
/** JSON equality ignores object key ordering; array order and all values remain significant. */
function sameJson(left: unknown, right: unknown): boolean {
  const pending: [unknown, unknown][] = [[left, right]];
  while (pending.length) {
    const pair = pending.pop();
    if (!pair) break;
    const [a, b] = pair;
    if (a === b) continue;
    if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const entries = Object.entries(a);
    if (entries.length !== Object.keys(b).length) return false;
    for (const [key, value] of entries) {
      if (!Object.hasOwn(b, key)) return false;
      pending.push([value, (b as Record<string, unknown>)[key]]);
    }
  }
  return true;
}

function contains(ceiling: readonly Effect[], actual: readonly Effect[]): boolean {
  return actual.every((effect) => ceiling.includes(effect));
}
function effectful(effects: readonly Effect[]): boolean {
  return effects.some((effect) => effect !== "read");
}
function definiteRejection(error: unknown): boolean {
  return (
    error instanceof OdooRpcError &&
    !(error instanceof OdooNetworkError) &&
    !(error instanceof OdooProtocolError)
  );
}
function errorCategory(error: unknown): string {
  if (error instanceof OdooAccessError) return "access_denied";
  if (error instanceof OdooAuthError) return "auth_failed";
  if (error instanceof OdooMissingError) return "missing_record";
  return "odoo_rejected";
}

/**
 * Bind one execution to host-trusted policy and an already authenticated caller.
 * policyOverride is an embedding-host input, never a code_execute argument.
 */
export function createCodeGate(
  operation: Operation,
  requestedEffects: readonly Effect[],
  policyOverride?: unknown,
): CodeGate {
  const policy = readPolicy(policyOverride ?? operation.runtime.config.ODOO_CODE_POLICY);
  const url = targetUrl(operation.creds.url);
  const uid = operation.client.getSession()?.uid;
  const candidates = policy?.targets.filter(
    (target) =>
      url !== undefined &&
      targetUrl(target.url) === url &&
      target.database === operation.creds.database &&
      target.uids.includes(uid ?? -1),
  );
  // Ambiguous duplicate target entries must not select the most permissive policy.
  const target = candidates?.length === 1 ? candidates[0] : undefined;
  const requestedValid =
    Array.isArray(requestedEffects) && requestedEffects.every((effect) => EFFECTS.includes(effect));
  const callerEffects = requestedValid ? Object.freeze([...requestedEffects]) : [];
  const entries: CodeLedgerEntry[] = [];
  const used = new Map<Grant, number>();
  const stopped = new AbortController();
  const signal = AbortSignal.any([operation.signal, stopped.signal]);
  let closed = false;
  let failed = false;
  let uncertain = false;
  let resultBytes = 0;
  let argumentBytes = 0;
  type Pending = { entry: CodeLedgerEntry; dispatched: boolean; mutating: boolean };
  let active: Pending | undefined;
  const queued: { pending: Pending; resolve: (admitted: boolean) => void }[] = [];

  function close(reason: string): void {
    if (closed) return;
    closed = true;
    if (reason !== "execution_finished") failed = true;
    if (active?.dispatched) {
      active.entry.outcome = "unknown";
      active.entry.category = active.mutating ? "unknown_write" : "connection_failed";
      if (active.mutating) uncertain = true;
      failed = true;
    } else if (active?.entry.outcome === "not_dispatched") {
      active.entry.category = "gate_closed";
      failed = true;
    }
    for (const item of queued) {
      item.pending.entry.category = "gate_closed";
      item.resolve(false);
      failed = true;
    }
    queued.length = 0;
    stopped.abort(reason);
    // The embedding transport must combine this execution cancellation with the request signal.
    operation.abort?.(reason);
    operation.signal.removeEventListener("abort", onAbort);
  }
  const onAbort = () => close("cancelled");
  operation.signal.addEventListener("abort", onAbort, { once: true });
  if (operation.signal.aborted) onAbort();

  return {
    signal,
    close,
    snapshot: () => entries.map((entry) => ({ ...entry, effects: [...entry.effects] })),
    status: () => (uncertain ? "uncertain" : failed ? "failed" : "success"),
    async dispatch(encoded) {
      if (entries.length >= CODE_RPC_LIMITS.attempts) {
        close("rpc_limit");
        return failure("rpc_limit", "Code Mode RPC attempt limit exceeded");
      }
      const entry: CodeLedgerEntry = {
        id: entries.length + 1,
        model: "",
        method: "",
        effects: [],
        outcome: "not_dispatched",
      };
      entries.push(entry);
      const refuse = (category: string, message: string, policyRefusal = false) => {
        failed = true;
        entry.outcome = policyRefusal ? "policy_refused" : "not_dispatched";
        entry.category = category;
        return failure(category, message);
      };
      if (closed || signal.aborted)
        return refuse("gate_closed", "Code Mode RPC dispatch is closed");
      argumentBytes += typeof encoded === "string" ? bytes(encoded) : 0;
      if (
        typeof encoded !== "string" ||
        encoded.length > CODE_RPC_LIMITS.argumentBytes ||
        bytes(encoded) > CODE_RPC_LIMITS.argumentBytes ||
        argumentBytes > CODE_RPC_LIMITS.totalArgumentBytes
      ) {
        close("argument_limit");
        return refuse("argument_limit", "Code Mode RPC arguments exceed the size limit");
      }
      let request: z.infer<typeof requestSchema>;
      try {
        if (!codeJsonDepth(encoded)) throw new Error("Invalid JSON depth");
        request = requestSchema.parse(JSON.parse(encoded));
        if (
          Object.hasOwn(request.kwargs, "context") &&
          (request.kwargs.context === null ||
            typeof request.kwargs.context !== "object" ||
            Array.isArray(request.kwargs.context))
        )
          throw new Error("Invalid context");
      } catch {
        return refuse("invalid_rpc", "Invalid Code Mode model RPC request");
      }
      entry.model = request.model;
      entry.method = request.method;
      entry.effects = resolveRpcEffects(
        request.model,
        request.method,
        target ? { effective: target.effective, addons: target.addons } : {},
      );
      const matching = target?.grants.find(
        (candidate) =>
          candidate.model === request.model &&
          candidate.method === request.method &&
          contains(candidate.effects, entry.effects) &&
          (used.get(candidate) ?? 0) < (candidate.maxCalls ?? CODE_RPC_LIMITS.attempts) &&
          (candidate.args === undefined || sameJson(candidate.args, request.args)) &&
          (candidate.kwargs === undefined || sameJson(candidate.kwargs, request.kwargs)),
      );
      if (!requestedValid || !contains(callerEffects, entry.effects) || !matching)
        return refuse(
          "policy_denied",
          "Host policy does not authorize this Odoo RPC and its effects",
          true,
        );
      const pending = { entry, dispatched: false, mutating: effectful(entry.effects) };
      // Reserve this exact grant when admitting the attempt, including queued work.
      // Guest Promise.all is supported, while actual transport dispatch stays serial.
      used.set(matching, (used.get(matching) ?? 0) + 1);
      if (active) {
        const admitted = await new Promise<boolean>((resolve) => queued.push({ pending, resolve }));
        // close() finalized queued entries synchronously. Do not mutate them after handback.
        if (!admitted || closed || signal.aborted)
          return failure("gate_closed", "Code Mode RPC dispatch is closed");
      } else active = pending;
      let abortListener: (() => void) | undefined;
      try {
        signal.throwIfAborted();
        // Policy and arguments are detached snapshots; this grant was reserved on admission.
        if (pending.mutating) operation.markWrite();
        pending.dispatched = true;
        const cancelled = new Promise<never>((_resolve, reject) => {
          abortListener = () => reject(new Error("Execution cancelled"));
          signal.addEventListener("abort", abortListener, { once: true });
          if (signal.aborted) abortListener();
        });
        const value = await Promise.race([
          operation.client.call(request.model, request.method, request.args, request.kwargs),
          cancelled,
        ]);
        if (closed)
          return failure(entry.category ?? "gate_closed", "Code Mode RPC dispatch is closed");
        // Odoo has acknowledged the RPC. Delivery/serialization failures cannot undo that fact.
        pending.dispatched = false;
        entry.outcome = "acknowledged";
        let envelope: string;
        try {
          envelope = JSON.stringify({ ok: true, value });
        } catch {
          entry.category = "result_serialization";
          failed = true;
          return failure("result_serialization", "Odoo RPC result could not be serialized");
        }
        const size = bytes(envelope);
        resultBytes += size;
        if (size > CODE_RPC_LIMITS.resultBytes || resultBytes > CODE_RPC_LIMITS.totalResultBytes) {
          entry.category = "result_limit";
          close("result_limit");
          return failure("result_limit", "Code Mode RPC results exceed the size limit");
        }
        return envelope;
      } catch (error) {
        failed = true;
        if (closed)
          return failure(
            entry.category ?? "gate_closed",
            uncertain
              ? "Odoo write outcome is unknown; do not retry automatically"
              : "Code Mode RPC dispatch is closed",
          );
        pending.dispatched = false;
        if (error instanceof OdooSafetyError) {
          entry.outcome = "not_dispatched";
          entry.category = "write_not_approved";
          return failure("write_not_approved", "Odoo operation was not approved");
        }
        if (definiteRejection(error)) {
          entry.outcome = "rejected";
          entry.category = errorCategory(error);
          return failure(
            entry.category,
            entry.category === "access_denied" ? "Odoo access denied" : "Odoo rejected the request",
          );
        }
        entry.outcome = "unknown";
        entry.category = pending.mutating ? "unknown_write" : "connection_failed";
        if (pending.mutating) {
          uncertain = true;
          close("unknown_write");
        }
        return failure(
          entry.category,
          pending.mutating
            ? "Odoo write outcome is unknown; do not retry automatically"
            : "Odoo connection failed",
        );
      } finally {
        if (abortListener) signal.removeEventListener("abort", abortListener);
        if (active === pending) {
          active = undefined;
          if (!closed) {
            const next = queued.shift();
            if (next) {
              // Reserve the slot before waking the continuation so fresh callers cannot jump FIFO.
              active = next.pending;
              next.resolve(true);
            }
          }
        }
      }
    },
  };
}
