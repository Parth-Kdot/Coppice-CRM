import "dotenv/config";
import { testDatabaseUrl } from "./test-db";

// Runs in each test worker before any test imports lib/db, so the app's Prisma client
// connects to the test database.
process.env.DATABASE_URL = testDatabaseUrl();
