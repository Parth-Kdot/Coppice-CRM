// Runs before every test file. Vitest does not load .env on its own (Next.js does),
// so load it here to give tests the same DATABASE_URL the app uses locally.
import "dotenv/config";
