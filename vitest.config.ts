import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    // DB-backed suites are named *.db.test.ts and run via `pnpm test:db`.
    exclude: ["**/node_modules/**", "src/**/*.db.test.ts"],
  },
});
