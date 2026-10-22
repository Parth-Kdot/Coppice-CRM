import "dotenv/config";
import { execSync } from "node:child_process";
import { Client } from "pg";
import { testDatabaseUrl } from "./test-db";

// Runs once before all test files: create the test database if needed and apply migrations.
export default async function setup() {
  const testUrl = testDatabaseUrl();
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = 'boilerpitch_test'");
  if (rowCount === 0) await client.query("CREATE DATABASE boilerpitch_test");
  await client.end();

  execSync("npx prisma migrate deploy", { env: { ...process.env, DIRECT_URL: testUrl }, stdio: "ignore" });
}
