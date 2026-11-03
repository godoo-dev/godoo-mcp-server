import { cleanupExpired } from "./artifacts.js";
import { executeCode } from "./code-engine.js";
import { createHandler } from "./server.js";
import { createR2Storage, createStorage, type R2BucketLike } from "./storage.js";
import type { Config, Runtime } from "./types.js";

export interface WorkerEnv {
  [key: string]: unknown;
  EXPORTS?: R2BucketLike;
}
function runtime(env: WorkerEnv): Runtime {
  const config: Config = Object.fromEntries(
    Object.entries(env).filter((item): item is [string, string] => typeof item[1] === "string"),
  );
  const result: Runtime = {
    config,
    executeCode,
    log: (event) => console.log(JSON.stringify(event)),
  };
  if (env.EXPORTS && (!config.ODOO_EXPORT_PROVIDER || config.ODOO_EXPORT_PROVIDER === "r2")) {
    config.ODOO_EXPORT_PROVIDER ||= "r2";
    // R2 binding accesses objects; scoped S3 credentials sign external download capabilities.
    try {
      const signer = createStorage(config);
      result.storage = createR2Storage(env.EXPORTS, signer);
    } catch {
      result.log?.({ event: "export_storage_unavailable" });
    }
  }
  return result;
}
export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    try {
      return await createHandler(runtime(env)).fetch(request);
    } catch {
      return Response.json({ error: "Request failed" }, { status: 500 });
    }
  },
  async scheduled(_controller: unknown, env: WorkerEnv): Promise<void> {
    await cleanupExpired(runtime(env));
  },
};
