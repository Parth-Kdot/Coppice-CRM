import { execSync } from "node:child_process";
import { Client } from "pg";

// Gets a local or CI database ready: creates it if needed, applies migrations as the owner role,
// and gives the app_user role (created by the tenant_rls migration, with no password) the password
// from the app's connection string. Never runs against anything but localhost; Supabase is set
// up by hand.
//
//   npm run db:setup        sets up the dev database from .env (scripts/db-setup.ts)
//   tests/global-setup.ts   uses it for the test database

const LOCAL_HOSTS = ["localhost", "127.0.0.1"];

export async function setupLocalDatabase({ ownerUrl, appUrl }: { ownerUrl: string; appUrl: string }) {
  const owner = new URL(ownerUrl);
  const app = new URL(appUrl);
  for (const url of [owner, app]) {
    if (!LOCAL_HOSTS.includes(url.hostname)) {
      throw new Error(`Refusing to set up ${url.hostname}; this script only touches a local database.`);
    }
  }
  if (app.username !== "app_user") {
    throw new Error("DATABASE_URL must log in as app_user, so row-level security applies to the app.");
  }

  const database = owner.pathname.slice(1);
  const server = new URL(ownerUrl);
  server.pathname = "/postgres";
  const client = new Client({ connectionString: server.toString() });
  await client.connect();
  try {
    const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [database]);
    if (rowCount === 0) await client.query(`CREATE DATABASE ${client.escapeIdentifier(database)}`);

    // "pipe" keeps the output quiet when it works, but puts Prisma's message in the error when it fails.
    execSync("npx prisma migrate deploy", { env: { ...process.env, DIRECT_URL: ownerUrl }, stdio: "pipe" });

    const password = decodeURIComponent(app.password);
    await client.query(`ALTER ROLE app_user WITH LOGIN PASSWORD ${client.escapeLiteral(password)}`);
  } finally {
    await client.end();
  }
}
