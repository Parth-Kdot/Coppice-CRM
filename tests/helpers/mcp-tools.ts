import { Client } from "pg";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { Membership } from "@/lib/authz";
import { prisma, withTenant } from "@/lib/db";
import type { ActivityAction } from "@/lib/mcp/activity";
import { MCP_OFF, NOT_A_MEMBER, UNTRUSTED_NOTICE } from "@/lib/mcp/tools";
import { OWNERS_ONLY } from "@/lib/messages";
import { testDatabaseUrls } from "../test-db";
import { getAccessToken, mcpClient, resultText } from "./oauth";

// The shared tests every MCP tool must pass, driven by one table per test file. A file lists its
// tools as rows (ToolRow) and calls defineToolTables(); the harness then registers one test for
// every row of each table, never one test that calls every tool, so no row can reach the
// per-minute rate limit (beforeEach clears McpRateLimit).
//
// The seed is tests/helpers/seed.ts: workspace "a" (ownerA owner, officerA officer) and "b"
// (ownerB). A row's args are everything except workspaceId.
//
// To add a tool to a file's tables: add one row. Set `kind`, `args` (valid arguments for a call
// that reaches the tool), and then whichever of these apply:
//   owner     the tool is owner only: an officer must get the app's OWNERS_ONLY wording
//   typed     a string the file seeded that the answer returns: it must appear only inside untrusted_text
//   confirm   arguments without confirm and the sentence the refusal must contain
//   activity  the (tool, action) key a successful call records, with `success` arguments for a call
//             that goes through (defaults to args); exactly one row is written for it

export const ALL_SCOPES = "openid offline_access coppice:read coppice:write";
export const OWNER_A: Membership = { userId: "ownerA", workspaceId: "a", role: "owner" };

export type ToolRow<C> = {
  name: string;
  kind: "read" | "action";
  owner?: boolean;
  args: (ctx: C) => Record<string, unknown> | Promise<Record<string, unknown>>;
  typed?: (ctx: C) => string;
  confirm?: { args: (ctx: C) => Record<string, unknown> | Promise<Record<string, unknown>>; says: RegExp };
  activity?: { tool: string; action: ActivityAction; company?: boolean; success?: (ctx: C) => Record<string, unknown> | Promise<Record<string, unknown>> };
};

// One token for each person and scope for the whole file: getting one takes four requests.
export function tokenCache() {
  const tokens = new Map<string, string>();
  return async function tokenFor(userId: string, scope = ALL_SCOPES): Promise<string> {
    const key = `${userId} ${scope}`;
    if (!tokens.has(key)) tokens.set(key, (await getAccessToken(userId, { scope })).accessToken);
    return tokens.get(key) as string;
  };
}

export const setMcp = (workspaceId: string, mcpEnabled: boolean) => prisma.workspace.update({ where: { id: workspaceId }, data: { mcpEnabled } });

// The activity rows of a workspace, read the way the app reads them (as a member of it).
export const activityRows = (workspaceId: string, userId = "ownerA") =>
  withTenant({ userId, workspaceId }, (tx) => tx.assistantActivity.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] }));
// The app can only add activity rows (no update or delete policy), so a test that needs an empty
// log clears it as the database owner. Call it in a beforeEach.
export async function clearActivity() {
  const owner = new Client({ connectionString: testDatabaseUrls().ownerUrl });
  await owner.connect();
  try {
    await owner.query('TRUNCATE "AssistantActivity"');
  } finally {
    await owner.end();
  }
}
export const activityCount = async (workspaceId: string) => (await activityRows(workspaceId)).length;

type Setup<C> = { tokenFor: ReturnType<typeof tokenCache>; makeContext: () => Promise<C> };

export function defineToolTables<C>(rows: ToolRow<C>[], { tokenFor, makeContext }: Setup<C>) {
  const call = async (userId: string, row: ToolRow<C>, workspaceId: string, args: Record<string, unknown>, scope?: string) => {
    const client = await mcpClient(await tokenFor(userId, scope));
    return client.callTool({ name: row.name, arguments: { workspaceId, ...args } });
  };
  const actions = rows.filter((r) => r.kind === "action");

  describe("shared refusals", () => {
    beforeEach(async () => {
      await prisma.mcpRateLimit.deleteMany();
      await clearActivity();
      await setMcp("a", true);
      await setMcp("b", true);
    });
    afterEach(async () => {
      await setMcp("a", true);
    });

    test.for(rows)("$name refuses a workspace you are not in, and one that does not exist", async (row) => {
      const ctx = await makeContext();
      const before = await activityCount("b");
      for (const workspaceId of ["b", "no-such-workspace"]) {
        const result = await call("ownerA", row, workspaceId, await row.args(ctx));
        expect(result.isError, `${row.name} in ${workspaceId}`).toBe(true);
        expect(resultText(result), `${row.name} in ${workspaceId}`).toBe(NOT_A_MEMBER);
      }
      expect(await activityCount("b")).toBe(before);
      expect(await activityCount("a")).toBe(0);
    });

    test.for(rows)("$name says so when assistants are turned off", async (row) => {
      const ctx = await makeContext();
      await setMcp("a", false);
      const result = await call("ownerA", row, "a", await row.args(ctx));
      expect(result.isError).toBe(true);
      expect(resultText(result)).toBe(MCP_OFF);
      expect(await activityCount("a")).toBe(0);
    });

    test.for(actions)("$name with a read-only token gets the step-up challenge and changes nothing", async (row) => {
      const ctx = await makeContext();
      await expect(call("ownerA", row, "a", await row.args(ctx), "coppice:read")).rejects.toThrow(/scope/i);
      expect(await activityCount("a")).toBe(0);
    });

    test.for(rows.filter((r) => r.owner))("$name gives an officer the owners-only answer", async (row) => {
      const ctx = await makeContext();
      const result = await call("officerA", row, "a", await row.args(ctx));
      expect(result.isError).toBe(true);
      expect(resultText(result)).toBe(OWNERS_ONLY.error);
      expect(await activityCount("a")).toBe(0);
    });

    test.for(rows.filter((r) => r.typed))("$name returns typed text only inside untrusted_text", async (row) => {
      const ctx = await makeContext();
      const typed = (row.typed as NonNullable<ToolRow<C>["typed"]>)(ctx);
      const result = await call("ownerA", row, "a", await row.args(ctx));
      const text = resultText(result);
      expect(JSON.parse(text).notice, row.name).toBe(UNTRUSTED_NOTICE);
      const wrapped = `"untrusted_text": ${JSON.stringify(typed)}`;
      expect(text.split(JSON.stringify(typed)).length - 1, row.name).toBeGreaterThan(0);
      // Every appearance of the text is the value of an untrusted_text key.
      expect(text.split(JSON.stringify(typed)).length - 1, row.name).toBe(text.split(wrapped).length - 1);
    });

    test.for(rows.filter((r) => r.confirm))("$name asks for confirm first, says what would happen and changes nothing", async (row) => {
      const ctx = await makeContext();
      const confirm = row.confirm as NonNullable<ToolRow<C>["confirm"]>;
      const result = await call("ownerA", row, "a", await confirm.args(ctx));
      expect(result.isError).toBe(true);
      const text = resultText(result);
      expect(text).toMatch(confirm.says);
      expect(text).toContain("confirm: true");
      expect(text).toContain("Nothing was changed.");
      expect(await activityCount("a")).toBe(0);
    });

    test.for(rows.filter((r) => r.activity))("$name writes exactly one activity row when it succeeds", async (row) => {
      const ctx = await makeContext();
      const activity = row.activity as NonNullable<ToolRow<C>["activity"]>;
      const args = await (activity.success ?? row.args)(ctx);
      const result = await call("ownerA", row, "a", args);
      expect(result.isError, `${row.name}: ${resultText(result)}`).toBeFalsy();
      const written = await activityRows("a");
      expect(written).toHaveLength(1);
      expect(written[0]).toMatchObject({ workspaceId: "a", userId: "ownerA", tool: activity.tool, action: activity.action });
      expect(written[0].clientId).toEqual(expect.any(String));
      if (activity.company) expect(written[0].companyId).toEqual(expect.any(String));
    });
  });
}
