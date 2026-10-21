import { defineConfig, devices } from "@playwright/test";

const PORT = 3000;

export default defineConfig({
  testDir: "e2e",
  outputDir: "e2e/.results",
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Dev server: /dev/styleguide only exists outside production builds.
  webServer: {
    command: `pnpm exec next dev --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
