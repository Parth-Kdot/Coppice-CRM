// Tests use their own database (boilerpitch_test) next to the dev one, so running them
// never wipes the data you are clicking around with. Same users as .env: the owner role for
// migrations (DIRECT_URL) and app_user for the app (DATABASE_URL).
function toTestDatabase(name: "DATABASE_URL" | "DIRECT_URL"): string {
  const base = process.env[name];
  if (!base) throw new Error(`${name} is not set. Copy .env.example to .env.`);
  const url = new URL(base);
  // Tests delete rows freely, so refuse to run against anything but a local or CI database.
  if (!["localhost", "127.0.0.1"].includes(url.hostname)) {
    throw new Error(`Refusing to run tests against ${url.hostname}; tests only use a local database.`);
  }
  url.pathname = "/boilerpitch_test";
  return url.toString();
}

export function testDatabaseUrls() {
  return { appUrl: toTestDatabase("DATABASE_URL"), ownerUrl: toTestDatabase("DIRECT_URL") };
}
