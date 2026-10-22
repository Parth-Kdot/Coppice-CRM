import "dotenv/config";
import { setupLocalDatabase } from "./local-db";

// `npm run db:setup`: get the dev database from .env ready (run once after `docker compose up -d db`,
// and again after pulling new migrations).
async function main() {
  const ownerUrl = process.env.DIRECT_URL;
  const appUrl = process.env.DATABASE_URL;
  if (!ownerUrl || !appUrl) throw new Error("DIRECT_URL and DATABASE_URL must be set. Copy .env.example to .env.");
  await setupLocalDatabase({ ownerUrl, appUrl });
  console.log("Local database ready.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
