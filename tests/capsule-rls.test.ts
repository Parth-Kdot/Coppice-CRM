import { afterAll, beforeEach, describe, expect, it, test } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { prisma, withTenant, type Tenant } from "@/lib/db";
import { resetAndSeed } from "./helpers/seed";

// Row-level security for the Time Capsule's three tables (HandoffReport, RelationshipCard,
// ArchiveRedaction) and the Membership.departingAt column, against the real database as app_user.
// Seed: workspace "a" (ownerA owner, officerA officer) and "b" (ownerB owner). Every member of a
// workspace can read its rows; only an owner can write them. Which rows an officer is shown is
// decided by the read functions in lib/capsule/ (tests/capsule.test.ts), not here.
const A: Tenant = { userId: "ownerA", workspaceId: "a" };
const OFFICER_A: Tenant = { userId: "officerA", workspaceId: "a" };
const B: Tenant = { userId: "ownerB", workspaceId: "b" };
// An owner of B acting in workspace A: not a member there.
const OUTSIDER_IN_A: Tenant = { userId: "ownerB", workspaceId: "a" };

const YEAR = 2025;

async function seedCapsule(tenant: Tenant, suffix: string) {
  await withTenant(tenant, async (tx) => {
    const { workspaceId, userId } = tenant;
    await tx.company.create({ data: { id: `co-${suffix}`, workspaceId, name: `Company ${suffix}`, nameKey: `company ${suffix}` } });
    await tx.handoffReport.create({ data: { id: `hr-${suffix}`, workspaceId, boardYearStart: YEAR, companyIds: [`co-${suffix}`], chunkCount: 1, createdById: userId } });
    await tx.relationshipCard.create({ data: { id: `rc-${suffix}`, workspaceId, reportId: `hr-${suffix}`, companyId: `co-${suffix}`, source: "CODE", bullets: { facts: {}, bullets: [] } } });
    await tx.archiveRedaction.create({ data: { id: `ar-${suffix}`, workspaceId, cardId: `rc-${suffix}`, bulletIndex: null, hiddenById: userId } });
  });
}

const ids = (tenant: Tenant) =>
  withTenant(tenant, async (tx) => ({
    reports: (await tx.handoffReport.findMany({ select: { id: true } })).map((r) => r.id),
    cards: (await tx.relationshipCard.findMany({ select: { id: true } })).map((r) => r.id),
    redactions: (await tx.archiveRedaction.findMany({ select: { id: true } })).map((r) => r.id),
  }));
const EMPTY = { reports: [], cards: [], redactions: [] };
const ONLY_A = { reports: ["hr-a"], cards: ["rc-a"], redactions: ["ar-a"] };
const ONLY_B = { reports: ["hr-b"], cards: ["rc-b"], redactions: ["ar-b"] };

beforeEach(async () => {
  await resetAndSeed();
  await seedCapsule(A, "a");
  await seedCapsule(B, "b");
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("the tables are protected", () => {
  test.for(["HandoffReport", "RelationshipCard", "ArchiveRedaction"])("%s has row-level security enabled and forced", async (table) => {
    const [row] = await prisma.$queryRaw<{ enabled: boolean; forced: boolean }[]>`
      SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced FROM pg_class WHERE relname = ${table}`;
    expect(row).toEqual({ enabled: true, forced: true });
  });

  test.for(["HandoffReport", "RelationshipCard", "ArchiveRedaction"])("%s has a read policy and owner-only write policies", async (table) => {
    const rows = await prisma.$queryRaw<{ name: string; cmd: string }[]>`
      SELECT policyname AS name, cmd FROM pg_policies WHERE schemaname = 'public' AND tablename = ${table} ORDER BY policyname`;
    expect(rows).toEqual([
      { name: "owner_delete", cmd: "DELETE" },
      { name: "owner_insert", cmd: "INSERT" },
      { name: "owner_update", cmd: "UPDATE" },
      { name: "tenant_read", cmd: "SELECT" },
    ]);
  });

  it("the app role can read and write them, and nothing else about them", async () => {
    const rows = await prisma.$queryRaw<{ table: string; privileges: string }[]>`
      SELECT table_name::text AS table, string_agg(privilege_type::text, ',' ORDER BY privilege_type) AS privileges
      FROM information_schema.role_table_grants
      WHERE grantee = 'app_user' AND table_name IN ('HandoffReport', 'RelationshipCard', 'ArchiveRedaction')
      GROUP BY table_name ORDER BY table_name`;
    expect(rows).toEqual(
      ["ArchiveRedaction", "HandoffReport", "RelationshipCard"].map((table) => ({ table, privileges: "DELETE,INSERT,SELECT,UPDATE" })),
    );
  });
});

describe("what each person can see", () => {
  it("each workspace sees only its own rows; an outsider and no tenant see nothing", async () => {
    expect(await ids(A)).toEqual(ONLY_A);
    expect(await ids(OFFICER_A)).toEqual(ONLY_A);
    expect(await ids(B)).toEqual(ONLY_B);
    expect(await ids(OUTSIDER_IN_A)).toEqual(EMPTY);
    expect(await prisma.handoffReport.count()).toBe(0);
    expect(await prisma.relationshipCard.count()).toBe(0);
    expect(await prisma.archiveRedaction.count()).toBe(0);
  });

  it("A can't change or remove B's rows", async () => {
    await withTenant(A, async (tx) => {
      expect((await tx.handoffReport.updateMany({ where: { id: "hr-b" }, data: { status: "PUBLISHED" } })).count).toBe(0);
      expect((await tx.relationshipCard.updateMany({ where: { id: "rc-b" }, data: { recontactOn: "2026-08-01" } })).count).toBe(0);
      expect((await tx.archiveRedaction.deleteMany({ where: { id: "ar-b" } })).count).toBe(0);
      expect((await tx.relationshipCard.deleteMany({ where: { id: "rc-b" } })).count).toBe(0);
      expect((await tx.handoffReport.deleteMany({ where: { id: "hr-b" } })).count).toBe(0);
    });
    expect(await ids(B)).toEqual(ONLY_B);
  });
});

describe("what each person can write", () => {
  const plant: [string, (tx: Prisma.TransactionClient) => Promise<unknown>][] = [
    ["a report", (tx) => tx.handoffReport.create({ data: { workspaceId: "b", boardYearStart: 2024, companyIds: [], chunkCount: 0, createdById: "ownerA" } })],
    ["a card", (tx) => tx.relationshipCard.create({ data: { workspaceId: "b", reportId: "hr-b", companyId: "co-b", source: "CODE", bullets: {} } })],
    ["a redaction", (tx) => tx.archiveRedaction.create({ data: { workspaceId: "b", cardId: "rc-b", bulletIndex: 0, hiddenById: "ownerA" } })],
  ];
  test.for(plant)("A can't create %s in workspace B", async ([, create]) => {
    await expect(withTenant(A, create)).rejects.toThrow(/row-level security/);
    expect(await ids(B)).toEqual(ONLY_B);
  });

  test.for(plant)("someone who isn't a member of workspace B can't create %s there either", async ([, create]) => {
    await expect(withTenant({ userId: "ownerA", workspaceId: "b" }, create)).rejects.toThrow(/row-level security/);
  });

  it("a card can't point at another workspace's report or company, nor a redaction at another workspace's card", async () => {
    const card = (reportId: string, companyId: string) => withTenant(A, (tx) => tx.relationshipCard.create({ data: { workspaceId: "a", reportId, companyId, source: "CODE", bullets: {} } }));
    await expect(card("hr-b", "co-a")).rejects.toThrow(/foreign key/i);
    await expect(card("hr-a", "co-b")).rejects.toThrow(/foreign key/i);
    await expect(
      withTenant(A, (tx) => tx.archiveRedaction.create({ data: { workspaceId: "a", cardId: "rc-b", bulletIndex: 1, hiddenById: "ownerA" } })),
    ).rejects.toThrow(/foreign key/i);
  });

  it("only owners may write, even inside their own workspace; officers can still read", async () => {
    await expect(
      withTenant(OFFICER_A, (tx) => tx.handoffReport.create({ data: { workspaceId: "a", boardYearStart: 2024, companyIds: [], chunkCount: 0, createdById: "officerA" } })),
    ).rejects.toThrow(/row-level security/);
    await expect(
      withTenant(OFFICER_A, (tx) => tx.archiveRedaction.create({ data: { workspaceId: "a", cardId: "rc-a", bulletIndex: 2, hiddenById: "officerA" } })),
    ).rejects.toThrow(/row-level security/);
    expect((await withTenant(OFFICER_A, (tx) => tx.handoffReport.updateMany({ data: { status: "PUBLISHED" } }))).count).toBe(0);
    expect((await withTenant(OFFICER_A, (tx) => tx.relationshipCard.updateMany({ data: { approvedAt: new Date() } }))).count).toBe(0);
    expect((await withTenant(OFFICER_A, (tx) => tx.archiveRedaction.deleteMany({}))).count).toBe(0);
    expect((await withTenant(OFFICER_A, (tx) => tx.relationshipCard.deleteMany({}))).count).toBe(0);
    expect(await ids(OFFICER_A)).toEqual(ONLY_A);
    expect((await withTenant(A, (tx) => tx.handoffReport.updateMany({ data: { status: "PUBLISHED" } }))).count).toBe(1);
  });
});

describe("the table rules", () => {
  it("one report per workspace per board year, and the same year in two workspaces is fine", async () => {
    await expect(
      withTenant(A, (tx) => tx.handoffReport.create({ data: { workspaceId: "a", boardYearStart: YEAR, companyIds: [], chunkCount: 0, createdById: "ownerA" } })),
    ).rejects.toThrow(/unique/i);
    expect((await ids(B)).reports).toEqual(["hr-b"]);
  });

  it("one card per company per report", async () => {
    await expect(
      withTenant(A, (tx) => tx.relationshipCard.create({ data: { workspaceId: "a", reportId: "hr-a", companyId: "co-a", source: "CODE", bullets: {} } })),
    ).rejects.toThrow(/unique/i);
  });

  it("a card or bullet is hidden at most once, including the whole card (a null index)", async () => {
    // The seed already hid the whole card once; a second whole-card row is refused.
    await expect(
      withTenant(A, (tx) => tx.archiveRedaction.create({ data: { workspaceId: "a", cardId: "rc-a", bulletIndex: null, hiddenById: "ownerA" } })),
    ).rejects.toThrow(/unique/i);
    await withTenant(A, (tx) => tx.archiveRedaction.create({ data: { workspaceId: "a", cardId: "rc-a", bulletIndex: 3, hiddenById: "ownerA" } }));
    await expect(
      withTenant(A, (tx) => tx.archiveRedaction.create({ data: { workspaceId: "a", cardId: "rc-a", bulletIndex: 3, hiddenById: "ownerA" } })),
    ).rejects.toThrow(/unique/i);
  });

  it("refuses a board year out of range, a negative bullet index and a re-contact date that isn't a date", async () => {
    await expect(
      withTenant(A, (tx) => tx.handoffReport.create({ data: { workspaceId: "a", boardYearStart: 1999, companyIds: [], chunkCount: 0, createdById: "ownerA" } })),
    ).rejects.toThrow(/check/i);
    await expect(
      withTenant(A, (tx) => tx.archiveRedaction.create({ data: { workspaceId: "a", cardId: "rc-a", bulletIndex: -1, hiddenById: "ownerA" } })),
    ).rejects.toThrow(/check/i);
    await expect(withTenant(A, (tx) => tx.relationshipCard.update({ where: { id: "rc-a" }, data: { recontactOn: "next August" } }))).rejects.toThrow(/check/i);
    await withTenant(A, (tx) => tx.relationshipCard.update({ where: { id: "rc-a" }, data: { recontactOn: "2026-08-01" } }));
  });

  it("deleting a company, a report or a workspace takes its cards and redactions with it", async () => {
    await withTenant(A, (tx) => tx.company.delete({ where: { id: "co-a" } }));
    expect(await ids(A)).toEqual({ reports: ["hr-a"], cards: [], redactions: [] });
    await prisma.workspace.delete({ where: { id: "b" } });
    expect(await prisma.$queryRaw`SELECT 1 FROM "RelationshipCard" WHERE "workspaceId" = 'b'`).toEqual([]);
  });
});

describe("Membership.departingAt", () => {
  it("starts empty for everyone, and can be set and cleared without touching the role", async () => {
    const before = await prisma.membership.findMany({ select: { userId: true, departingAt: true, role: true }, orderBy: { userId: "asc" } });
    expect(before.every((m) => m.departingAt === null)).toBe(true);
    const when = new Date("2026-06-01T12:00:00Z");
    await prisma.membership.updateMany({ where: { workspaceId: "a", userId: "officerA" }, data: { departingAt: when } });
    const set = await prisma.membership.findFirstOrThrow({ where: { workspaceId: "a", userId: "officerA" } });
    expect(set).toMatchObject({ role: "member", departingAt: when });
    await prisma.membership.updateMany({ where: { workspaceId: "a", userId: "officerA" }, data: { departingAt: null } });
    expect((await prisma.membership.findFirstOrThrow({ where: { workspaceId: "a", userId: "officerA" } })).departingAt).toBeNull();
  });

  it("is ignored by the owner-keeping rule: marking the only owner changes nothing about it", async () => {
    await prisma.membership.updateMany({ where: { workspaceId: "b", userId: "ownerB" }, data: { departingAt: new Date() } });
    expect(await prisma.membership.count({ where: { workspaceId: "b", role: "owner" } })).toBe(1);
  });
});
