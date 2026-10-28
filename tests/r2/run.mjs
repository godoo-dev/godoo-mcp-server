// R2 bindings have no S3 listener. Expose the subset used by obstore over local TLS.
import { Miniflare } from "miniflare";
import { build } from "esbuild";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temporary = mkdtempSync(join(tmpdir(), "godoo-r2-"));
let emulator;
try {
  const key = join(temporary, "key.pem"), cert = join(temporary, "cert.pem");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-subj", "/CN=localhost", "-addext", "basicConstraints=critical,CA:FALSE", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
    "-keyout", key, "-out", cert], { stdio: "ignore" });
  const bundled = await build({ entryPoints: ["tests/r2/s3.mjs"], bundle: true,
    format: "esm", write: false });
  emulator = new Miniflare({ host: "127.0.0.1", port: 0, https: true,
    httpsKey: readFileSync(key, "utf8"), httpsCert: readFileSync(cert, "utf8"),
    resourcePersistencePath: join(temporary, "r2"), enableDevRegistry: false, cf: false,
    logRequests: false, telemetry: { enabled: false },
    workers: [{ config: { name: "r2-test", compatibilityDate: "2026-10-23",
      manifest: { mainModule: "s3.mjs", modules: {
        "s3.mjs": { type: "esm", contents: bundled.outputFiles[0].text }
      } }, env: { BUCKET: { type: "r2", name: "private-exports" } }
    } }]
  });
  const endpoint = (await emulator.ready).origin;
  const child = spawn("uv", ["run", "--frozen", "pytest", "tests/test_exports.py", "-q"], {
    stdio: "inherit", env: { ...process.env, R2_TEST_ENDPOINT: endpoint,
      ODOO_EXPORT_PROVIDER: "r2", ODOO_EXPORT_BUCKET: "private-exports",
      ODOO_EXPORT_ENDPOINT: endpoint, AWS_ACCESS_KEY_ID: "test-access",
      AWS_SECRET_ACCESS_KEY: "test-secret", AWS_CA_BUNDLE: cert, SSL_CERT_FILE: cert,
      ODOO_EXPORT_URL_TTL_MINUTES: "60", ODOO_EXPORT_CLEANUP_GRACE_MINUTES: "30" }
  });
  process.exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", code => resolve(code ?? 1));
  });
} finally {
  await emulator?.dispose();
  rmSync(temporary, { recursive: true, force: true });
}
