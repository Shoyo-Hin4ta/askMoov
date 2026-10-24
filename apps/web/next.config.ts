import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@ask-moov/shared", "@ask-moov/agent", "@ask-moov/db"],
  // libpg-query loads a .wasm file next to itself at runtime; bundling it rewrites that path to a virtual root
  serverExternalPackages: ["libpg-query"],
  /* config options here */
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
