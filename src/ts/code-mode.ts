import declarations from "godoo:sdk-declarations";
import { EFFECTS, type Effect } from "@godoo-dev/client/effects";
import { getSdkReference, SDK_REFERENCE } from "@godoo-dev/client/reference";
import { z } from "zod";
import { deliverArtifact } from "./artifacts.js";
import { CODE_LIMITS, CODE_RPC_LIMITS } from "./code-contract.js";
import { createCodeGate } from "./code-policy.js";
import { PublicError } from "./errors.js";
import type { Registration } from "./types.js";

const examples: Record<string, string> = {
  client: 'return await client.searchRead("res.partner", [], {fields:["id","name"],limit:5});',
  introspection:
    'const fields = await introspect.getFieldAttributes("res.partner"); return [...fields.entries()];',
  properties:
    'const scope = await client.properties.scope("project.task", "task_properties", {parentId:7}); const binding = scope.bind({estimate:{label:"Estimate",type:"float"}}); return await binding.read([42]);',
  accounting: "return await client.accounting.discoverCashAccounts();",
  cdc: 'const events=[]; for await (const event of client.cdc.getFeed("res.partner", {pageSize:20})) { events.push(event); if(events.length===20) break; } return events;',
};

export function codeReference(section = "index"): unknown {
  if (section === "index")
    return {
      ...SDK_REFERENCE,
      supplier_revision: "1ff88685b800f5d2e47bfb56d2f3dd7ef069df5d",
      globals: ["client", "sdk", "introspect", "introspection", "formatters", "console"],
      syntax:
        "Async JavaScript function body; use return for the final JSON value. No imports or TypeScript syntax.",
      limits: CODE_LIMITS,
      rpc_limits: CODE_RPC_LIMITS,
      declarations: Object.keys(declarations).sort(),
      declaration_usage: 'code_reference({section:"type/BoundClient"})',
      authorization:
        "Host policy and requested effects must both cover every actual RPC. Missing effective declarations resolve to unknown effects. No automatic replay; inspect the host ledger.",
    };
  if (section.startsWith("type/")) {
    const name = section.slice(5);
    if (!Object.hasOwn(declarations, name)) throw new PublicError("Unknown SDK declaration");
    return { revision: SDK_REFERENCE.revision, name, declaration: declarations[name] };
  }
  const reference = getSdkReference(section);
  if (!reference) throw new PublicError("Unknown SDK reference section");
  return {
    ...reference,
    example: examples[section],
    signatures: "Use type/<name> from the index for exact supplied SDK declarations.",
  };
}

export function registerCodeMode({ register }: Registration): void {
  register("code_reference", { section: z.string().max(160).default("index") }, async () => "");
  register(
    "code_execute",
    {
      code: z.string().max(CODE_LIMITS.source_bytes),
      effects: z
        .array(z.enum(EFFECTS as [Effect, ...Effect[]]))
        .max(7)
        .default(["read"]),
      max_return_bytes: z
        .number()
        .int()
        .min(0)
        .max(CODE_LIMITS.final_bytes)
        .nullable()
        .default(500),
    },
    async (args, operation) => {
      const gate = createCodeGate(operation, args.effects as Effect[]);
      if (!operation.runtime.executeCode) {
        gate.close("runtime_unavailable");
        return {
          status: "failed",
          error: "code_runtime_unavailable",
          ledger: gate.snapshot(),
          logs: [],
        };
      }
      const executed = await operation.runtime.executeCode(
        String(args.code),
        operation.client.getSession()?.uid ?? 0,
        gate,
      );
      const status = gate.status();
      const envelope: Record<string, unknown> = {
        status:
          status === "uncertain"
            ? status
            : !executed.ok || status === "failed"
              ? "failed"
              : "success",
        ...(executed.error ? { error: executed.error } : {}),
        ledger: gate.snapshot(),
        logs: executed.logs,
        elapsed_ms: executed.elapsed_ms,
      };
      if (!executed.ok) return envelope;
      // The host ledger is always inline. Only the completed program value is routed.
      let error = "result_serialization_failed";
      try {
        const content = new TextEncoder().encode(JSON.stringify(executed.result ?? null));
        const bound = args.max_return_bytes as number | null;
        if (bound === null || content.byteLength <= bound)
          return { ...envelope, result: executed.result ?? null };
        error = "result_delivery_failed";
        return {
          ...envelope,
          result: await deliverArtifact(
            content,
            { source: { tool: "code_execute" } },
            operation.runtime,
          ),
        };
      } catch {
        return {
          ...envelope,
          status: status === "uncertain" ? status : "failed",
          error,
        };
      }
    },
  );
}
