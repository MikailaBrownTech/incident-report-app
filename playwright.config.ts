import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";
import { BASE_URL } from "./e2e/env";

export default defineConfig({
  testDir: "e2e",
  outputDir: "e2e/.results",
  // Starts the production server and a throwaway DB schema; see e2e/global-setup.ts.
  globalSetup: "./e2e/global-setup.ts",
  // Auth tests share one throwaway database schema, so keep them in order.
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  // Per-action limits so a bad locator fails in seconds with its name, not at the test timeout.
  use: { baseURL: BASE_URL, trace: "retain-on-failure", actionTimeout: 10_000, navigationTimeout: 30_000 },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
