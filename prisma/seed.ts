import "dotenv/config";
import { prisma } from "../src/server/db/client";
import { DEMO_SLUG, seedDemo } from "../src/server/seed/demo";

/**
 * `npm run seed` (or `pnpm db:seed`): creates the demo workspace. Safe to run repeatedly.
 * Optional: set SEED_OWNER_EMAIL to an account you've already signed up with, to be added as its owner.
 */
async function main() {
  if (process.env.NODE_ENV === "production" && process.env.SEED_ALLOW_PRODUCTION !== "1") {
    throw new Error("Refusing to seed demo data with NODE_ENV=production (set SEED_ALLOW_PRODUCTION=1 to override).");
  }
  const result = await seedDemo(prisma);
  console.log(
    `Seeded workspace "${DEMO_SLUG}": ${result.createdIncidents} incidents created, ${result.skippedIncidents} already present.`,
  );
  console.log(`Open it at /app/${DEMO_SLUG}/incidents after signing in as a member.`);
  if (!process.env.SEED_OWNER_EMAIL) {
    console.log("Tip: set SEED_OWNER_EMAIL=you@example.com (an existing account) to be added as the owner.");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
