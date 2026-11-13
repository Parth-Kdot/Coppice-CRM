import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";

// The app's shared client can reach the real Postgres database. Raw SQL is allowed in tests (the
// raw SQL allowlist).
describe("database connection", () => {
  afterAll(async () => {
    // Close the pool so Vitest can exit instead of waiting on open connections.
    await prisma.$disconnect();
  });

  it("runs a query against Postgres", async () => {
    const rows = await prisma.$queryRaw<{ ok: number }[]>`SELECT 1 AS ok`;
    expect(rows).toEqual([{ ok: 1 }]);
  });
});
