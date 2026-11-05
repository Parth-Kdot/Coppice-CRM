// `npm run db:seed` (also `npx prisma db seed`): fill the local database with a demo workspace.
// See prisma/seed-demo.ts for what it creates and README.md for how to use it.
import "dotenv/config";
import { assertLocalDatabases } from "./seed-guard";

async function main() {
  // First thing, before the database client is even loaded.
  assertLocalDatabases();
  const { seedDemo } = await import("./seed-demo");
  const { prisma } = await import("@/lib/db");
  try {
    const result = await seedDemo({ ownerEmail: process.env.SEED_OWNER_EMAIL });
    console.log(`Demo workspace ready: http://localhost:3000/${result.workspaceId}`);
    console.log(result.counts);
    console.log(result.ownerNote);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
