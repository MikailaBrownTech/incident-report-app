import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * The raw, UNSCOPED client. Only files inside src/server/db may import it (ESLint
 * enforces this); everything else goes through `scopedDb()` or `root.ts`.
 */
const globalForPrisma = globalThis as unknown as { crypt_prisma?: PrismaClient };

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  // DATABASE_SCHEMA is only set by the DB test harness (throwaway schema per run).
  const schema = process.env.DATABASE_SCHEMA;
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }, schema ? { schema } : undefined),
  });
}

export const prisma: PrismaClient = globalForPrisma.crypt_prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.crypt_prisma = prisma;
