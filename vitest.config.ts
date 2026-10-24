import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** Unit tests with no database and no key. The `@/` alias mirrors apps/web/tsconfig.json for the web app's pure modules. */
export default defineConfig({
  resolve: {
    alias: [{ find: /^@\//, replacement: fileURLToPath(new URL("./apps/web/src/", import.meta.url)) }],
  },
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    environment: "node",
    passWithNoTests: true,
  },
});
