import { execFileSync } from "node:child_process";
import "dotenv/config";
import pg from "pg";

/**
 * Creates a throwaway schema inside DIRECT_URL's database and applies the real migrations
 * to it. Returns the env a Prisma client needs to use it, plus a teardown that drops it.
 * Your actual tables are never touched.
 */
export async function createTestSchema(schema: string) {
  const direct = process.env.DIRECT_URL;
  if (!direct) throw new Error("DIRECT_URL is required to create a test schema");
  if (!/^[a-z0-9_]+$/.test(schema)) throw new Error("invalid schema name");

  const url = new URL(direct);
  url.searchParams.set("schema", schema);

  const admin = new pg.Client({ connectionString: direct });
  await admin.connect();
  await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.query(`CREATE SCHEMA "${schema}"`);

  try {
    execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
      stdio: "pipe",
      shell: true,
      env: { ...process.env, DIRECT_URL: url.toString() },
    });
  } catch (err) {
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
    throw err;
  }

  return {
    env: { DATABASE_URL: direct, DATABASE_SCHEMA: schema },
    drop: async () => {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    },
  };
}
