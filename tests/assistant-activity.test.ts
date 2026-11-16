import { afterAll, beforeEach, describe, expect, it, test, vi } from "vitest";
import { prisma, withTenant, type Tenant } from "@/lib/db";
import { ACTIVITY_ACTIONS, ACTIVITY_FALLBACK, ACTIVITY_LINES, OWNER_ONLY_TOOLS, activityLine } from "@/lib/mcp/activity";
import { recordActivity, type McpPrincipal } from "@/lib/mcp/tools";
import { clearActivity } from "./helpers/mcp-tools";
import { resetAndSeed } from "./helpers/seed";

// The activity log of what assistants changed (the AssistantActivity table): its row-level
// security in the style of tests/rls.test.ts, its fixed vocabulary, and the recorder that writes it.

const A: Tenant = { userId: "ownerA", workspaceId: "a" };
const OFFICER_A: Tenant = { userId: "officerA", workspaceId: "a" };
const B: Tenant = { userId: "ownerB", workspaceId: "b" };
const principal = (userId: string): McpPrincipal => ({ userId, clientId: "client-1", scopes: new Set(["coppice:read", "coppice:write"]) });

const row = (tenant: Tenant, fields: Record<string, unknown> = {}) => ({
  workspaceId: tenant.workspaceId,
  userId: tenant.userId,
  clientId: "client-1",
  tool: "claim_company",
  action: "claimed",
  ...fields,
});
const add = (tenant: Tenant, fields: Record<string, unknown> = {}) =>
  withTenant(tenant, (tx) => tx.assistantActivity.create({ data: row(tenant, fields) as never, select: { id: true } }));
const visible = (tenant: Tenant) => withTenant(tenant, (tx) => tx.assistantActivity.findMany({ select: { id: true, userId: true } }));

beforeEach(async () => {
  await resetAndSeed();
  await clearActivity();
  await withTenant(A, (tx) => tx.company.create({ data: { id: "co-a", workspaceId: "a", name: "Acme", nameKey: "acme" } }));
  await withTenant(B, (tx) => tx.company.create({ data: { id: "co-b", workspaceId: "b", name: "Beta", nameKey: "beta" } }));
});

afterAll(async () => {
  await clearActivity();
  await prisma.$disconnect();
});

describe("row-level security", () => {
  it("every member reads their workspace's rows, and another workspace sees none of them", async () => {
    const mine = await add(A);
    const officers = await add(OFFICER_A);
    expect((await visible(A)).map((r) => r.id).sort()).toEqual([mine.id, officers.id].sort());
    expect((await visible(OFFICER_A)).map((r) => r.id).sort()).toEqual([mine.id, officers.id].sort());
    expect(await visible(B)).toEqual([]);
    // B's owner asking for workspace a is not a member of it, so the rows stay hidden.
    expect(await visible({ userId: "ownerB", workspaceId: "a" })).toEqual([]);
  });

  it("without withTenant the table looks empty and writes are refused", async () => {
    await add(A);
    expect(await prisma.assistantActivity.count()).toBe(0);
    await expect(prisma.assistantActivity.create({ data: row(A) as never })).rejects.toThrow(/row-level security/);
  });

  it("a row cannot be added to another workspace", async () => {
    // As a member of b, a row naming workspace a.
    await expect(add(B, { workspaceId: "a" })).rejects.toThrow(/row-level security/);
    // As a person who is not in b, asking for b.
    await expect(add({ userId: "ownerA", workspaceId: "b" })).rejects.toThrow(/row-level security/);
    expect(await visible(A)).toEqual([]);
    expect(await visible(B)).toEqual([]);
  });

  it("a member cannot add a row for someone else", async () => {
    await expect(add(OFFICER_A, { userId: "ownerA" })).rejects.toThrow(/row-level security/);
    expect(await visible(A)).toEqual([]);
  });

  it("a row cannot point at another workspace's company, but can point at its own", async () => {
    await expect(add(A, { companyId: "co-b" })).rejects.toThrow(/row-level security/);
    await expect(add(A, { companyId: "co-a" })).resolves.toMatchObject({ id: expect.any(String) });
  });

  it("rows are never changed or removed by the app", async () => {
    const made = await add(A);
    await expect(withTenant(A, (tx) => tx.assistantActivity.update({ where: { id: made.id }, data: { tool: "x" } }))).rejects.toThrow(/permission denied/);
    await expect(withTenant(A, (tx) => tx.assistantActivity.delete({ where: { id: made.id } }))).rejects.toThrow(/permission denied/);
    expect(await visible(A)).toHaveLength(1);
  });

  it("a deleted company keeps its rows with no company; a deleted workspace takes its rows with it", async () => {
    await add(A, { companyId: "co-a" });
    await add(B, { companyId: "co-b" });
    await withTenant(A, (tx) => tx.company.delete({ where: { id: "co-a" } }));
    expect(await withTenant(A, (tx) => tx.assistantActivity.findMany({ select: { companyId: true } }))).toEqual([{ companyId: null }]);
    await prisma.workspace.delete({ where: { id: "b" } });
    expect(await visible(A)).toHaveLength(1);
    await prisma.workspace.delete({ where: { id: "a" } });
    expect(await prisma.workspace.count()).toBe(0);
  });

  it("a person who has rows cannot be deleted, so history keeps its author", async () => {
    await add(A);
    await expect(prisma.user.delete({ where: { id: "ownerA" } })).rejects.toThrow();
  });

  it("an assistant that is later disconnected keeps its history: the client id is not a foreign key", async () => {
    const made = await add(A, { clientId: "client-that-no-longer-exists" });
    expect(await withTenant(A, (tx) => tx.assistantActivity.findUniqueOrThrow({ where: { id: made.id }, select: { clientId: true } }))).toEqual({
      clientId: "client-that-no-longer-exists",
    });
  });
});

describe("the fixed vocabulary", () => {
  it("the action keys in code are exactly the ones the table accepts", async () => {
    const [{ def }] = await prisma.$queryRaw<{ def: string }[]>`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'AssistantActivity_action_check'`;
    const inTable = [...def.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]);
    expect(inTable.sort()).toEqual([...ACTIVITY_ACTIONS].sort());
  });

  it("the table refuses an action that is not on the list, and a tool name that is empty or too long", async () => {
    await expect(add(A, { action: "free text from a person" })).rejects.toThrow(/AssistantActivity_action_check/);
    await expect(add(A, { tool: "" })).rejects.toThrow(/AssistantActivity_lengths_check/);
    await expect(add(A, { tool: "t".repeat(65) })).rejects.toThrow(/AssistantActivity_lengths_check/);
    await expect(add(A, { targetId: "t".repeat(65) })).rejects.toThrow(/AssistantActivity_lengths_check/);
  });

  it("every (tool, action) pair in the display table uses an action key from the list", () => {
    const allowed = new Set<string>(ACTIVITY_ACTIONS);
    for (const [tool, lines] of Object.entries(ACTIVITY_LINES)) {
      for (const [action, found] of Object.entries(lines)) {
        expect(allowed.has(action), `${tool} ${action}`).toBe(true);
        expect(found?.verb.length, `${tool} ${action}`).toBeGreaterThan(0);
      }
    }
  });

  test.for([
    ["claim_company", "claimed", "claimed"],
    ["set_company_archived", "unarchived", "unarchived"],
    ["delete_permanently", "deleted_fact", "deleted"],
    // Unknown pairs, and names that exist on every object, read as the plain fallback.
    ["claim_company", "deleted_fact", ACTIVITY_FALLBACK.verb],
    ["a_tool_from_a_later_version", "done", ACTIVITY_FALLBACK.verb],
    ["constructor", "claimed", ACTIVITY_FALLBACK.verb],
    ["claim_company", "toString", ACTIVITY_FALLBACK.verb],
  ] as const)("the line for %s and %s starts with %s", ([tool, action, verb]) => {
    expect(activityLine(tool, action).verb).toBe(verb);
  });

  it("a leaving mark names the member after the verb, and the leaving tools are the ones only owners are shown", () => {
    expect(activityLine("set_departing", "departing_set")).toEqual({ verb: "marked", target: "member", after: " as leaving" });
    expect(activityLine("set_departing", "departing_cleared")).toEqual({ verb: "cleared the leaving mark for", target: "member" });
    expect([...OWNER_ONLY_TOOLS].sort()).toEqual(["release_departing_claims", "set_departing"]);
    for (const tool of OWNER_ONLY_TOOLS) expect(ACTIVITY_LINES[tool], tool).toBeDefined();
  });

  it("the display wording follows the writing rules: no dashes, arrows or shorthand", () => {
    const words = Object.values(ACTIVITY_LINES).flatMap((lines) => Object.values(lines).map((l) => l?.verb ?? ""));
    for (const verb of words) expect(verb).not.toMatch(/[—–→+=]|->/);
  });
});

describe("the recorder", () => {
  it("writes one row as the person, with the assistant's client id and no text", async () => {
    await recordActivity(principal("officerA"), { ...OFFICER_A, role: "member" }, { tool: "log_outreach", action: "logged", companyId: "co-a" });
    const rows = await withTenant(A, (tx) => tx.assistantActivity.findMany());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ workspaceId: "a", userId: "officerA", clientId: "client-1", tool: "log_outreach", action: "logged", companyId: "co-a", targetId: null });
    // The time is the database's clock.
    expect(Math.abs(rows[0].createdAt.getTime() - Date.now())).toBeLessThan(60_000);
  });

  it("never throws: a row the table refuses is logged and the caller carries on", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(
        recordActivity(principal("ownerA"), { ...A, role: "owner" }, { tool: "claim_company", action: "not_a_real_action" as never }),
      ).resolves.toBeUndefined();
      await expect(
        recordActivity(principal("ownerA"), { userId: "ownerA", workspaceId: "b", role: "owner" }, { tool: "claim_company", action: "claimed" }),
      ).resolves.toBeUndefined();
      expect(quiet).toHaveBeenCalledTimes(2);
      expect(quiet.mock.calls[0][0]).toBe("MCP activity not recorded");
    } finally {
      quiet.mockRestore();
    }
    expect(await visible(A)).toEqual([]);
    expect(await visible(B)).toEqual([]);
  });
});
