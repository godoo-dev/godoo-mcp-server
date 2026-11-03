import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import ts from "typescript";
import { meteredWasm } from "./meter-wasm.mjs";

export async function codeInputs() {
  const guest = await build({
    entryPoints: ["src/ts/code-guest.ts"],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "es2022",
    legalComments: "inline",
  });
  const declarations = {};
  for (const name of ["client", "introspection"]) {
    const root = dirname(fileURLToPath(import.meta.resolve(`@godoo-dev/${name}/portable`)));
    const directories = name === "client" ? [root, dirname(root)] : [root];
    for (const directory of directories) {
      for (const file of await readdir(directory)) {
        if (!file.endsWith(".d.mts")) continue;
        if (name === "client" && directory !== root && file === "index.d.mts") continue;
        const source = await readFile(join(directory, file), "utf8");
        const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
        for (const statement of ast.statements) {
          if (!statement.name || !ts.isIdentifier(statement.name)) continue;
          const key = statement.name.text;
          // Prefer the credential-free portable client declarations over the network root.
          declarations[key] ??= statement.getFullText(ast).trim();
        }
      }
    }
  }
  return { "godoo:code-guest": guest.outputFiles[0].text, "godoo:sdk-declarations": declarations };
}

export async function codeAssets(worker = false) {
  const inputs = await codeInputs();
  const wasm = await meteredWasm();
  return {
    name: "code-assets",
    setup(builder) {
      builder.onResolve({ filter: /^godoo:wasm$/ }, () =>
        worker
          ? { path: "./quickjs.wasm", external: true }
          : { path: "quickjs.wasm", namespace: "metered" },
      );
      builder.onLoad({ filter: /.*/, namespace: "metered" }, () => ({
        contents: wasm.bytes,
        loader: "binary",
      }));
      builder.onResolve({ filter: /^godoo:/ }, ({ path }) => ({ path, namespace: "godoo" }));
      builder.onLoad({ filter: /.*/, namespace: "godoo" }, ({ path }) => ({
        contents: `export default ${JSON.stringify(inputs[path])};`,
        loader: "js",
      }));
      if (worker)
        builder.onResolve({ filter: /quickjs-wasmfile-release-sync\/wasm$/ }, () => ({
          path: "./quickjs.wasm",
          external: true,
        }));
    },
  };
}
