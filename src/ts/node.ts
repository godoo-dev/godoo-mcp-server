import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { cleanupExpired } from "./artifacts.js";
import { createNodeCodeExecutor } from "./code-node.js";
import { createHandler, version } from "./server.js";
import { createStorage } from "./storage.js";
import type { Runtime } from "./types.js";

if (process.argv.includes("--version")) {
  console.log(version);
} else {
  const config = { ...process.env };
  if (config.GOOGLE_SERVICE_ACCOUNT && !config.GOOGLE_SERVICE_ACCOUNT_KEY) {
    config.GOOGLE_SERVICE_ACCOUNT_KEY = await readFile(config.GOOGLE_SERVICE_ACCOUNT, "utf8");
  }
  const runtime: Runtime = {
    config,
    executeCode: createNodeCodeExecutor(),
    log: (event) => console.log(JSON.stringify(event)),
  };
  if (config.ODOO_EXPORT_PROVIDER) {
    try {
      if (["r2", "s3"].includes(config.ODOO_EXPORT_PROVIDER) && !config.AWS_ACCESS_KEY_ID) {
        runtime.storage = createStorage(config, fetch, defaultProvider());
      }
      runtime.storage ||= createStorage(config);
    } catch {
      // Inline tools remain usable; exports fail safely with a public storage error.
      runtime.log?.({ event: "export_storage_unavailable" });
    }
  }
  const handler = createHandler(runtime);
  const http = createServer(toNodeHandler(handler));
  http.requestTimeout = 0;
  http.listen(Number(config.PORT || 8000), config.HOST || "0.0.0.0");
  let sweeping = false;
  const sweep = async () => {
    if (!config.ODOO_EXPORT_PROVIDER || sweeping) return;
    sweeping = true;
    try {
      await cleanupExpired(runtime);
    } catch {
      runtime.log?.({ event: "export_cleanup_sweep_failed" });
    } finally {
      sweeping = false;
    }
  };
  void sweep();
  const interval = setInterval(() => {
    void sweep();
  }, 60000);
  interval.unref();
  const shutdown = () => {
    clearInterval(interval);
    http.close();
    void handler.close();
    setTimeout(() => {
      http.closeAllConnections();
      process.exit(0);
    }, 5000).unref();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
