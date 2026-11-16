import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { claimCompany } from "@/lib/claims";
import { createCompany } from "@/lib/companies";
import { prisma, withTenant } from "@/lib/db";
import { setDeparting } from "@/lib/capsule/members";
import { MCP_LIST_LIMIT } from "@/lib/validation";
import { clearActivity, defineToolTables, OWNER_A, setMcp, tokenCache, type ToolRow } from "./helpers/mcp-tools";
import { deleteOAuthClients, mcpClient, resultJson, resultText, restoreFetch, routeAppFetches } from "./helpers/oauth";
import { invite, resetAndSeed } from "./helpers/seed";

// Group W of the MCP server, the workspace (get_workspace and list_members), against the real
// database and the official client. Both are read only. Seed: workspace "a" (ownerA owner,
// officerA officer) and "b" (ownerB owner).

const tokenFor = tokenCache();

async function callAs(userId: string, name: string, args: Record<string, unknown> = {}, workspaceId = "a") {
  const client = await mcpClient(await tokenFor(userId));
  return client.callTool({ name, arguments: { workspaceId, ...args } });
}

beforeAll(async () => {
  routeAppFetches();
  await resetAndSeed();
  await deleteOAuthClients();
});

beforeEach(async () => {
  await prisma.mcpRateLimit.deleteMany();
  await withTenant(OWNER_A, (tx) => tx.company.deleteMany({ where: { workspaceId: "a" } }));
  await withTenant(OWNER_A, (tx) => tx.template.deleteMany({ where: { workspaceId: "a" } }));
  await setMcp("a", true);
});

afterAll(async () => {
  restoreFetch();
  await deleteOAuthClients();
  await prisma.session.deleteMany();
  await clearActivity();
  await prisma.$disconnect();
});

// One row for every tool of the group: the shared refusal tables in tests/helpers/mcp-tools.ts
// run each of them.
const ROWS: ToolRow<object>[] = [
  { name: "get_workspace", kind: "read", args: () => ({}), typed: () => "Org A" },
  { name: "list_members", kind: "read", args: () => ({}), typed: () => "officera@example.com" },
];
defineToolTables(ROWS, { tokenFor, makeContext: async () => ({}) });

describe("get_workspace", () => {
  it("gives an owner and an officer the same settings, with their own role", async () => {
    const owner = resultJson(await callAs("ownerA", "get_workspace"));
    const officer = resultJson(await callAs("officerA", "get_workspace"));
    expect(owner.workspace).toMatchObject({
      id: "a",
      name: { untrusted_text: "Org A" },
      yourRole: "Owner",
      claimWindowDays: 14,
      ai: { on: false, monthlyLimit: 300, usedLast30Days: 0 },
      assistantsOn: true,
      archivedCount: 0,
      industries: [],
      activeTemplateCount: 0,
    });
    expect({ ...officer.workspace, yourRole: "Owner" }).toEqual(owner.workspace);
    expect(officer.workspace.yourRole).toBe("Officer");
  });

  it("counts companies at every stage (zero included), the archived ones apart, templates and industries", async () => {
    const make = async (name: string, industry?: string) => {
      const result = await createCompany(OWNER_A, { name, industry });
      if (result.status !== "saved") throw new Error("seed");
      return result.companyId;
    };
    const one = await make("One", "Tech");
    await make("Two", "Food");
    await make("Three", "Tech");
    const archived = await make("Four");
    await withTenant(OWNER_A, async (tx) => {
      await tx.company.update({ where: { id: one }, data: { stage: "REPLIED" } });
      await tx.company.update({ where: { id: archived }, data: { archivedAt: new Date() } });
      await tx.template.create({ data: { workspaceId: "a", name: "First touch", body: "Hi {{contact_first_name}}" } });
      await tx.template.create({ data: { workspaceId: "a", name: "Old", body: "x", archivedAt: new Date() } });
    });
    const { workspace } = resultJson(await callAs("ownerA", "get_workspace"));
    expect(workspace.stageCounts).toMatchObject({ NOT_CONTACTED: 2, REPLIED: 1, CONTACTED: 0, COMMITTED: 0, DECLINED: 0 });
    expect(Object.keys(workspace.stageCounts).sort()).toEqual(["COMMITTED", "CONTACTED", "DECLINED", "IN_CONVERSATION", "NOT_CONTACTED", "REPLIED"].sort());
    expect(workspace.archivedCount).toBe(1);
    expect(workspace.activeTemplateCount).toBe(1);
    expect(workspace.industries).toEqual([{ untrusted_text: "Food" }, { untrusted_text: "Tech" }]);
  });

  it("shows the AI switch and the calls used in the last 30 days", async () => {
    await prisma.workspace.update({ where: { id: "a" }, data: { aiEnabled: true, aiMonthlyLimit: 120 } });
    try {
      const { workspace } = resultJson(await callAs("officerA", "get_workspace"));
      expect(workspace.ai).toEqual({ on: true, monthlyLimit: 120, usedLast30Days: 0 });
    } finally {
      await prisma.workspace.update({ where: { id: "a" }, data: { aiEnabled: false, aiMonthlyLimit: 300 } });
    }
  });

  it("changes nothing and writes no activity row", async () => {
    await clearActivity();
    await callAs("ownerA", "get_workspace");
    expect(await withTenant(OWNER_A, (tx) => tx.assistantActivity.count())).toBe(0);
  });
});

describe("list_members", () => {
  it("gives an officer names, roles and joined dates only: no emails, ids or invitations", async () => {
    await invite({ id: "inv-1", email: "waiting@example.com" });
    try {
      const result = await callAs("officerA", "list_members");
      const text = resultText(result);
      const data = JSON.parse(text);
      expect(data.members.map((m: { name: unknown }) => m.name)).toEqual(expect.arrayContaining([{ untrusted_text: "ownerA" }, { untrusted_text: "officerA" }]));
      expect(data.members.map((m: { role: string }) => m.role).sort()).toEqual(["Officer", "Owner"]);
      for (const m of data.members) expect(Object.keys(m).sort()).toEqual(["joinedAt", "name", "role"]);
      expect(data.invitations).toBeUndefined();
      expect(text).not.toContain("@example.com");
      expect(text).not.toContain("waiting");
    } finally {
      await prisma.invitation.deleteMany();
    }
  });

  it("gives an owner emails, who is leaving, claims held and the invitations still waiting", async () => {
    const created = await createCompany(OWNER_A, { name: "Held Co" });
    if (created.status !== "saved") throw new Error("seed");
    await claimCompany({ userId: "officerA", workspaceId: "a" }, created.companyId);
    await setDeparting(OWNER_A, "officerA", true);
    await invite({ id: "inv-live", email: "live@example.com", role: "owner" });
    await invite({ id: "inv-old", email: "old@example.com", expiresAt: new Date(Date.now() - 1000) });
    await invite({ id: "inv-gone", email: "gone@example.com", status: "canceled" });
    try {
      const data = resultJson(await callAs("ownerA", "list_members"));
      const officer = data.members.find((m: { userId: string }) => m.userId === "officerA");
      expect(officer).toMatchObject({
        name: { untrusted_text: "officerA" },
        role: "Officer",
        email: { untrusted_text: "officera@example.com" },
        leaving: true,
        claimsHeld: 1,
      });
      expect(officer.leavingSince).toEqual(expect.any(String));
      expect(data.members.find((m: { userId: string }) => m.userId === "ownerA")).toMatchObject({ role: "Owner", leaving: false, claimsHeld: 0 });
      expect(data.invitations).toEqual([{ email: { untrusted_text: "live@example.com" }, role: "Owner", expiresAt: expect.any(String) }]);
    } finally {
      await prisma.invitation.deleteMany();
      await setDeparting(OWNER_A, "officerA", false);
    }
  });

  it("is read only: after listing, the same people hold the same roles", async () => {
    const before = await prisma.membership.findMany({ orderBy: { id: "asc" }, select: { id: true, role: true, departingAt: true } });
    await callAs("ownerA", "list_members");
    await callAs("officerA", "list_members");
    expect(await prisma.membership.findMany({ orderBy: { id: "asc" }, select: { id: true, role: true, departingAt: true } })).toEqual(before);
  });

  it("pages oldest first, 50 at a time, with a cursor; a made-up cursor is refused", async () => {
    const extra = Array.from({ length: 53 }, (_, i) => `member-${String(i).padStart(2, "0")}`);
    await prisma.user.createMany({ data: extra.map((id) => ({ id, name: id, email: `${id}@example.com`, emailVerified: true })) });
    const base = Date.now() + 60_000;
    await prisma.membership.createMany({
      data: extra.map((id, i) => ({ id: `m-${id}`, workspaceId: "a", userId: id, role: "member", createdAt: new Date(base + i * 1000) })),
    });
    try {
      const first = resultJson(await callAs("officerA", "list_members"));
      expect(first.members).toHaveLength(MCP_LIST_LIMIT);
      expect(first.more).toMatch(/Only the first 50 are listed/);
      expect(first.cursor).toEqual(expect.any(String));
      const second = resultJson(await callAs("officerA", "list_members", { cursor: first.cursor }));
      // 2 seeded members plus 53, 50 on the first page.
      expect(second.members).toHaveLength(5);
      expect(second.more).toBeUndefined();
      expect(second.members.at(-1).name).toEqual({ untrusted_text: "member-52" });
      const rejected = await callAs("officerA", "list_members", { cursor: "not-a-cursor" });
      expect(rejected.isError).toBe(true);
      expect(resultText(rejected)).toMatch(/cursor is not valid/);
    } finally {
      await prisma.membership.deleteMany({ where: { id: { in: extra.map((id) => `m-${id}`) } } });
      await prisma.user.deleteMany({ where: { id: { in: extra } } });
    }
  });
});
