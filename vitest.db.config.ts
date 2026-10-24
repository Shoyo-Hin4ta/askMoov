import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Tests that need the real database (Phase 5 onward). `npm run test:db`. Reads .env via node's --env-file in the npm script.
 * The `@/` alias mirrors apps/web/tsconfig.json so route handlers can be tested in place.
 */
export default defineConfig({
  resolve: {
    alias: [{ find: /^@\//, replacement: fileURLToPath(new URL("./apps/web/src/", import.meta.url)) }],
  },
  test: {
    include: ["packages/**/*.dbtest.ts", "apps/**/*.dbtest.ts"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
