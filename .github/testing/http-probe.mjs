import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: { command: { type: "string" }, evidence: { type: "string" }, cwd: { type: "string" } },
});
assert(values.command && values.evidence, "--command and --evidence are required");
await mkdir(values.evidence, { recursive: true });
const listener = createServer();
listener.listen(0, "127.0.0.1");
await once(listener, "listening");
const port = listener.address().port;
await new Promise((done) => listener.close(done));
const environment = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) => !key.startsWith("ODOO_") && !key.startsWith("MCP_") && key !== "DEBUG",
  ),
);
const child = spawn(values.command, {
  shell: true,
  detached: true,
  cwd: values.cwd || process.cwd(),
  env: { ...environment, HOST: "127.0.0.1", PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
child.stdout.on("data", (chunk) => {
  logs += chunk;
});
child.stderr.on("data", (chunk) => {
  logs += chunk;
});
const observations = [];
const base = `http://127.0.0.1:${port}`;
try {
  const deadline = Date.now() + 30000;
  while (true) {
    assert(child.exitCode === null, `Server exited: ${logs}`);
    try {
      const response = await fetch(`${base}/healthz`);
      assert.deepEqual(await response.json(), { status: "ok" });
      break;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await new Promise((done) => setTimeout(done, 50));
    }
  }
  async function request(method = "tools/list", params = {}, options = {}) {
    const requestId = crypto.randomUUID();
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": options.version || "2026-07-28",
      "MCP-Method": options.method || method,
      "X-Request-ID": requestId,
    };
    if (params.name || params.uri) headers["MCP-Name"] = options.name || params.name || params.uri;
    if (options.creds !== false)
      Object.assign(headers, {
        "X-Odoo-Url": "http://127.0.0.1:1",
        "X-Odoo-Database": "probe",
        "X-Odoo-Username": "probe",
        "X-Odoo-Password": "probe",
      });
    const bodyParams = { ...params };
    if (options.metadata !== false)
      bodyParams._meta = {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientCapabilities": {},
      };
    const response = await fetch(`${base}/mcp`, {
      method: options.verb || "POST",
      headers,
      ...(options.verb === "GET"
        ? {}
        : {
            body:
              options.raw || JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: bodyParams }),
          }),
      signal: AbortSignal.timeout(10000),
    });
    const text = await response.text();
    const value = text
      ? JSON.parse(
          text
            .split(/\r?\n/)
            .find((line) => line.startsWith("data:"))
            ?.slice(5) || text,
        )
      : null;
    observations.push({
      method,
      status: response.status,
      headers: Object.fromEntries(response.headers),
      value,
    });
    assert(!response.headers.has("mcp-session-id"));
    if (response.status !== 401) assert.equal(response.headers.get("x-request-id"), requestId);
    return [response.status, value];
  }
  const contracts = JSON.parse(
    await readFile(new URL("../../src/ts/tool-contracts.json", import.meta.url), "utf8"),
  );
  for (let index = 0; index < 2; index++) {
    const [status, value] = await request();
    assert.equal(status, 200);
    assert.equal(value.result.tools.length, Object.keys(contracts).length);
    for (const tool of value.result.tools) {
      assert.deepEqual(tool.inputSchema, contracts[tool.name].inputSchema);
      assert.deepEqual(tool.outputSchema, contracts[tool.name].outputSchema);
      assert.deepEqual(tool.annotations, contracts[tool.name].annotations);
    }
  }
  const [, discovered] = await request("server/discover");
  assert.deepEqual(discovered.result.supportedVersions, ["2026-07-28"]);
  const [, index] = await request("resources/read", { uri: "skill://index.json" });
  for (const topic of JSON.parse(index.result.contents[0].text).topics) {
    const [, resource] = await request("resources/read", { uri: topic.url });
    const [, tool] = await request("tools/call", {
      name: "guidance_get",
      arguments: { path: topic.path },
    });
    assert.equal(tool.result.content[0].text, resource.result.contents[0].text);
    assert(tool.result.content[0].text.length > 100);
  }
  assert.equal((await request("tools/list", {}, { creds: false }))[0], 401);
  assert.equal((await request("tools/list", {}, { method: "resources/list" }))[0], 400);
  assert.equal((await request("tools/list", {}, { metadata: false }))[0], 400);
  assert.equal((await request("tools/list", {}, { raw: "{" }))[1].error.code, -32700);
  assert.equal((await request("tools/list", {}, { version: "2024-11-05" }))[0], 400);
  assert.equal((await request("tools/list", {}, { verb: "GET" }))[0], 405);
  const [, invalid] = await request("tools/call", {
    name: "model_call",
    arguments: { model: "res.partner", method: "search", kwargs: { context: [] } },
  });
  assert.equal(invalid.result.isError, true);
  console.log(`HTTP acceptance passed (${observations.length} requests)`);
} finally {
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    /* Already exited. */
  }
  const exit = once(child, "exit");
  const timer = setTimeout(() => {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      /* Already exited. */
    }
  }, 6000);
  timer.unref();
  await exit;
  clearTimeout(timer);
  await writeFile(resolve(values.evidence, "server.log"), logs);
  await writeFile(
    resolve(values.evidence, "http.json"),
    `${JSON.stringify(observations, null, 2)}\n`,
  );
}
