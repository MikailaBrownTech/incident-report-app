import { randomBytes } from "node:crypto";
import { createTestSchema } from "./test-schema";

/** Vitest global setup: a fresh random schema per `pnpm test:db` run, dropped afterwards. */
export default async function setup() {
  const { env, drop } = await createTestSchema(`test_${randomBytes(6).toString("hex")}`);
  Object.assign(process.env, env);
  return drop;
}
