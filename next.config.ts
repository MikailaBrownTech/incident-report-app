import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  // Lets CI/checks build without clobbering a running `next dev`.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // `page.dev.tsx` files (e.g. /dev/styleguide) are only treated as routes outside
  // production, so they are not compiled into production builds at all.
  pageExtensions: isProd ? ["tsx", "ts", "jsx", "js"] : ["dev.tsx", "tsx", "ts", "jsx", "js"],
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
