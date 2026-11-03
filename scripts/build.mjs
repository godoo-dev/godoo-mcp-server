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
await build({
  ...common,
  entryPoints: ["src/ts/server.ts"],
  outfile: "dist/index.mjs",
  platform: "browser",
  conditions: ["browser"],
  mainFields: ["browser", "module", "main"],
  plugins: [await codeAssets()],
});
await build({
  ...common,
  entryPoints: ["src/ts/node.ts"],
  outfile: "dist/node.mjs",
  platform: "node",
  plugins: [await codeAssets()],
  banner: {
    js: "#!/usr/bin/env node\nimport { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
await build({
  ...common,
  entryPoints: ["src/ts/worker.ts"],
  outfile: "dist/worker.mjs",
  platform: "browser",
  conditions: ["workerd", "worker", "browser"],
  mainFields: ["browser", "module", "main"],
  plugins: [await codeAssets(true)],
});
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
for (const name of ["code-node", "code-node-isolate"]) {
  await build({
    ...common,
    entryPoints: [`src/ts/${name}.ts`],
    outfile: `dist/${name}.mjs`,
    platform: "node",
    plugins: [await codeAssets()],
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
  });
}
await writeFile("dist/version.json", `${JSON.stringify({ version: metadata.version })}\n`);
