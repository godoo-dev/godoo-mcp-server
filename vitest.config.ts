import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [{
    name: "bundled-guidance",
    enforce: "pre",
    transform(code, id) {
      if (id.endsWith(".md")) return `export default ${JSON.stringify(code)};`;
    },
  }],
  test: { include: ["tests/ts/**/*.test.ts"], testTimeout: 30000, hookTimeout: 30000 },
});
