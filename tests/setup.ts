import "dotenv/config";
import { testDatabaseUrls } from "./test-db";

// Runs in each test worker before any test imports lib/db. The app's Prisma client then
// connects to the test database as app_user, so row-level security applies in tests too.
process.env.DATABASE_URL = testDatabaseUrls().appUrl;

// lib/auth.ts refuses to load without these. CI has no real keys, and tests never talk to
// Google, so placeholders are enough. Real values from .env are kept when present.
process.env.BETTER_AUTH_SECRET ??= "test-secret-at-least-32-characters-long";
process.env.GOOGLE_CLIENT_ID ??= "test-google-client-id";
process.env.GOOGLE_CLIENT_SECRET ??= "test-google-client-secret";
