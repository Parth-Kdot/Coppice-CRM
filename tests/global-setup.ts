import "dotenv/config";
import { setupLocalDatabase } from "../scripts/local-db";
import { testDatabaseUrls } from "./test-db";

// Runs once before all test files: create and migrate the test database, set app_user's password.
export default async function setup() {
  await setupLocalDatabase(testDatabaseUrls());
}
