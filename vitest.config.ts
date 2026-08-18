import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // The CLI entry point is exercised end to end through a subprocess, which
      // the in-process coverage provider cannot see.
      exclude: ["src/cli.ts", "src/types.ts"],
      reporter: ["text-summary", "json-summary"],
      thresholds: { lines: 95, functions: 95, branches: 87, statements: 95 },
    },
  },
});
