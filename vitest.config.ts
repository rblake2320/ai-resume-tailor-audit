import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: {
    alias: { "@": import.meta.dirname },
  },
  test: {
    // Route, component, and script tests could not run at all under the
    // previous lib-only pattern, so no regression test for an app/api or MCP
    // defect was even collectable.
    include: ["lib/**/*.test.ts", "app/**/*.test.ts", "components/**/*.test.ts", "scripts/**/*.test.ts"],
    environment: "node",
  },
});
