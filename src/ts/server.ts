import {
  OdooAccessError,
  OdooAuthError,
  OdooClient,
  OdooNetworkError,
  OdooProtocolError,
  OdooSafetyError,
  OdooTimeoutError,
  OdooValidationError,
} from "@godoo-dev/client";
import { createMcpHandler, McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import debug from "debug";
import { z } from "zod";
import { getModelEntryFromCache } from "./catalog.js";
import { PublicError } from "./errors.js";
import { guidance, guidanceIndex } from "./guidance.js";
import contracts from "./tool-contracts.json" with { type: "json" };
import { registerTools, validateModelCallArguments } from "./tools.js";
import type { Credentials, Operation, Runtime, ToolArguments, ToolHandler } from "./types.js";

declare const __VERSION__: string;
export const version = typeof __VERSION__ === "undefined" ? "0.3.0" : __VERSION__;
export const protocolVersion = "2026-07-28";
// Client debug messages can contain RPC arguments. Only bounded server-owned events are emitted.
debug.disable();

export function resolveCredentials(request: Request, runtime: Runtime): Credentials | string[] {
  const config = runtime.config;
  const url = request.headers.get("x-odoo-url") || config.ODOO_URL;
  const database = request.headers.get("x-odoo-database") || config.ODOO_DATABASE || config.ODOO_DB;
  const username =
    request.headers.get("x-odoo-username") || config.ODOO_USERNAME || config.ODOO_USER;
  const password = request.headers.get("x-odoo-password") || config.ODOO_PASSWORD;
  const missing: string[] = [];
  if (!url) missing.push("X-Odoo-Url (or ODOO_URL)");
  if (!database) missing.push("X-Odoo-Database (or ODOO_DATABASE / ODOO_DB)");
  if (!username) missing.push("X-Odoo-Username (or ODOO_USERNAME / ODOO_USER)");
  if (!password) missing.push("X-Odoo-Password (or ODOO_PASSWORD)");
  return url && database && username && password ? { url, database, username, password } : missing;
}

function safeError(
  error: unknown,
  state: { authenticated: boolean; write: boolean; network: boolean },
) {
  if (error instanceof PublicError) return error;
  if (!state.authenticated && state.network)
    return new PublicError("Odoo authentication connection failed", "auth_connection_failed");
  if (error instanceof OdooAuthError)
    return new PublicError("Odoo authentication failed", "auth_failed");
  if (error instanceof OdooAccessError)
    return new PublicError("Odoo access denied", "access_denied");
  if (error instanceof OdooSafetyError)
    return new PublicError("Odoo operation was not approved", "write_not_approved");
  if (error instanceof OdooValidationError)
    return new PublicError("Odoo rejected the request", "odoo_rejected");
  if (state.write)
    return new PublicError(
      "Odoo write outcome is unknown; do not retry automatically",
      "unknown_write",
    );
  if (
    state.network ||
    error instanceof OdooNetworkError ||
    error instanceof OdooTimeoutError ||
    error instanceof OdooProtocolError
  )
    return new PublicError("Odoo connection failed", "connection_failed");
  return new PublicError("Odoo request failed", "odoo_error");
}

export async function withOperation<T>(
  request: Request,
  runtime: Runtime,
  creds: Credentials,
  callback: (operation: Operation) => Promise<T>,
): Promise<T> {
  const state = { authenticated: false, write: false, network: false };
  const timeout = Number(runtime.config.ODOO_REQUEST_TIMEOUT_MS || 120000);
  const signal = AbortSignal.any([
    request.signal,
    AbortSignal.timeout(Number.isFinite(timeout) && timeout > 0 ? timeout : 120000),
  ]);
  const upstream: typeof fetch = async (input, init) => {
    try {
      return await (runtime.fetch || fetch)(input, { ...init, signal });
    } catch (error) {
      state.network = true;
      throw error;
    }
  };
  const client = new OdooClient({ ...creds, fetch: upstream });
  try {
    await client.authenticate();
    state.authenticated = true;
    const value = await callback({
      client,
      creds,
      runtime: { ...runtime, signal },
      signal,
      markWrite: () => {
        state.write = true;
      },
    });
    signal.throwIfAborted();
    return value;
  } catch (error) {
    throw safeError(error, state);
  } finally {
    client.logout();
  }
}

function result(value: unknown) {
  const structuredContent =
    typeof value === "string" ? { result: value } : (value as Record<string, unknown>);
  return {
    content: [
      { type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value) },
    ],
    structuredContent,
  };
}

export function createHandler(runtime: Runtime) {
  const handler = createMcpHandler(
    ({ requestInfo }) => {
      if (!requestInfo) throw new Error("HTTP request is required");
      const request = requestInfo;
      const credentials = resolveCredentials(request, runtime);
      if (Array.isArray(credentials)) throw new Error("Credentials are required");
      const server = new McpServer(
        { name: "godoo-mcp-server", version },
        {
          supportedProtocolVersions: [protocolVersion],
          capabilities: {
            tools: { listChanged: false },
            resources: { subscribe: false, listChanged: false },
          },
          instructions:
            "Stateless MCP server for Odoo. Read guidance_get (or skill://odoo/SKILL.md) for Odoo workflows. Use users_whoami to confirm identity and target URL. Database and host names do not establish an environment's safety. Guidance and tool annotations do not grant write permission or override client policy. Per-request credentials via X-Odoo-* headers.",
        },
      );
      const register = (name: string, shape: Record<string, unknown>, callback: ToolHandler) => {
        const contract = contracts[name as keyof typeof contracts];
        const object = z.object(shape as Record<string, z.ZodType>).strict();
        // Retain the Python server's advertised JSON contracts while Zod validates execution.
        const schema = {
          "~standard": {
            ...object["~standard"],
            jsonSchema: { input: () => contract.inputSchema, output: () => contract.inputSchema },
          },
        };
        server.registerTool(
          name,
          {
            title: contract.title,
            description: contract.description,
            inputSchema: schema,
            outputSchema: {
              "~standard": {
                version: 1,
                vendor: "godoo-contract",
                validate: (value: unknown) => ({ value }),
                jsonSchema: {
                  input: () => contract.outputSchema,
                  output: () => contract.outputSchema,
                },
              },
            },
            annotations: contract.annotations,
          },
          async (args) => {
            const started = performance.now();
            const request_id = request.headers.get("x-request-id") || "unknown";
            runtime.log?.({ event: "tool_call_started", request_id, tool: name });
            let category = "success";
            try {
              if (name === "model_call") validateModelCallArguments(args as ToolArguments);
              const value =
                name === "guidance_get"
                  ? guidance.get(String((args as ToolArguments).path || "SKILL.md"))
                  : await withOperation(request, runtime, credentials, (operation) =>
                      callback(args as ToolArguments, operation),
                    );
              if (value === undefined)
                throw new PublicError(
                  "Unknown guidance path; use a path listed in the guidance index",
                );
              return result(value);
            } catch (error) {
              const safe =
                error instanceof PublicError
                  ? error
                  : new PublicError("Tool operation failed", "internal_error");
              category = safe.category;
              return { isError: true, content: [{ type: "text" as const, text: safe.message }] };
            } finally {
              runtime.log?.({
                event: "tool_call_finished",
                request_id,
                tool: name,
                outcome:
                  category === "success"
                    ? "success"
                    : category === "unknown_write"
                      ? "uncertain"
                      : "error",
                category,
                elapsed_ms: Math.round((performance.now() - started) * 100) / 100,
              });
            }
          },
        );
      };
      registerTools({ server, register, runtime });
      register("guidance_get", { path: z.string().default("SKILL.md") }, async () => "");
      server.registerResource(
        "Skill Discovery Index",
        "skill://index.json",
        { mimeType: "application/json" },
        async (uri) => ({
          contents: [
            { uri: uri.href, mimeType: "application/json", text: JSON.stringify(guidanceIndex()) },
          ],
        }),
      );
      server.registerResource(
        "Odoo Skill File",
        new ResourceTemplate("skill://odoo/{+path}", { list: undefined }),
        { mimeType: "text/markdown" },
        async (uri, variables) => {
          const path = String(variables.path);
          return {
            contents: [
              {
                uri: uri.href,
                mimeType: "text/markdown",
                text: guidance.get(path) || `# Not Found\n\nSkill file '${path}' not found.`,
              },
            ],
          };
        },
      );
      for (const kind of ["model", "action", "menu"] as const) {
        const variable = kind === "model" ? "name" : "id";
        server.registerResource(
          `Odoo ${kind[0].toUpperCase()}${kind.slice(1)}`,
          new ResourceTemplate(`odoo://${kind}/{${variable}}`, { list: undefined }),
          { mimeType: "application/json" },
          async (uri, variables) => {
            const id = String(variables[variable]);
            let value: unknown;
            if (kind === "model") {
              value = await withOperation(request, runtime, credentials, async ({ client }) => {
                const uid = client.getSession()?.uid;
                return uid ? getModelEntryFromCache(id, { ...credentials, uid }) : undefined;
              });
            }
            value ||=
              kind === "model"
                ? {
                    error: "model_not_found",
                    model: id,
                    hint: "call discovery_get_fields for current field metadata",
                  }
                : kind === "action"
                  ? {
                      error: "action_not_found",
                      id,
                      hint: "call action_list_actions to list actions, then use action_execute_action to run them",
                    }
                  : {
                      error: "menu_not_found",
                      id,
                      hint: "call discovery_list_menus tool to list menus",
                    };
            return {
              contents: [
                { uri: uri.href, mimeType: "application/json", text: JSON.stringify(value) },
              ],
            };
          },
        );
      }
      return server;
    },
    {
      legacy: "reject",
      responseMode: "sse",
      keepAliveMs: 15000,
      maxRequestBodySize: 150 * 1024 * 1024,
    },
  );
  return {
    close: () => handler.close(),
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      const supplied = request.headers.get("x-request-id") || "";
      const requestId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        supplied,
      )
        ? supplied.toLowerCase()
        : crypto.randomUUID();
      const headers = new Headers(request.headers);
      headers.set("x-request-id", requestId);
      const exchange = new AbortController();
      const signal = AbortSignal.any([request.signal, exchange.signal]);
      let response: Response;
      const credentials = resolveCredentials(request, runtime);
      if (url.pathname === "/healthz") response = Response.json({ status: "ok" });
      else if (Array.isArray(credentials))
        response = Response.json(
          { error: "missing_credentials", missing: credentials },
          { status: 401 },
        );
      else if (url.pathname === "/mcp/")
        response = new Response(null, { status: 307, headers: { location: "/mcp" } });
      else if (url.pathname !== "/mcp") response = new Response("Not Found", { status: 404 });
      else response = await handler.fetch(new Request(request, { headers, signal }));
      const responseHeaders = new Headers(response.headers);
      responseHeaders.set("x-request-id", requestId);
      const reader = response.body?.getReader();
      const body = reader
        ? new ReadableStream<Uint8Array>({
            async pull(controller) {
              try {
                const chunk = await reader.read();
                if (chunk.done) controller.close();
                else controller.enqueue(chunk.value);
              } catch (error) {
                controller.error(error);
              }
            },
            async cancel(reason) {
              // Workers can cancel the response stream without aborting the
              // incoming Request. Stop the same operation's upstream RPCs.
              exchange.abort(reason);
              await reader.cancel(reason).catch(() => undefined);
            },
          })
        : null;
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    },
  };
}
