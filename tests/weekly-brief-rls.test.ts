import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, withTenant, type Tenant } from "@/lib/db";
import { resetAndSeed } from "./helpers/seed";

// Row-level security and the constraints of WeeklyBrief, against the real database as app_user.
// Workspace "a" (ownerA owner, officerA officer) and "b" (ownerB owner).
const A: Tenant = { userId: "ownerA", workspaceId: "a" };
const OFFICER_A: Tenant = { userId: "officerA", workspaceId: "a" };
const B: Tenant = { userId: "ownerB", workspaceId: "b" };
const B_IN_A: Tenant = { userId: "ownerB", workspaceId: "a" };

const RLS = /row-level security/i;
const CHECK = /check constraint|violates/i;
const startedAt = new Date(Date.parse("2026-11-23T15:00:00Z"));
const brief = (workspaceId: string, startedById: string, extra: object = {}) => ({
  workspaceId,
  weekStart: "2026-11-23",
  status: "WRITING" as const,
  startedById,
  startedAt,
  attempts: 1,
  ...extra,
});

beforeEach(async () => {
  await resetAndSeed();
  await withTenant(A, (tx) => tx.weeklyBrief.create({ data: { id: "wb-a", ...brief("a", "ownerA") } }));
  await withTenant(B, (tx) => tx.weeklyBrief.create({ data: { id: "wb-b", ...brief("b", "ownerB") } }));
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("row-level security", () => {
  it("is enabled and forced", async () => {
    const [row] = await prisma.$queryRaw<{ enabled: boolean; forced: boolean }[]>`
      SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced FROM pg_class WHERE relname = 'WeeklyBrief'`;
    expect(row).toEqual({ enabled: true, forced: true });
  });

  it("shows nothing without withTenant", async () => {
    expect(await prisma.weeklyBrief.count()).toBe(0);
  });

  it("shows each workspace only its own row, and an officer reads and writes the workspace's", async () => {
    expect((await withTenant(A, (tx) => tx.weeklyBrief.findMany({ select: { id: true } }))).map((r) => r.id)).toEqual(["wb-a"]);
    expect((await withTenant(B, (tx) => tx.weeklyBrief.findMany({ select: { id: true } }))).map((r) => r.id)).toEqual(["wb-b"]);
    expect(await withTenant(OFFICER_A, (tx) => tx.weeklyBrief.updateMany({ where: { id: "wb-a" }, data: { attempts: 2 } }))).toEqual({ count: 1 });
  });

  it("won't let workspace b read, change, delete or write a's rows", async () => {
    const result = await withTenant(B, async (tx) => ({
      read: await tx.weeklyBrief.count({ where: { workspaceId: "a" } }),
      update: (await tx.weeklyBrief.updateMany({ where: { id: "wb-a" }, data: { attempts: 3 } })).count,
      remove: (await tx.weeklyBrief.deleteMany({ where: { id: "wb-a" } })).count,
    }));
    expect(result).toEqual({ read: 0, update: 0, remove: 0 });
    await expect(withTenant(B, (tx) => tx.weeklyBrief.create({ data: brief("a", "ownerB", { weekStart: "2026-11-30" }) }))).rejects.toThrow(RLS);
    expect(await withTenant(A, (tx) => tx.weeklyBrief.findUniqueOrThrow({ where: { id: "wb-a" }, select: { attempts: true } }))).toEqual({ attempts: 1 });
  });

  it("refuses ownerB acting in workspace a", async () => {
    expect(await withTenant(B_IN_A, (tx) => tx.weeklyBrief.count())).toBe(0);
    await expect(withTenant(B_IN_A, (tx) => tx.weeklyBrief.create({ data: brief("a", "ownerB", { weekStart: "2026-11-30" }) }))).rejects.toThrow(RLS);
  });
});

describe("constraints", () => {
  const write = (data: object) => withTenant(A, (tx) => tx.weeklyBrief.create({ data: { ...brief("a", "ownerA", { weekStart: "2026-11-30" }), ...data } }));

  it("allows one row per workspace and week", async () => {
    await expect(write({ weekStart: "2026-11-23" })).rejects.toThrow(/unique|duplicate/i);
  });

  it("refuses a week that isn't a calendar date", async () => {
    await expect(write({ weekStart: "Nov 30" })).rejects.toThrow(CHECK);
  });

  it("refuses READY without facts and paragraphs, or with an error", async () => {
    await expect(write({ status: "READY", paragraphs: [] })).rejects.toThrow(CHECK);
    await expect(write({ status: "READY", facts: {} })).rejects.toThrow(CHECK);
    await expect(write({ status: "READY", facts: {}, paragraphs: [], error: "timeout" })).rejects.toThrow(CHECK);
    await write({ status: "READY", facts: {}, paragraphs: [] });
  });

  it("refuses FAILED without an error code, or with one it doesn't know", async () => {
    await expect(write({ status: "FAILED" })).rejects.toThrow(CHECK);
    await expect(write({ status: "FAILED", error: "The AI is busy right now." })).rejects.toThrow(CHECK);
    await write({ status: "FAILED", error: "rate_limited" });
  });

  it("refuses paragraphs that aren't a list, and attempts past 10", async () => {
    await expect(write({ status: "READY", facts: {}, paragraphs: { a: 1 } })).rejects.toThrow(CHECK);
    await expect(write({ attempts: 11 })).rejects.toThrow(CHECK);
  });
});
