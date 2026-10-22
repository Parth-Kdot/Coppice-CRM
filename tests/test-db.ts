// Tests use their own database (boilerpitch_test) next to the dev one, so running them
// never wipes the data you are clicking around with.
export function testDatabaseUrl(): string {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL is not set. Copy .env.example to .env.");
  const url = new URL(base);
  // Tests delete rows freely, so refuse to run against anything but a local or CI database.
  if (!["localhost", "127.0.0.1"].includes(url.hostname)) {
    throw new Error(`Refusing to run tests against ${url.hostname}; tests only use a local database.`);
  }
  url.pathname = "/boilerpitch_test";
  return url.toString();
}
