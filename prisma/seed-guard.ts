// The seed deletes and rewrites the demo workspace's rows, and the tests and db:setup create and wipe
// databases, so none of them may be pointed at a hosted database by accident (a Supabase URL pasted
// into .env, a pooler host, a copied production string). This is the one local-database check they
// all use (the seed, scripts/local-db.ts, tests/test-db.ts). This file is kept free of imports so the
// check runs before anything touches the database client.

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

// True only for a postgres URL whose host is this machine. Anything else is refused: remote
// hosts, "localhost.example.com" look-alikes, malformed strings, and URLs that try to override
// the host with a ?host= or ?hostaddr= query parameter (the pg driver honors those).
export function isLocalDatabaseUrl(value: string | undefined): boolean {
  if (!value) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") return false;
  if (url.searchParams.has("host") || url.searchParams.has("hostaddr")) return false;
  return LOCAL_HOSTS.includes(url.hostname);
}

// Both connection strings must be local: DATABASE_URL is what the seed writes through, DIRECT_URL
// is what Prisma's own tooling (`prisma db seed`) loads, and either one pointing at a hosted
// database is a mistake worth stopping for. The message never includes the URL (it holds a password).
export function assertLocalDatabases(env: Record<string, string | undefined> = process.env): void {
  for (const name of ["DATABASE_URL", "DIRECT_URL"]) {
    if (!isLocalDatabaseUrl(env[name])) {
      throw new Error(
        `Refusing to seed: ${name} is missing or does not point at localhost, 127.0.0.1 or ::1. The demo seed only runs against a local database.`,
      );
    }
  }
}
