import { defineConfig } from "vitest/config";

export default defineConfig({
  // Lets tests import with the same "@/..." paths the app uses (read from tsconfig.json).
  resolve: { tsconfigPaths: true },
  test: {
    // Server-side code (database, auth) runs in Node, not a fake browser.
    environment: "node",
    // Database tests share one Postgres, so test files run one at a time
    // to keep them from changing each other's data mid-test.
    fileParallelism: false,
    globalSetup: ["./tests/global-setup.ts"],
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
  },
});
