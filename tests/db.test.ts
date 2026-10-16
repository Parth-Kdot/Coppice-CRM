import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";

// Milestone 0 check: the app's shared client can reach the real Postgres database.
// Raw SQL is allowed in tests (rule 1.11); there are no tables to query yet.
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
