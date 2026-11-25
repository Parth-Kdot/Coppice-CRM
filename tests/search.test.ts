import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { searchCompanies } from "@/app/(app)/[workspaceId]/search-actions";
import { day } from "@/lib/dates";
import { prisma, withTenant, type Tenant } from "@/lib/db";
import { nameKey } from "@/lib/duplicates";
import { asUser } from "./helpers/next-request";
import { resetAndSeed } from "./helpers/seed";

// The palette's company search, as a real server action against the real database (app_user, so
// row-level security applies). Only Next.js's request APIs are swapped.
vi.mock("next/headers", () => import("./helpers/next-request"));

const OWNER: Tenant = { userId: "ownerA", workspaceId: "a" };
const OTHER: Tenant = { userId: "ownerB", workspaceId: "b" };

type Row = { name: string; industry?: string; website?: string; archived?: boolean };
let serial = 0;
async function seed(tenant: Tenant, rows: Row[]) {
  await withTenant(tenant, (tx) =>
    tx.company.createMany({
      data: rows.map((r) => ({
        id: `${tenant.workspaceId}-s${String(serial++).padStart(5, "0")}`,
        workspaceId: tenant.workspaceId,
        name: r.name,
        nameKey: nameKey(r.name),
        industry: r.industry ?? null,
        website: r.website ?? null,
        archivedAt: r.archived ? new Date() : null,
      })),
    }),
  );
}

const search = async (userId: string, workspaceId: string, text: string) => {
  const result = await asUser(userId, () => searchCompanies(workspaceId, text));
  if (!result.ok) throw new Error(result.error);
  return result.data;
};

beforeEach(resetAndSeed);

afterAll(async () => {
  await prisma.$disconnect();
});

describe("company search ranks in the database, before the limit", () => {
  it("finds names that start with the text even behind 60 industry matches that sort first", async () => {
    // "Acme ..." sorts before "Stark ..." and every one of them matches "st" on its industry.
    await seed(OWNER, [
      ...Array.from({ length: 60 }, (_, i) => ({ name: `Acme Health ${i}`, industry: "Testing" })),
      { name: "Stark Industries" },
      { name: "Stark Labs" },
      { name: "Northstar Freight" },
    ]);
    const found = await search("ownerA", "a", "st");
    expect(found).toHaveLength(8);
    expect(found.slice(0, 3).map((f) => [f.name, f.matchedOn])).toEqual([
      ["Stark Industries", "name"],
      ["Stark Labs", "name"],
      // Then names that contain the text, then website and industry matches.
      ["Northstar Freight", "name"],
    ]);
    expect(found.slice(3).every((f) => f.matchedOn === "industry")).toBe(true);
  });

  it("orders numbers the way people read them", async () => {
    await seed(OWNER, [{ name: "Stark 100" }, { name: "Stark 10" }, { name: "Stark 9" }, { name: "Stark 1000" }]);
    expect((await search("ownerA", "a", "stark")).map((f) => f.name)).toEqual(["Stark 9", "Stark 10", "Stark 100", "Stark 1000"]);
  });

  it("says which field matched, and skips archived companies", async () => {
    await seed(OWNER, [{ name: "Globex", website: "https://quantum-sponsors.example" }, { name: "Initech", industry: "Quantum computing" }, { name: "Quantum Gone", archived: true }]);
    expect((await search("ownerA", "a", "quantum")).map((f) => [f.name, f.matchedOn])).toEqual([
      ["Globex", "website"],
      ["Initech", "industry"],
    ]);
  });

  it("treats % and _ as text, not wildcards", async () => {
    await seed(OWNER, [{ name: "100% Juice" }, { name: "1000 Lakes" }]);
    expect((await search("ownerA", "a", "100%")).map((f) => f.name)).toEqual(["100% Juice"]);
  });

  it("gives a non-member nothing, and never another workspace's companies", async () => {
    await seed(OWNER, [{ name: "Stark Industries" }]);
    await seed(OTHER, [{ name: "Stark Other" }]);
    expect(await asUser("ownerB", () => searchCompanies("a", "stark"))).toEqual({ ok: false, error: "Workspace not found." });
    expect((await search("ownerB", "b", "stark")).map((f) => f.name)).toEqual(["Stark Other"]);
    expect((await search("officerA", "a", "stark")).map((f) => f.name)).toEqual(["Stark Industries"]);
  });

  it("returns nothing for empty text", async () => {
    expect(await search("ownerA", "a", "   ")).toEqual([]);
  });
});

describe("company search counts follow-up days on the database clock", () => {
  it("gives days overdue and the due date from the database, even when Node's clock is years off", async () => {
    await seed(OWNER, [{ name: "Stark Past" }, { name: "Stark Today" }, { name: "Stark Ahead" }, { name: "Stark None" }]);
    // Follow-ups set from the database clock: 3 days ago, now, and 2 days ahead.
    await withTenant(OWNER, async (tx) => {
      await tx.$executeRaw`UPDATE "Company" SET "nextFollowUpAt" = now() - interval '3 days' WHERE "workspaceId" = 'a' AND name = 'Stark Past'`;
      await tx.$executeRaw`UPDATE "Company" SET "nextFollowUpAt" = now() WHERE "workspaceId" = 'a' AND name = 'Stark Today'`;
      await tx.$executeRaw`UPDATE "Company" SET "nextFollowUpAt" = now() + interval '2 days' WHERE "workspaceId" = 'a' AND name = 'Stark Ahead'`;
    });
    const stored = await withTenant(OWNER, (tx) => tx.company.findMany({ where: { workspaceId: "a", name: { startsWith: "Stark" } }, select: { name: true, nextFollowUpAt: true } }));
    const dueOn = (name: string) => {
      const at = stored.find((c) => c.name === name)?.nextFollowUpAt;
      return at ? day(at) : null;
    };

    // Only Date is faked, so the database connection keeps working while Node thinks it is 2031.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2031-06-01T12:00:00Z"));
    let found;
    try {
      found = await search("ownerA", "a", "stark");
    } finally {
      vi.useRealTimers();
    }
    expect(found.map((f) => [f.name, f.days, f.dueOn])).toEqual([
      ["Stark Ahead", -2, dueOn("Stark Ahead")],
      ["Stark None", null, null],
      ["Stark Past", 3, dueOn("Stark Past")],
      ["Stark Today", 0, dueOn("Stark Today")],
    ]);
  });
});
