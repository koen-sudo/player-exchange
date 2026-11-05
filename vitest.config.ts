import { defineConfig } from "vitest/config";

// Unit and integration tests for all workspace packages (ADR 0003 closed).
// End-to-end tests live in apps/web/e2e and run with Playwright.
export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts"],
    environment: "node",
  },
});
