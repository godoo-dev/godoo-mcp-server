import { mkdir, readFile, writeFile } from "node:fs/promises";
import { build } from "esbuild";

const metadata = JSON.parse(await readFile("package.json", "utf8"));
await mkdir("dist", { recursive: true });
const common = {
  bundle: true,
  format: "esm",
  target: "es2024",
  sourcemap: true,
  loader: { ".md": "text" },
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
});
await build({
  ...common,
  entryPoints: ["src/ts/node.ts"],
  outfile: "dist/node.mjs",
  platform: "node",
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
});
await writeFile("dist/version.json", `${JSON.stringify({ version: metadata.version })}\n`);
