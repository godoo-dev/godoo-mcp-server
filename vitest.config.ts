// @ts-expect-error shared build-time asset preparation
import { codeInputs } from "./.github/build/code-assets.mjs";
import { meteredWasm } from "./.github/build/meter-wasm.mjs";
import { defineConfig } from "vitest/config";

const inputs = await codeInputs();
const wasm = await meteredWasm();

export default defineConfig({
  plugins: [{
    name: "code-assets",
    resolveId(id) { if(id.startsWith("godoo:")) return "\0"+id; if(id === "@jitl/quickjs-wasmfile-release-sync/wasm") return "\0godoo:wasm"; },
    async load(id) {
      if (id.startsWith("\0godoo:") && id !== "\0godoo:wasm") return `export default ${JSON.stringify(inputs[id.slice(1)])};`;
      if (id === "\0godoo:wasm") return `export default new Uint8Array(${JSON.stringify([...wasm.bytes])});`;
    },
  }, {
    name: "bundled-guidance",
    enforce: "pre",
    transform(code, id) {
      if (id.endsWith(".md")) return `export default ${JSON.stringify(code)};`;
    },
  }],
  test: { include: ["tests/ts/**/*.test.ts"], testTimeout: 30000, hookTimeout: 30000 },
});
