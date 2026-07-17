import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/ai.ts", "src/langchain.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  minify: false,
  target: "es2022",
  // peer dependency は bundle しない(利用側の版を使わせる)。
  external: ["ai", "@langchain/core", "zod"],
});
