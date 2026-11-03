import { mkdir, readFile, writeFile } from "node:fs/promises";
import { build } from "esbuild";
import { codeAssets } from "./code-assets.mjs";
import { meteredWasm } from "./meter-wasm.mjs";

const metadata = JSON.parse(await readFile("package.json", "utf8"));
await mkdir("dist", { recursive: true });
const common = {
  bundle: true,
  format: "esm",
  target: "es2024",
  sourcemap: true,
  loader: { ".md": "text", ".wasm": "binary" },
  define: { __VERSION__: JSON.stringify(metadata.version) },
  legalComments: "linked",
};
const nodeBanner =
  "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);";
for (const [name, entry] of Object.entries({
  index: "server",
  node: "node",
  worker: "worker",
  "code-node": "code-node",
  "code-node-isolate": "code-node-isolate",
})) {
  const worker = name === "worker";
  const node = name !== "index" && !worker;
  await build({
    ...common,
    entryPoints: [`src/ts/${entry}.ts`],
    outfile: `dist/${name}.mjs`,
    platform: node ? "node" : "browser",
    ...(node
      ? { banner: { js: `${name === "node" ? "#!/usr/bin/env node\n" : ""}${nodeBanner}` } }
      : {
          conditions: worker ? ["workerd", "worker", "browser"] : ["browser"],
          mainFields: ["browser", "module", "main"],
        }),
    plugins: [await codeAssets(worker)],
  });
}
const metered = await meteredWasm();
await writeFile("dist/quickjs.wasm", metered.bytes);
await writeFile("dist/quickjs-metering.json", `${JSON.stringify(metered.manifest)}\n`);
const codeLicenses = [];
for (const dependency of [
  "@jitl/quickjs-wasmfile-release-sync",
  "quickjs-emscripten-core",
  "@ungap/structured-clone",
  "@ungap/url-search-params",
  "@godoo-dev/client",
  "@godoo-dev/introspection",
]) {
  const license = await readFile(`node_modules/${dependency}/LICENSE`, "utf8");
  codeLicenses.push(`${dependency}\n\n${license}`);
}
await writeFile("dist/code-LICENSES.txt", `${codeLicenses.join("\n\n---\n\n")}\n`);
await writeFile("dist/version.json", `${JSON.stringify({ version: metadata.version })}\n`);
