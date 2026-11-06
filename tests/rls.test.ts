import { afterAll, beforeEach, describe, expect, it, test } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { prisma, withTenant, type Tenant } from "@/lib/db";
import { resetAndSeed } from "./helpers/seed";

// Row-level security, tested against the real database as app_user (the role the app uses).
// Seed: workspace "a" (ownerA owner, officerA officer) and "b" (ownerB owner), each with one
// company, contact, template and outreach row.
const A: Tenant = { userId: "ownerA", workspaceId: "a" };
const OFFICER_A: Tenant = { userId: "officerA", workspaceId: "a" };
const B: Tenant = { userId: "ownerB", workspaceId: "b" };

const TENANT_TABLES = [
  "Company",
  "Contact",
  "Template",
  "Outreach",
  "StageChange",
  "CompanyPairDecision",
  "AiRun",
  "FactSheet",
  "FactSheetPage",
  "FactSheetItem",
  "AiDraft",
  "ImportSession",
  "ImportChunk",
] as const;

async function seedTenantRows(tenant: Tenant, suffix: string) {
  await withTenant(tenant, async (tx) => {
    const { workspaceId, userId } = tenant;
    await tx.company.create({ data: { id: `co-${suffix}`, workspaceId, name: `Company ${suffix}`, nameKey: `company ${suffix}` } });
    await tx.contact.create({ data: { id: `ct-${suffix}`, workspaceId, companyId: `co-${suffix}`, name: "Sam" } });
    await tx.template.create({ data: { id: `tp-${suffix}`, workspaceId, name: "First touch", body: "Hi" } });
    await tx.outreach.create({
      data: { id: `or-${suffix}`, workspaceId, companyId: `co-${suffix}`, senderId: userId, templateId: `tp-${suffix}` },
    });
  });
}

// Every tenant table's rows as one tenant sees them.
const visibleIds = (tenant: Tenant) =>
  withTenant(tenant, async (tx) => ({
    companies: (await tx.company.findMany({ select: { id: true } })).map((r) => r.id),
    contacts: (await tx.contact.findMany({ select: { id: true } })).map((r) => r.id),
    templates: (await tx.template.findMany({ select: { id: true } })).map((r) => r.id),
    outreach: (await tx.outreach.findMany({ select: { id: true } })).map((r) => r.id),
  }));

const NOTHING = { companies: [], contacts: [], templates: [], outreach: [] };

beforeEach(async () => {
  await resetAndSeed();
  await seedTenantRows(A, "a");
  await seedTenantRows(B, "b");
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("the database role", () => {
  it("the app connects as app_user, which can't bypass row-level security", async () => {
    const [role] = await prisma.$queryRaw<{ user: string; super: boolean; bypass: boolean }[]>`
      SELECT current_user AS user, rolsuper AS super, rolbypassrls AS bypass FROM pg_roles WHERE rolname = current_user`;
    expect(role).toEqual({ user: "app_user", super: false, bypass: false });
  });

  test.for(TENANT_TABLES)("%s has row-level security enabled and forced", async (table) => {
    const [row] = await prisma.$queryRaw<{ enabled: boolean; forced: boolean }[]>`
      SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced FROM pg_class WHERE relname = ${table}`;
    expect(row).toEqual({ enabled: true, forced: true });
  });

  it("every table with a workspaceId has a policy, except Better Auth's (protected in app code)", async () => {
    const rows = await prisma.$queryRaw<{ table: string; enabled: boolean }[]>`
      SELECT c.relname AS table, c.relrowsecurity AS enabled
      FROM information_schema.columns col
      JOIN pg_class c ON c.relname = col.table_name
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      WHERE col.table_schema = 'public' AND col.column_name = 'workspaceId'`;
    const unprotected = rows.filter((r) => !r.enabled).map((r) => r.table).sort();
    // A new tenant table that forgets its policy shows up here and fails the test.
    expect(unprotected).toEqual(["invitation", "membership"]);
  });

  it("app_user can't read Prisma's migration history", async () => {
    await expect(prisma.$queryRaw`SELECT 1 FROM "_prisma_migrations"`).rejects.toThrow(/permission denied/);
  });

  it("app_user can't empty or drop a table", async () => {
    await expect(prisma.$executeRaw`TRUNCATE "Company"`).rejects.toThrow(/permission denied/);
    await expect(prisma.$executeRaw`DROP TABLE "Contact"`).rejects.toThrow(/must be owner|permission denied/);
  });

  it("every function we define pins its search_path, so it can't be pointed at look-alike tables", async () => {
    // A function without a fixed search_path looks tables up by whatever schemas the caller has
    // on its path. Pinning it (search_path = '') and naming tables in full closes that door.
    // This is the check Supabase's security advisor runs; a new function that skips it fails here.
    const unpinned = await prisma.$queryRaw<{ name: string }[]>`
      SELECT n.nspname || '.' || p.proname AS name
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('public', 'private')
        AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%')`;
    expect(unpinned.map((f) => f.name)).toEqual([]);
  });
});

describe("without withTenant, it fails closed", () => {
  it("every tenant table looks empty", async () => {
    expect(await prisma.company.count()).toBe(0);
    expect(await prisma.contact.count()).toBe(0);
    expect(await prisma.template.count()).toBe(0);
    expect(await prisma.outreach.count()).toBe(0);
  });

  it("writes are refused", async () => {
    await expect(prisma.company.create({ data: { workspaceId: "a", name: "Sneaky", nameKey: "sneaky" } })).rejects.toThrow(
      /row-level security/,
    );
  });

  it("the tenant settings don't leak to the next query on the same connection", async () => {
    for (let i = 0; i < 10; i++) {
      await visibleIds(A);
      expect(await prisma.company.count()).toBe(0);
    }
  });
});

describe("inside withTenant", () => {
  it("each workspace sees only its own rows", async () => {
    expect(await visibleIds(A)).toEqual({
      companies: ["co-a"],
      contacts: ["ct-a"],
      templates: ["tp-a"],
      outreach: ["or-a"],
    });
    expect(await visibleIds(B)).toEqual({
      companies: ["co-b"],
      contacts: ["ct-b"],
      templates: ["tp-b"],
      outreach: ["or-b"],
    });
  });

  it("officers see their workspace's rows too", async () => {
    expect((await visibleIds(OFFICER_A)).companies).toEqual(["co-a"]);
  });

  it("asking for B's rows by workspace id or row id from A finds nothing", async () => {
    await withTenant(A, async (tx) => {
      expect(await tx.company.findMany({ where: { workspaceId: "b" } })).toEqual([]);
      expect(await tx.company.findUnique({ where: { id: "co-b" } })).toBeNull();
      expect(await tx.contact.findUnique({ where: { id: "ct-b" } })).toBeNull();
    });
  });

  it("A can't update or delete B's rows", async () => {
    await withTenant(A, async (tx) => {
      expect((await tx.company.updateMany({ where: { id: "co-b" }, data: { name: "Hacked" } })).count).toBe(0);
      expect((await tx.contact.deleteMany({ where: { id: "ct-b" } })).count).toBe(0);
      expect((await tx.outreach.updateMany({ where: {}, data: { note: "x" } })).count).toBe(1);
    });
    const b = await visibleIds(B);
    expect(b).toEqual({ companies: ["co-b"], contacts: ["ct-b"], templates: ["tp-b"], outreach: ["or-b"] });
    expect(await withTenant(B, (tx) => tx.company.findUnique({ where: { id: "co-b" } }))).toMatchObject({
      name: "Company b",
    });
  });

  it("A can't move its own row into B", async () => {
    await expect(
      withTenant(A, (tx) => tx.company.update({ where: { id: "co-a" }, data: { workspaceId: "b" } })),
    ).rejects.toThrow(/row-level security/);
  });

  const plantInB: [string, (tx: Prisma.TransactionClient) => Promise<unknown>][] = [
    ["a company", (tx) => tx.company.create({ data: { workspaceId: "b", name: "Planted", nameKey: "planted" } })],
    ["a template", (tx) => tx.template.create({ data: { workspaceId: "b", name: "x", body: "x" } })],
  ];
  test.for(plantInB)("A can't create %s in workspace B", async ([, create]) => {
    await expect(withTenant(A, create)).rejects.toThrow(/row-level security/);
    expect(await visibleIds(B)).toMatchObject({ companies: ["co-b"], templates: ["tp-b"] });
  });

  it("a contact can't point at another workspace's company", async () => {
    await expect(
      withTenant(A, (tx) => tx.contact.create({ data: { workspaceId: "a", companyId: "co-b", name: "Spy" } })),
    ).rejects.toThrow(/foreign key/i);
  });

  it("outreach can't use another workspace's company", async () => {
    await expect(
      withTenant(A, (tx) =>
        tx.outreach.create({ data: { workspaceId: "a", companyId: "co-b", senderId: "ownerA" } }),
      ),
    ).rejects.toThrow(/foreign key/i);
  });

  it("outreach can't use another workspace's template", async () => {
    await expect(
      withTenant(A, (tx) =>
        tx.outreach.create({ data: { workspaceId: "a", companyId: "co-a", senderId: "ownerA", templateId: "tp-b" } }),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("outreach with no template, or its own workspace's template, is fine", async () => {
    await withTenant(A, async (tx) => {
      await tx.outreach.create({ data: { workspaceId: "a", companyId: "co-a", senderId: "ownerA" } });
      await tx.outreach.create({ data: { workspaceId: "a", companyId: "co-a", senderId: "ownerA", templateId: "tp-a" } });
    });
    expect((await visibleIds(A)).outreach).toHaveLength(3);
  });
});

describe("membership is checked by the database too", () => {
  it("someone who isn't a member sees nothing, even with the right workspace id", async () => {
    expect(await visibleIds({ userId: "ownerB", workspaceId: "a" })).toEqual(NOTHING);
  });

  it("an unknown user or workspace sees nothing", async () => {
    expect(await visibleIds({ userId: "nobody", workspaceId: "a" })).toEqual(NOTHING);
    expect(await visibleIds({ userId: "ownerA", workspaceId: "nope" })).toEqual(NOTHING);
  });

  it("a removed member loses access on their very next query", async () => {
    expect((await visibleIds(OFFICER_A)).companies).toEqual(["co-a"]);
    await prisma.membership.delete({ where: { id: "m-officerA" } });
    expect(await visibleIds(OFFICER_A)).toEqual(NOTHING);
  });

  it("a non-member can't write either", async () => {
    await expect(
      withTenant({ userId: "ownerB", workspaceId: "a" }, (tx) =>
        tx.company.create({ data: { workspaceId: "a", name: "Planted", nameKey: "planted" } }),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("withTenant itself", () => {
  it("rolls everything back if the work fails", async () => {
    await expect(
      withTenant(A, async (tx) => {
        await tx.company.create({ data: { id: "co-new", workspaceId: "a", name: "New", nameKey: "new" } });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect((await visibleIds(A)).companies).toEqual(["co-a"]);
  });

  it(`many workspaces at the same time each see only their own rows`, async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => visibleIds(i % 2 === 0 ? A : B)),
    );
    results.forEach((seen, i) => expect(seen.companies).toEqual([i % 2 === 0 ? "co-a" : "co-b"]));
  });

  it("deleting a workspace still removes its rows (cascades aren't blocked by row-level security)", async () => {
    await prisma.workspace.delete({ where: { id: "b" } });
    await prisma.membership.create({
      data: { id: "m-ownerA-b-check", workspaceId: "a", userId: "ownerB", role: "member", createdAt: new Date() },
    });
    // ownerB is now a member of "a" only; "b" and its rows are gone.
    expect(await visibleIds({ userId: "ownerB", workspaceId: "b" })).toEqual(NOTHING);
    expect((await visibleIds({ userId: "ownerB", workspaceId: "a" })).companies).toEqual(["co-a"]);
  });
});
