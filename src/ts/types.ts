import type { OdooClient } from "@godoo-dev/client";
import type { McpServer } from "@modelcontextprotocol/server";

export type Config = Record<string, string | undefined>;
export interface Credentials {
  url: string;
  database: string;
  username: string;
  password: string;
}
export interface StoredObject {
  key: string;
  lastModified: Date;
}
export interface ObjectStore {
  sign(key: string, expiresInSeconds: number, signal?: AbortSignal): Promise<string>;
  put(
    key: string,
    content: Uint8Array,
    metadata: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<void>;
  head(key: string, signal?: AbortSignal): Promise<StoredObject>;
  list(prefix: string, signal?: AbortSignal): AsyncIterable<StoredObject>;
  delete(key: string, signal?: AbortSignal): Promise<void>;
}
export interface Runtime {
  config: Config;
  storage?: ObjectStore;
  log?: (event: Record<string, unknown>) => void;
  fetch?: typeof fetch;
  now?: () => Date;
  signal?: AbortSignal;
}
export interface Operation {
  client: OdooClient;
  creds: Credentials;
  runtime: Runtime;
  signal: AbortSignal;
  /** Call immediately before the final mutating RPC, after all preflight. */
  markWrite(): void;
}
export type ToolArguments = Record<string, unknown>;
export type ToolHandler = (args: ToolArguments, operation: Operation) => Promise<unknown>;
export type RegisterTool = (
  name: string,
  schema: Record<string, unknown>,
  handler: ToolHandler,
) => void;
export interface Registration {
  server: McpServer;
  register: RegisterTool;
  runtime: Runtime;
}
