import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingExcludes: { '/*': ['./tests/**/*', './coverage/**/*', './data/**/*', './.env*', './.git/**/*', './.local-drivers/**/*', './android/teach-observer/build/**/*'] },
  distDir: process.env.TEACH_ISOLATED_BUILD === '1' ? '.next-teach-acceptance' : '.next',
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
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
