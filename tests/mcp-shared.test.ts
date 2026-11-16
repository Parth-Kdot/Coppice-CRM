import { readdirSync, readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, test } from "vitest";
import { MCP_LIMITS, returnMcpCall, takeMcpCall } from "@/lib/mcp/rate-limit";
import { BAD_CURSOR, confirmNeeded, confirmNeededLater, decodeCursor, encodeCursor, moreFields, UNTRUSTED_NOTICE } from "@/lib/mcp/tools";
import { prisma } from "@/lib/db";
import { clearActivity, tokenCache } from "./helpers/mcp-tools";
import { deleteOAuthClients, mcpClient, resultText, restoreFetch, routeAppFetches } from "./helpers/oauth";
import { resetAndSeed } from "./helpers/seed";

// What every MCP tool shares (lib/mcp/tools/shared.ts) and rules every tool must keep, checked on
// the list the official client gets: no model calls, capped and described arguments, short
// descriptions, one set of instructions.

const tokenFor = tokenCache();

beforeAll(async () => {
  routeAppFetches();
  await resetAndSeed();
  await deleteOAuthClients();
});

afterAll(async () => {
  restoreFetch();
  await deleteOAuthClients();
  await prisma.session.deleteMany();
  await clearActivity();
  await prisma.$disconnect();
});

describe("list cursors", () => {
  it("round trip, and no cursor means the first page", () => {
    for (const offset of [0, 1, 50, 9_999, 10_000]) expect(decodeCursor(encodeCursor(offset))).toBe(offset);
    expect(decodeCursor(undefined)).toBe(0);
    expect(decodeCursor("")).toBe(0);
  });

  test.for([
    ["not base64 of ours", "garbage"],
    ["another prefix", Buffer.from("rows:5").toString("base64url")],
    ["a negative offset", Buffer.from("offset:-5").toString("base64url")],
    ["a leading zero", Buffer.from("offset:05").toString("base64url")],
    ["a decimal", Buffer.from("offset:1.5").toString("base64url")],
    ["past the largest offset", encodeCursor(10_001)],
    ["six digits", Buffer.from("offset:100000").toString("base64url")],
    ["padding added", `${encodeCursor(5)}=`],
    ["standard base64 characters", Buffer.from("offset:5??").toString("base64")],
  ] as const)("refuses %s", ([, cursor]) => {
    expect(decodeCursor(cursor)).toBeNull();
  });

  it("the more fields appear only when there is more, and the cursor is the next offset", () => {
    expect(moreFields(false, 0, 50, "Narrow it.")).toEqual({});
    const more = moreFields(true, 50, 50, "Narrow it.");
    expect(more.more).toBe("Only the first 50 are listed. Narrow it. Or call again with this cursor for the next 50.");
    expect(decodeCursor(more.cursor)).toBe(100);
    expect(BAD_CURSOR).toMatch(/not valid/);
  });
});

describe("confirm answers", () => {
  it("say what would happen, ask the assistant to ask the person, and say nothing was changed", () => {
    const answer = confirmNeeded("delete_permanently", "This deletes the contact for good.");
    expect(answer.isError).toBe(true);
    expect(answer.content[0].text).toBe("This deletes the contact for good. Ask the person to confirm, then call delete_permanently again with confirm: true. Nothing was changed.");
  });

  it("the later form gives the counted action back, never below zero", async () => {
    await prisma.mcpRateLimit.deleteMany();
    await takeMcpCall("ownerA", "action");
    await takeMcpCall("ownerA", "action");
    const principal = { userId: "ownerA", clientId: "c", scopes: new Set(["coppice:read", "coppice:write"]) };
    expect((await confirmNeededLater(principal, "end_experiment", "This ends it.")).isError).toBe(true);
    const row = await prisma.mcpRateLimit.findFirstOrThrow({ where: { userId: "ownerA", kind: "action" } });
    expect(row.count).toBe(1);
    await returnMcpCall("ownerA", "action");
    await returnMcpCall("ownerA", "action");
    expect((await prisma.mcpRateLimit.findFirstOrThrow({ where: { userId: "ownerA", kind: "action" } })).count).toBe(0);
    await prisma.mcpRateLimit.deleteMany();
  });
});

describe("limits", () => {
  it("allows 60 reads and 30 changes a minute per person", () => {
    expect(MCP_LIMITS).toEqual({ read: 60, action: 30 });
  });
});

describe("no tool asks a model for anything", () => {
  it("lib/mcp/tools never calls runAi or generate, or imports the provider client", () => {
    const dir = "lib/mcp/tools";
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
    expect(files).toEqual(expect.arrayContaining(["shared.ts", "workspace.ts", "companies.ts", "contacts.ts", "knowledge.ts", "stats.ts", "handoff.ts", "import.ts"]));
    for (const file of files) {
      const source = readFileSync(`${dir}/${file}`, "utf8");
      expect(source, file).not.toMatch(/\brunAi\b|\bgenerate\(|@\/lib\/ai\/client|\bdraftEmail\b|\brequestBrief\b|\bchunkRead|\bsuggestColumns\b|\bproposeVariants\b|\bexplainStats\b|\baskArchive\b|\buploadFactSheet\b/);
    }
  });
});

describe("the list every connected assistant gets", () => {
  type Schema = { type?: string; properties?: Record<string, Schema>; items?: Schema; enum?: unknown[]; format?: string; maxLength?: number; maxItems?: number; description?: string; anyOf?: Schema[]; oneOf?: Schema[]; const?: unknown };

  // Every string has a cap (an enum, a date or a uuid is bounded by its form), every array a
  // maximum, and every field says what it is for.
  function problems(schema: Schema, path: string): string[] {
    const found: string[] = [];
    const bounded = schema.enum !== undefined || schema.const !== undefined || schema.format === "date" || schema.format === "uuid";
    if (schema.type === "string" && !bounded && schema.maxLength === undefined) found.push(`${path} has no maxLength`);
    if (schema.type === "array" && schema.maxItems === undefined) found.push(`${path} has no maxItems`);
    if (schema.type === "array" && schema.items) found.push(...problems(schema.items, `${path}[]`));
    for (const [name, child] of Object.entries(schema.properties ?? {})) {
      if (!child.description) found.push(`${path}.${name} has no description`);
      found.push(...problems(child, `${path}.${name}`));
    }
    for (const branch of [...(schema.anyOf ?? []), ...(schema.oneOf ?? [])]) found.push(...problems(branch, path));
    return found;
  }

  it("every tool has a short plain description, capped and described arguments, and says it reaches nothing outside Coppice", async () => {
    const { tools } = await (await mcpClient(await tokenFor("ownerA"))).listTools();
    expect(tools.length).toBeGreaterThanOrEqual(10);
    const all: string[] = [];
    for (const tool of tools) {
      expect(tool.description?.length ?? 0, `${tool.name} description`).toBeGreaterThan(20);
      expect(tool.description?.length ?? 0, `${tool.name} description`).toBeLessThanOrEqual(330);
      expect(tool.description, tool.name).not.toMatch(/[—–→]|->| \+ | = /);
      expect(tool.description, tool.name).not.toMatch(/Claude|Anthropic/i);
      expect(tool.annotations?.openWorldHint, tool.name).toBe(false);
      expect(typeof tool.annotations?.readOnlyHint, tool.name).toBe("boolean");
      const schema = tool.inputSchema as Schema;
      expect(schema.properties?.workspaceId ?? tool.name === "list_workspaces", `${tool.name} takes workspaceId`).toBeTruthy();
      all.push(...problems(schema, tool.name));
      if (schema.properties?.confirm) expect(schema.properties.confirm.type, `${tool.name} confirm`).toBe("boolean");
    }
    expect(all).toEqual([]);
  });

  it("the instructions tell the assistant to ask first, that Coppice sends no email, and that logging records what the person did", async () => {
    const client = await mcpClient(await tokenFor("ownerA"));
    const text = client.getInstructions() ?? "";
    expect(text).toContain("Ask the person before anything marked destructive or that needs confirm: true");
    expect(text).toContain("Coppice sends no email itself");
    expect(text).toContain("logging outreach records what the person did");
    expect(text).toContain(UNTRUSTED_NOTICE);
    expect(text).toContain("Ask before moving a company to COMMITTED or DECLINED.");
  });

  it("a tool call the schema refuses is turned back before it reaches Coppice", async () => {
    const client = await mcpClient(await tokenFor("ownerA"));
    const refused = await client.callTool({ name: "get_workspace", arguments: {} });
    expect(refused.isError).toBe(true);
    expect(resultText(refused)).toMatch(/workspaceId/);
  });
});
