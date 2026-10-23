import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { prisma } from "../src/server/db/client";
import { SeedMineError, seedMine, type MinePlan } from "../src/server/seed/mine";

const USAGE = "Usage: pnpm seed:mine --email <you@example.com> [--workspace <slug>] [--reset] [--yes]";

/** Host and database only; never the credentials. */
function databaseTarget(): string {
  try {
    const url = new URL(process.env.DATABASE_URL ?? "");
    const schema = process.env.DATABASE_SCHEMA ? `, schema ${process.env.DATABASE_SCHEMA}` : "";
    return `${url.host}${url.pathname}${schema}`;
  } catch {
    return "(unreadable DATABASE_URL)";
  }
}

async function ask(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    console.error("No terminal to ask for confirmation on; pass --yes to continue without a prompt.");
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim() === "yes";
  } finally {
    rl.close();
  }
}

async function main() {
  // pnpm forwards the "--" that separates script flags from its own
  const argv = process.argv.slice(2).filter((a, i) => !(a === "--" && i === 0));
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      email: { type: "string" },
      workspace: { type: "string" },
      reset: { type: "boolean", default: false },
      yes: { type: "boolean", default: false },
    },
  });
  if (!values.email) throw new SeedMineError(`--email is required.\n${USAGE}`);
  if (positionals.length > 1) throw new SeedMineError(`Unexpected arguments: ${positionals.join(" ")}\n${USAGE}`);
  // a bare word is shorthand for --workspace
  const workspace = values.workspace ?? positionals[0];

  const confirm = async (plan: MinePlan) => {
    console.log(
      `Workspace: ${plan.workspaceName} (${plan.workspaceSlug})${plan.createsWorkspace ? "  [will be created]" : ""}`,
    );
    console.log(`Database:  ${databaseTarget()}`);
    if (plan.mode === "reset") {
      console.log(`This will delete ${plan.resetCount} seeded incident(s) and their events, service links and roles.`);
      if (plan.resetKept) console.log(`${plan.resetKept} seeded incident(s) with a postmortem will be kept.`);
    }
    return values.yes ? true : ask("Type yes to continue: ");
  };

  const r = await seedMine(prisma, { email: values.email, workspace, reset: values.reset, confirm });

  if (r.cancelled) {
    console.log("Cancelled. Nothing was changed.");
    return;
  }
  if (values.reset) {
    console.log(
      `Deleted ${r.incidentsDeleted} seeded incident(s).${r.incidentsKept ? ` Kept ${r.incidentsKept} with a postmortem.` : ""}`,
    );
    return;
  }
  if (r.workspaceCreated) console.log(`Created workspace "${r.workspaceSlug}" with you as owner.`);
  console.log(`Services created:   ${r.servicesCreated}`);
  console.log(`Incidents created:  ${r.incidentsCreated}`);
  console.log(`Incidents skipped:  ${r.incidentsSkipped} (already seeded)`);
  console.log(`Events created:     ${r.eventsCreated}`);
  console.log(`Postmortems created: ${r.postmortemsCreated}`);
  console.log(`Action items created: ${r.actionItemsCreated}`);
  console.log(`Incident numbers:   ${r.numbers.length ? r.numbers.join(", ") : "none"}`);
  console.log(`Open: /app/${r.workspaceSlug}/incidents`);
}

main()
  .catch((err) => {
    if (err instanceof SeedMineError) console.error(err.message);
    else console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
