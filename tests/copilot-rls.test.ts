import { afterAll, beforeEach, describe, expect, it, test } from "vitest";
import { prisma, withTenant, type Tenant } from "@/lib/db";
import { resetAndSeed } from "./helpers/seed";

// Ask Coppice's conversations (CopilotThread, CopilotTurn) against the real database as app_user.
// They are private to the person: another workspace can't read them, and neither can another
// member of the same workspace, an owner included.
const OWNER_A: Tenant = { userId: "ownerA", workspaceId: "a" };
const OFFICER_A: Tenant = { userId: "officerA", workspaceId: "a" };
const OWNER_B: Tenant = { userId: "ownerB", workspaceId: "b" };

const intent = { view: "none", reply: "", filter: null, company: null, minutes: null, guideTopics: [], actions: [] };

async function seedConversation(who: Tenant, suffix: string) {
  await withTenant(who, async (tx) => {
    await tx.copilotThread.create({ data: { id: `th-${suffix}`, workspaceId: who.workspaceId, userId: who.userId } });
    await tx.copilotTurn.create({
      data: { id: `tu-${suffix}`, threadId: `th-${suffix}`, workspaceId: who.workspaceId, userId: who.userId, question: "Who is overdue?", intent, reply: "Here.", shown: [], status: "ANSWERED" },
    });
  });
}

const seen = (who: Tenant) =>
  withTenant(who, async (tx) => ({
    threads: (await tx.copilotThread.findMany({ select: { id: true }, orderBy: { id: "asc" } })).map((r) => r.id),
    turns: (await tx.copilotTurn.findMany({ select: { id: true }, orderBy: { id: "asc" } })).map((r) => r.id),
  }));
const NOTHING = { threads: [], turns: [] };

beforeEach(async () => {
  await resetAndSeed();
  await seedConversation(OWNER_A, "owner");
  await seedConversation(OFFICER_A, "officer");
  await seedConversation(OWNER_B, "other");
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("the tables are locked down", () => {
  test.for(["CopilotThread", "CopilotTurn"])("%s has row-level security enabled and forced, and one policy", async (table) => {
    const [row] = await prisma.$queryRaw<{ enabled: boolean; forced: boolean }[]>`
      SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced FROM pg_class WHERE relname = ${table}`;
    expect(row).toEqual({ enabled: true, forced: true });
    const policies = await prisma.$queryRaw<{ policyname: string }[]>`SELECT policyname FROM pg_policies WHERE tablename = ${table}`;
    expect(policies.map((p) => p.policyname)).toEqual(["tenant_isolation"]);
  });

  it("app_user can read and write them, and nothing else about them is open", async () => {
    const rows = await prisma.$queryRaw<{ table_name: string; privilege_type: string }[]>`
      SELECT table_name, privilege_type FROM information_schema.role_table_grants
      WHERE grantee = 'app_user' AND table_name IN ('CopilotThread', 'CopilotTurn') ORDER BY table_name, privilege_type`;
    expect(rows.map((r) => `${r.table_name} ${r.privilege_type}`)).toEqual([
      "CopilotThread DELETE",
      "CopilotThread INSERT",
      "CopilotThread SELECT",
      "CopilotThread UPDATE",
      "CopilotTurn DELETE",
      "CopilotTurn INSERT",
      "CopilotTurn SELECT",
      "CopilotTurn UPDATE",
    ]);
  });
});

describe("reading", () => {
  it("each person sees only their own conversation", async () => {
    expect(await seen(OWNER_A)).toEqual({ threads: ["th-owner"], turns: ["tu-owner"] });
    expect(await seen(OFFICER_A)).toEqual({ threads: ["th-officer"], turns: ["tu-officer"] });
    expect(await seen(OWNER_B)).toEqual({ threads: ["th-other"], turns: ["tu-other"] });
  });

  it("another workspace can't read them, even naming the row", async () => {
    await withTenant(OWNER_B, async (tx) => {
      expect(await tx.copilotThread.findUnique({ where: { id: "th-owner" } })).toBeNull();
      expect(await tx.copilotTurn.findUnique({ where: { id: "tu-owner" } })).toBeNull();
    });
  });

  it("another member of the same workspace can't read them, and an owner can't read an officer's", async () => {
    await withTenant(OFFICER_A, async (tx) => {
      expect(await tx.copilotThread.findUnique({ where: { id: "th-owner" } })).toBeNull();
      expect(await tx.copilotTurn.findUnique({ where: { id: "tu-owner" } })).toBeNull();
    });
    await withTenant(OWNER_A, async (tx) => {
      expect(await tx.copilotThread.findUnique({ where: { id: "th-officer" } })).toBeNull();
      expect(await tx.copilotTurn.findUnique({ where: { id: "tu-officer" } })).toBeNull();
    });
  });

  it("a person who is not a member of the workspace they name sees nothing", async () => {
    expect(await seen({ userId: "ownerB", workspaceId: "a" })).toEqual(NOTHING);
    expect(await seen({ userId: "ownerA", workspaceId: "b" })).toEqual(NOTHING);
  });

  it("with no workspace or no person set, nothing is visible", async () => {
    expect(await prisma.copilotThread.count()).toBe(0);
    expect(await prisma.copilotTurn.count()).toBe(0);
  });
});

describe("writing", () => {
  const turn = (who: Tenant, threadId: string, data: Record<string, unknown> = {}) =>
    withTenant(who, (tx) =>
      tx.copilotTurn.create({ data: { threadId, workspaceId: who.workspaceId, userId: who.userId, question: "q", intent, reply: "r", shown: [], status: "ANSWERED", ...data } }),
    );

  it("refuses a thread written for another person, or into another workspace", async () => {
    await expect(withTenant(OFFICER_A, (tx) => tx.copilotThread.create({ data: { workspaceId: "a", userId: "ownerA" } }))).rejects.toThrow();
    await expect(withTenant(OWNER_A, (tx) => tx.copilotThread.create({ data: { workspaceId: "b", userId: "ownerA" } }))).rejects.toThrow();
  });

  it("refuses a turn written for another person, or into another workspace", async () => {
    await expect(withTenant(OFFICER_A, (tx) => tx.copilotTurn.create({ data: { threadId: "th-officer", workspaceId: "a", userId: "ownerA", question: "q", intent, reply: "r", shown: [], status: "ANSWERED" } }))).rejects.toThrow();
    await expect(turn({ userId: "ownerA", workspaceId: "b" }, "th-owner")).rejects.toThrow();
  });

  it("refuses a turn in someone else's thread, even one in the same workspace and written as oneself", async () => {
    await expect(turn(OFFICER_A, "th-owner")).rejects.toThrow();
    await expect(turn(OWNER_A, "th-other")).rejects.toThrow();
    // Nothing was added to anyone's thread.
    expect(await seen(OWNER_A)).toEqual({ threads: ["th-owner"], turns: ["tu-owner"] });
  });

  it("changes and removes only one's own rows", async () => {
    await withTenant(OFFICER_A, async (tx) => {
      expect((await tx.copilotTurn.updateMany({ where: { id: "tu-owner" }, data: { reply: "changed" } })).count).toBe(0);
      expect((await tx.copilotTurn.deleteMany({ where: { id: "tu-owner" } })).count).toBe(0);
      expect((await tx.copilotThread.deleteMany({ where: { id: "th-owner" } })).count).toBe(0);
      expect((await tx.copilotTurn.updateMany({ where: { id: "tu-officer" }, data: { reply: "mine" } })).count).toBe(1);
    });
    await withTenant(OWNER_A, async (tx) => {
      expect((await tx.copilotTurn.findUniqueOrThrow({ where: { id: "tu-owner" } })).reply).toBe("Here.");
    });
  });

  it("an owner can't delete an officer's conversation", async () => {
    await withTenant(OWNER_A, async (tx) => {
      expect((await tx.copilotThread.deleteMany({ where: { id: "th-officer" } })).count).toBe(0);
    });
    expect((await seen(OFFICER_A)).threads).toEqual(["th-officer"]);
  });
});

describe("the bounds the database keeps", () => {
  const add = (data: Record<string, unknown>) =>
    withTenant(OWNER_A, (tx) =>
      tx.copilotTurn.create({ data: { threadId: "th-owner", workspaceId: "a", userId: "ownerA", question: "q", intent, reply: "r", shown: [], status: "ANSWERED", ...data } }),
    );

  test.for<[string, Record<string, unknown>]>([
    ["an empty question", { question: "" }],
    ["a question over 500 characters", { question: "x".repeat(501) }],
    ["an intent that is not an object", { intent: [] }],
    ["more than 25 shown ids", { shown: Array.from({ length: 26 }, (_, i) => `c${i}`) }],
    ["a shown list that is not a list", { shown: {} }],
    ["an answered turn that carries an error", { error: "timeout" }],
    ["a failed turn with no error", { status: "FAILED" }],
    ["an error code over 40 characters", { status: "FAILED", error: "e".repeat(41) }],
  ])("refuses %s", async ([, data]) => {
    await expect(add(data)).rejects.toThrow();
  });

  it("accepts a question of 500 characters, 25 shown ids and a failed turn with a code", async () => {
    await add({ question: "x".repeat(500), shown: Array.from({ length: 25 }, (_, i) => `c${i}`) });
    await add({ status: "FAILED", error: "rate_limited" });
    expect((await seen(OWNER_A)).turns).toHaveLength(3);
  });
});

describe("what happens when things are removed", () => {
  it("deleting a thread deletes its turns", async () => {
    await withTenant(OWNER_A, (tx) => tx.copilotThread.delete({ where: { id: "th-owner" } }));
    expect(await seen(OWNER_A)).toEqual(NOTHING);
    expect(await seen(OFFICER_A)).toEqual({ threads: ["th-officer"], turns: ["tu-officer"] });
  });

  it("deleting a workspace deletes its conversations and leaves other workspaces' alone", async () => {
    await prisma.workspace.delete({ where: { id: "a" } });
    expect(await seen(OWNER_A)).toEqual(NOTHING);
    expect(await seen(OWNER_B)).toEqual({ threads: ["th-other"], turns: ["tu-other"] });
  });

  it("deleting a person deletes their conversations", async () => {
    await prisma.user.delete({ where: { id: "officerA" } });
    expect(await seen(OFFICER_A)).toEqual(NOTHING);
    expect(await seen(OWNER_A)).toEqual({ threads: ["th-owner"], turns: ["tu-owner"] });
  });
});
