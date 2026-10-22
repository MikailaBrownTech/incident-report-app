import { execFileSync, spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { createTestSchema } from "../src/test/test-schema";
import { BASE_URL, PORT, SCHEMA } from "./env";

const NEXT = "node_modules/next/dist/bin/next";

async function waitForServer(url: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).status < 500) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server at ${url} did not start within ${timeoutMs}ms`);
}

/**
 * Throwaway DB schema + a PRODUCTION build served on its own port and build dir. We spawn
 * node directly (no shell/pnpm wrapper) so teardown can reliably stop it on Windows; with
 * Playwright's `webServer` the wrapper outlived the kill and the run never exited.
 * Set E2E_SKIP_BUILD=1 to reuse the last build when only tests changed.
 */
export default async function globalSetup() {
  await rm(".dev-outbox", { recursive: true, force: true });
  const schema = await createTestSchema(SCHEMA);

  const env = {
    ...process.env,
    NEXT_DIST_DIR: ".next-e2e",
    DATABASE_URL: process.env.DIRECT_URL ?? "",
    DATABASE_SCHEMA: SCHEMA,
    BETTER_AUTH_URL: BASE_URL,
    EMAIL_SERVER: "", // never send real email
    E2E_OUTBOX: "1", // write mail to .dev-outbox so tests can read links
  };

  if (!process.env.E2E_SKIP_BUILD) {
    try {
      execFileSync(process.execPath, [NEXT, "build"], { env, stdio: "pipe" });
    } catch (err) {
      await schema.drop();
      throw err;
    }
  }

  const server = spawn(process.execPath, [NEXT, "start", "--port", String(PORT)], { env, stdio: "inherit" });
  try {
    await waitForServer(BASE_URL, 60_000);
  } catch (err) {
    server.kill();
    await schema.drop();
    throw err;
  }

  return async () => {
    const exited = new Promise<void>((resolve) => server.once("exit", () => resolve()));
    server.kill();
    await Promise.race([exited, new Promise((r) => setTimeout(r, 5_000))]);
    await schema.drop();
  };
}
