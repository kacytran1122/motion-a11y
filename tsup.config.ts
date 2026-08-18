import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
    sourcemap: true,
    target: "node18",
  },
  {
    entry: { cli: "src/cli.ts" },
    format: ["esm"],
    clean: false,
    target: "node18",
    // dist/cli.js sits next to dist/index.js, so "./index.js" resolves at
    // runtime. Leaving it external stops the whole engine being bundled twice.
    external: ["./index.js"],
  },
]);
