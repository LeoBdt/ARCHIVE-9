import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["{apps,packages}/*/src/**/*.test.ts"],
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      include: ["{apps,packages}/*/src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/main.ts"],
      thresholds: {
        "packages/core/src/**": { lines: 80, functions: 80, branches: 80, statements: 80 },
        "packages/ai/src/**": { lines: 80, functions: 80, branches: 80, statements: 80 },
      },
    },
  },
});
