import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["packages/sim/src/**"],
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 80 },
      reporter: ["text-summary", "text"],
    },
  },
});
