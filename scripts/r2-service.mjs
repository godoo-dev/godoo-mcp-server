import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

const temporary = await mkdtemp(join(tmpdir(), "godoo-acceptance-r2-"));
const cert = join(temporary, "cert.pem");
const key = join(temporary, "key.pem");
execFileSync(
  "openssl",
  [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "1",
    "-subj",
    "/CN=localhost",
    "-addext",
    "basicConstraints=critical,CA:FALSE",
    "-addext",
    "subjectAltName=DNS:localhost,IP:127.0.0.1",
    "-keyout",
    key,
    "-out",
    cert,
  ],
  { stdio: "ignore" },
);
const bundled = await build({
  entryPoints: ["tests/r2/s3.mjs"],
  bundle: true,
  format: "esm",
  write: false,
});
const emulator = new Miniflare({
  host: "127.0.0.1",
  port: 0,
  https: true,
  httpsKey: await readFile(key, "utf8"),
  httpsCert: await readFile(cert, "utf8"),
  workers: [
    {
      config: {
        name: "r2-acceptance",
        compatibilityDate: "2026-11-02",
        manifest: {
          mainModule: "s3.mjs",
          modules: { "s3.mjs": { type: "esm", contents: bundled.outputFiles[0].text } },
        },
        env: { BUCKET: { type: "r2", name: "private-exports" } },
      },
    },
  ],
  enableDevRegistry: false,
  logRequests: false,
  telemetry: { enabled: false },
  cf: false,
});
console.log(JSON.stringify({ endpoint: (await emulator.ready).origin, cert }));
let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await emulator.dispose();
  await rm(temporary, { recursive: true, force: true });
};
process.once("SIGTERM", () => {
  void stop();
});
process.once("SIGINT", () => {
  void stop();
});
