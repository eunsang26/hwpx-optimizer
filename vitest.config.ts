import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    conditions: ["development"]
  },
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts", "scripts/cli-portable/**/*.test.ts"],
    environment: "node"
  }
});
