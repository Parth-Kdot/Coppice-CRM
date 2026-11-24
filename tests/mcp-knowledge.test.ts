import { afterAll, beforeAll, beforeEach, describe, expect, it, test } from "vitest";
import { changeStage, claimCompany, dbToday, logOutreach } from "@/lib/claims";
import { addContact, createCompany } from "@/lib/companies";
import { prisma, withTenant } from "@/lib/db";
import { addFact } from "@/lib/facts";
import { addSource } from "@/lib/research/sources";
import { startExperiment } from "@/lib/template-lab/lab";
import { createTemplate, listTemplates } from "@/lib/templates";
import { MCP_LIST_LIMIT } from "@/lib/validation";
import { activityRows, clearActivity, defineToolTables, OWNER_A, tokenCache, type ToolRow } from "./helpers/mcp-tools";
import { deleteOAuthClients, mcpClient, resultJson, resultText, restoreFetch, routeAppFetches } from "./helpers/oauth";
import { resetAndSeed } from "./helpers/seed";

// Group K of the MCP server, knowledge (facts, templates, prepare_email, research sources and
// accept_brief_item), against the real database and the official client. Nothing here calls a
// model. Seed: workspace "a" (ownerA owner, officerA officer) and "b" (ownerB owner).

const tokenFor = tokenCache();
const B = { userId: "ownerB", workspaceId: "b", role: "owner" } as const;
const OFFICER = { userId: "officerA", workspaceId: "a", role: "member" } as const;
const DAY = 24 * 60 * 60 * 1000;

async function callAs(userId: string, name: string, args: Record<string, unknown> = {}, workspaceId = "a") {
  const client = await mcpClient(await tokenFor(userId));
  return client.callTool({ name, arguments: { workspaceId, ...args } });
}
const json = async (userId: string, name: string, args: Record<string, unknown> = {}) => resultJson(await callAs(userId, name, args));
// What a refusal says: the lib's own refusals come wrapped as untrusted text (they can name people).
const said = (result: { content?: unknown; isError?: boolean }) => {
  const text = resultText(result);
  try {
    return (JSON.parse(text).error?.untrusted_text as string | undefined) ?? text;
  } catch {
    return text;
  }
};

const factRows = () => withTenant(OWNER_A, (tx) => tx.factSheetItem.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] }));
const patchCompany = (id: string, data: Record<string, unknown>) => withTenant(OWNER_A, (tx) => tx.company.update({ where: { id }, data: data as never }));
const notesOf = async (id: string) => (await withTenant(OWNER_A, (tx) => tx.company.findFirstOrThrow({ where: { id }, select: { notes: true } }))).notes;

async function company(name: string, fields: { website?: string; notes?: string } = {}) {
  const result = await createCompany(OWNER_A, { name, ...fields });
  if (result.status !== "saved") throw new Error("seed company flagged");
  return result.companyId;
}
const template = async (name: string, body = "Hi {{firstName}}, a short note from {{orgName}}.") => {
  const result = await createTemplate(OWNER_A, { name, body });
  if (!result.ok) throw new Error(result.error);
  return result.data.templateId;
};
const source = async (url: string, label: string | null = null) => {
  const result = await addSource(OWNER_A, url, label);
  if (!result.ok) throw new Error(result.error);
  return result.data.sourceId;
};

// A finished brief with two items and a team inbox, as the company page would have stored it.
async function storeBrief(companyId: string) {
  return withTenant(OWNER_A, async (tx) => {
    const brief = await tx.companyBrief.create({
      data: {
        workspaceId: "a",
        companyId,
        createdById: "officerA",
        status: "READY",
        brief: {
          items: [
            { id: "i1", door: "GIVING", title: "Community Giving Portal", detail: "Takes requests twice a year.", deadline: "March 1", page: 1, quote: "q1" },
            { id: "i2", door: "CAMPUS_RECRUITING", title: "Campus team", detail: "Runs student events.", deadline: null, page: 1, quote: "q2" },
          ],
        },
      },
      select: { id: true },
    });
    await tx.companyBriefPage.create({
      data: { workspaceId: "a", briefId: brief.id, position: 1, url: "https://acme.example.com/giving", finalUrl: "https://acme.example.com/giving", inboxes: ["giving@acme.example.com"] },
    });
    return brief.id;
  });
}

beforeAll(async () => {
  routeAppFetches();
  await resetAndSeed();
  await deleteOAuthClients();
});

beforeEach(async () => {
  await prisma.mcpRateLimit.deleteMany();
  await clearActivity();
  await withTenant(OWNER_A, (tx) => tx.company.deleteMany({ where: { workspaceId: "a" } }));
  await withTenant(B, (tx) => tx.company.deleteMany({ where: { workspaceId: "b" } }));
  await withTenant(OWNER_A, (tx) => tx.templateExperiment.deleteMany({ where: { workspaceId: "a" } }));
  await withTenant(OWNER_A, (tx) => tx.template.deleteMany({ where: { workspaceId: "a" } }));
  await withTenant(OWNER_A, (tx) => tx.factSheetItem.deleteMany({ where: { workspaceId: "a" } }));
  await withTenant(OWNER_A, (tx) => tx.factSheet.deleteMany({ where: { workspaceId: "a" } }));
  await withTenant(OWNER_A, (tx) => tx.researchSource.deleteMany({ where: { workspaceId: "a" } }));
  await prisma.workspace.update({ where: { id: "a" }, data: { aiEnabled: true, mcpEnabled: true } });
});

afterAll(async () => {
  restoreFetch();
  await deleteOAuthClients();
  await prisma.session.deleteMany();
  await clearActivity();
  await prisma.workspace.update({ where: { id: "a" }, data: { aiEnabled: false } });
  await prisma.$disconnect();
});

// ----- The shared refusal tables -----

type Ctx = { companyId: string; contactId: string; factId: string; templateId: string; sourceId: string; briefId: string };
const makeContext = async (): Promise<Ctx> => {
  const companyId = await company("Typed Name Co", { website: "https://typed.example.com" });
  const contact = await addContact(OWNER_A, companyId, { name: "Sam Lee", email: "sam@typed.example.com" });
  if (!contact.ok) throw new Error("seed");
  // Waiting for a check, so set_fact_verified has a change to make and verifying asks first.
  const fact = await addFact(OWNER_A, "Typed fact text for 600 students.", { unverified: true });
  if (!fact.ok) throw new Error("seed");
  return {
    companyId,
    contactId: contact.data.contactId,
    factId: fact.data.factId,
    templateId: await template("Typed template", "Hi {{firstName}}, Typed template body from {{orgName}}."),
    sourceId: await source("https://typed.example.com/careers", "Typed source label"),
    briefId: await storeBrief(companyId),
  };
};

const ROWS: ToolRow<Ctx>[] = [
  { name: "list_facts", kind: "read", args: () => ({}), typed: () => "Typed fact text for 600 students." },
  { name: "list_templates", kind: "read", args: () => ({}), typed: () => "Typed template" },
  {
    name: "prepare_email",
    kind: "read",
    args: (c) => ({ companyId: c.companyId, templateId: c.templateId, contactId: c.contactId }),
    typed: () => "Hi Sam, Typed template body from Org A.",
  },
  { name: "list_research_sources", kind: "read", args: () => ({}), typed: () => "Typed source label" },
  {
    name: "save_fact",
    kind: "action",
    owner: true,
    args: () => ({ text: "We were founded in 2012." }),
    activity: { tool: "save_fact", action: "added" },
  },
  {
    name: "set_fact_verified",
    kind: "action",
    owner: true,
    args: (c) => ({ factId: c.factId, verified: false }),
    confirm: { args: (c) => ({ factId: c.factId, verified: true }), says: /Verifying a fact lets drafts and claim checks use it/ },
    activity: { tool: "set_fact_verified", action: "verified", success: (c) => ({ factId: c.factId, verified: true, confirm: true }) },
  },
  {
    name: "save_template",
    kind: "action",
    owner: true,
    args: () => ({ name: "Row Template", body: "Hello {{firstName}}" }),
    activity: { tool: "save_template", action: "added" },
  },
  {
    name: "set_template_archived",
    kind: "action",
    owner: true,
    args: (c) => ({ templateId: c.templateId, archived: true }),
    activity: { tool: "set_template_archived", action: "archived" },
  },
  {
    name: "save_research_source",
    kind: "action",
    owner: true,
    args: () => ({ url: "https://example.org/jobs" }),
    activity: { tool: "save_research_source", action: "added" },
  },
  {
    name: "set_research_source_archived",
    kind: "action",
    owner: true,
    args: (c) => ({ sourceId: c.sourceId, archived: true }),
    activity: { tool: "set_research_source_archived", action: "archived" },
  },
  {
    name: "accept_brief_item",
    kind: "action",
    args: (c) => ({ companyId: c.companyId, briefId: c.briefId, itemId: "i1" }),
    activity: { tool: "accept_brief_item", action: "updated", company: true },
  },
];
defineToolTables(ROWS, { tokenFor, makeContext });

// ----- list_facts -----

describe("list_facts", () => {
  const seedMixed = async () => {
    const verified = await addFact(OWNER_A, "Verified fact.");
    const waiting = await addFact(OWNER_A, "Waiting fact.", { unverified: true });
    if (!verified.ok || !waiting.ok) throw new Error("seed");
    const pdf = await withTenant(OWNER_A, async (tx) => {
      const sheet = await tx.factSheet.create({ data: { workspaceId: "a", fileName: "packet.pdf", pageCount: 2, uploadedById: "ownerA" }, select: { id: true } });
      const item = await tx.factSheetItem.create({
        data: { workspaceId: "a", factSheetId: sheet.id, source: "PDF", text: "Draws 600 students.", quote: "We draw 600 students.", pageNumber: 2, quoteFound: true, createdById: "ownerA" },
        select: { id: true },
      });
      return { sheet: sheet.id, item: item.id };
    });
    return { verified: verified.data.factId, waiting: waiting.data.factId, pdf };
  };

  it("gives an officer the verified facts only, with no quote, page or status", async () => {
    const ids = await seedMixed();
    const data = await json("officerA", "list_facts");
    expect(data.facts.map((f: { id: string }) => f.id)).toEqual([ids.verified]);
    expect(Object.keys(data.facts[0]).sort()).toEqual(["id", "text", "verifiedAt"]);
    expect(data.files).toBeUndefined();
    expect(JSON.stringify(data)).not.toContain("Waiting fact.");
    expect(JSON.stringify(data)).not.toContain("600 students");
  });

  it("gives an owner every fact with status, quote, page, who verified, stale flag and the uploaded files", async () => {
    const ids = await seedMixed();
    await withTenant(OWNER_A, (tx) => tx.factSheetItem.update({ where: { id: ids.verified }, data: { createdAt: new Date(Date.now() - 400 * DAY), verifiedAt: new Date(Date.now() - 400 * DAY) } }));
    const data = await json("ownerA", "list_facts");
    const byId = new Map<string, Record<string, unknown>>(data.facts.map((f: { id: string }) => [f.id, f as Record<string, unknown>]));
    expect(byId.get(ids.waiting)).toMatchObject({ status: "waiting", verifiedAt: null, source: "MANUAL", stale: false });
    expect(byId.get(ids.verified)).toMatchObject({ status: "verified", stale: true, verifiedBy: { untrusted_text: "ownerA" } });
    expect(byId.get(ids.pdf.item)).toMatchObject({
      status: "waiting",
      source: "PDF",
      quote: { untrusted_text: "We draw 600 students." },
      page: 2,
      quoteFound: true,
      file: { untrusted_text: "packet.pdf" },
    });
    // Facts waiting for a check come first, as on the page.
    expect(data.facts[0].status).toBe("waiting");
    expect(data.files).toEqual([{ id: ids.pdf.sheet, fileName: { untrusted_text: "packet.pdf" }, pageCount: 2, uploadedAt: expect.any(String), uploadedBy: { untrusted_text: "ownerA" } }]);
  });

  it("flags a fact that holds a masked contact token", async () => {
    await withTenant(OWNER_A, (tx) =>
      tx.factSheetItem.create({ data: { workspaceId: "a", source: "MANUAL", text: "Write to [email] for details.", createdById: "ownerA", verifiedAt: new Date(), verifiedById: "ownerA" } }),
    );
    expect((await json("ownerA", "list_facts")).facts[0].holdsMaskedContact).toBe(true);
    // The drafter's view leaves it out, so an officer never gets it.
    expect((await json("officerA", "list_facts")).facts).toEqual([]);
  });

  it("pages 50 at a time for both views and refuses a cursor that is not ours", async () => {
    await withTenant(OWNER_A, (tx) =>
      tx.factSheetItem.createMany({
        data: Array.from({ length: 55 }, (_, i) => ({
          id: `fact-${String(i).padStart(2, "0")}`,
          workspaceId: "a",
          source: "MANUAL" as const,
          text: `Fact ${i}`,
          createdById: "ownerA",
          createdAt: new Date(Date.now() - (100 - i) * 1000),
          verifiedAt: new Date(),
          verifiedById: "ownerA",
        })),
      }),
    );
    for (const userId of ["ownerA", "officerA"]) {
      const first = await json(userId, "list_facts");
      expect(first.facts, userId).toHaveLength(MCP_LIST_LIMIT);
      expect(first.more, userId).toMatch(/Only the first 50 are listed/);
      const second = await json(userId, "list_facts", { cursor: first.cursor });
      expect(second.facts, userId).toHaveLength(5);
      expect(second.cursor).toBeUndefined();
      const all = [...first.facts, ...second.facts].map((f: { id: string }) => f.id);
      expect(new Set(all).size).toBe(55);
    }
    expect(resultText(await callAs("ownerA", "list_facts", { cursor: "nonsense" }))).toMatch(/cursor is not valid/);
  });
});

// ----- save_fact -----

describe("save_fact", () => {
  it("adds a fact saved as waiting for an owner to verify it, and says so", async () => {
    const data = await json("ownerA", "save_fact", { text: "  We were founded in 2012.  " });
    expect(data).toMatchObject({ saved: true, verified: false, note: expect.stringContaining("Saved as waiting for an owner to verify it.") });
    const [row] = await factRows();
    expect(row).toMatchObject({ id: data.factId, text: "We were founded in 2012.", source: "MANUAL", verifiedAt: null, verifiedById: null, createdById: "ownerA" });
    expect(await activityRows("a")).toMatchObject([{ tool: "save_fact", action: "added", targetId: data.factId, companyId: null }]);
  });

  it("editing a verified hand-written fact takes its verified mark off, where the app's form would keep it", async () => {
    const added = await addFact(OWNER_A, "Draws 500 students.");
    if (!added.ok) throw new Error("seed");
    expect((await factRows())[0].verifiedAt).not.toBeNull();
    const data = await json("ownerA", "save_fact", { factId: added.data.factId, text: "Draws 600 students." });
    expect(data).toMatchObject({ saved: true, verified: false, factId: added.data.factId });
    expect(await factRows()).toMatchObject([{ text: "Draws 600 students.", verifiedAt: null, verifiedById: null }]);
    expect(await activityRows("a")).toMatchObject([{ tool: "save_fact", action: "updated", targetId: added.data.factId }]);
  });

  it("editing a packet fact keeps its quote and is saved as waiting", async () => {
    const id = await withTenant(OWNER_A, async (tx) => {
      const sheet = await tx.factSheet.create({ data: { workspaceId: "a", fileName: "p.pdf", pageCount: 1, uploadedById: "ownerA" }, select: { id: true } });
      await tx.factSheetPage.create({ data: { workspaceId: "a", factSheetId: sheet.id, pageNumber: 1, text: "We draw 600 students every year." } });
      const item = await tx.factSheetItem.create({
        data: {
          workspaceId: "a",
          factSheetId: sheet.id,
          source: "PDF",
          text: "Draws 600 students.",
          quote: "We draw 600 students every year.",
          pageNumber: 1,
          quoteFound: true,
          createdById: "ownerA",
          verifiedAt: new Date(),
          verifiedById: "ownerA",
        },
        select: { id: true },
      });
      return item.id;
    });
    // The app would keep this one verified (the quote still supports the text); an assistant's edit never does.
    await json("ownerA", "save_fact", { factId: id, text: "Draws 600 students a year." });
    expect(await factRows()).toMatchObject([{ id, quote: "We draw 600 students every year.", quoteFound: true, verifiedAt: null, verifiedById: null }]);
  });

  it("uses the app's own fact rules: trimmed, not empty, no masked contact details", async () => {
    expect(resultText(await callAs("ownerA", "save_fact", { text: "   " }))).toBe("Write the fact.");
    const masked = await callAs("ownerA", "save_fact", { text: "Write to [email] for details." });
    expect(masked.isError).toBe(true);
    expect(said(masked)).toMatch(/Facts can't hold \[email\] or \[phone\]/);
    const tooLong = await callAs("ownerA", "save_fact", { text: "x".repeat(301) });
    expect(tooLong.isError).toBe(true);
    expect(await factRows()).toEqual([]);
    expect(await activityRows("a")).toEqual([]);
  });

  it("a fact that is not there, or is another workspace's, is not found", async () => {
    await withTenant(B, (tx) => tx.factSheetItem.create({ data: { id: "b-fact", workspaceId: "b", source: "MANUAL", text: "B's fact", createdById: "ownerB", verifiedAt: new Date(), verifiedById: "ownerB" } }));
    try {
      expect(said(await callAs("ownerA", "save_fact", { factId: "b-fact", text: "Mine now" }))).toBe("Fact not found.");
      expect(said(await callAs("ownerA", "save_fact", { factId: "nope", text: "Mine" }))).toBe("Fact not found.");
      expect((await withTenant(B, (tx) => tx.factSheetItem.findFirstOrThrow({ where: { id: "b-fact" } }))).text).toBe("B's fact");
    } finally {
      await withTenant(B, (tx) => tx.factSheetItem.deleteMany());
    }
  });
});

// ----- set_fact_verified -----

describe("set_fact_verified", () => {
  const waiting = async (text = "Waiting fact.") => {
    const added = await addFact(OWNER_A, text, { unverified: true });
    if (!added.ok) throw new Error("seed");
    return added.data.factId;
  };

  it("verifying needs confirm (and gives the counted call back when asking); then it verifies as the owner and writes one row", async () => {
    const id = await waiting();
    const asking = await callAs("ownerA", "set_fact_verified", { factId: id, verified: true });
    expect(resultText(asking)).toMatch(/Ask the person to confirm, then call set_fact_verified again with confirm: true\. Nothing was changed\./);
    expect(await prisma.mcpRateLimit.findMany({ where: { userId: "ownerA", kind: "action" } })).toMatchObject([{ count: 0 }]);
    expect((await factRows())[0].verifiedAt).toBeNull();
    expect(await activityRows("a")).toEqual([]);

    expect((await callAs("ownerA", "set_fact_verified", { factId: id, verified: true, confirm: true })).isError).toBeFalsy();
    expect(await factRows()).toMatchObject([{ verifiedById: "ownerA", verifiedAt: expect.any(Date) }]);
    expect(await activityRows("a")).toMatchObject([{ tool: "set_fact_verified", action: "verified", targetId: id }]);
  });

  it("a fact already in the state asked for is a no-op: changed is false, no row, and verifying again needs no confirm", async () => {
    const added = await addFact(OWNER_A, "Verified fact.");
    if (!added.ok) throw new Error("seed");
    const before = await factRows();
    const again = await json("ownerA", "set_fact_verified", { factId: added.data.factId, verified: true });
    expect(again).toMatchObject({ verified: true, changed: false });
    expect(await factRows()).toEqual(before);
    await json("ownerA", "set_fact_verified", { factId: added.data.factId, verified: false });
    const twice = await json("ownerA", "set_fact_verified", { factId: added.data.factId, verified: false });
    expect(twice).toMatchObject({ verified: false, changed: false });
    expect((await activityRows("a")).map((r) => r.action)).toEqual(["unverified"]);
  });

  it("taking the mark off needs no confirm and writes an unverified row", async () => {
    const added = await addFact(OWNER_A, "Verified fact.");
    if (!added.ok) throw new Error("seed");
    expect((await callAs("ownerA", "set_fact_verified", { factId: added.data.factId, verified: false })).isError).toBeFalsy();
    expect(await factRows()).toMatchObject([{ verifiedAt: null, verifiedById: null }]);
    expect(await activityRows("a")).toMatchObject([{ action: "unverified", targetId: added.data.factId }]);
  });

  it("refuses a fact that holds [email] or [phone], a missing fact and an officer, and writes no row", async () => {
    // The app refuses to add one, so it is inserted straight (an older fact, or an import).
    const masked = (
      await withTenant(OWNER_A, (tx) => tx.factSheetItem.create({ data: { workspaceId: "a", source: "MANUAL", text: "Call [phone] for details.", createdById: "ownerA" }, select: { id: true } }))
    ).id;
    const refused = await callAs("ownerA", "set_fact_verified", { factId: masked, verified: true, confirm: true });
    expect(said(refused)).toMatch(/holds \[email\] or \[phone\]/);
    expect(said(await callAs("ownerA", "set_fact_verified", { factId: "nope", verified: true, confirm: true }))).toBe("Fact not found.");
    const plain = await waiting();
    expect(resultText(await callAs("officerA", "set_fact_verified", { factId: plain, verified: true, confirm: true }))).toBe("Only the workspace owner can do that.");
    expect((await factRows()).every((f) => f.verifiedAt === null)).toBe(true);
    expect(await activityRows("a")).toEqual([]);
  });
});

// ----- templates -----

describe("list_templates", () => {
  it("gives an officer the active templates with their text and an owner the archived ones and use counts too", async () => {
    const live = await template("Live", "Hello {{firstName}}");
    const gone = await template("Gone", "Old text");
    await withTenant(OWNER_A, (tx) => tx.template.update({ where: { id: gone }, data: { archivedAt: new Date() } }));
    const officer = await json("officerA", "list_templates");
    expect(officer.templates).toEqual([{ id: live, name: { untrusted_text: "Live" }, body: { untrusted_text: "Hello {{firstName}}" }, experiment: null }]);
    const owner = await json("ownerA", "list_templates");
    expect(owner.templates).toMatchObject([
      { id: gone, name: { untrusted_text: "Gone" }, archived: true, uses: 0 },
      { id: live, archived: false, uses: 0 },
    ]);
  });

  it("counts how often each template was used", async () => {
    const id = await template("Used");
    const co = await company("Acme");
    await claimCompany(OWNER_A, co);
    const logged = await logOutreach(OWNER_A, co, { channel: "EMAIL", note: null, followUpOn: await dbToday(), templateId: id });
    expect(logged.ok).toBe(true);
    expect((await json("ownerA", "list_templates")).templates[0]).toMatchObject({ id, uses: 1 });
    expect((await json("officerA", "list_templates")).templates[0].uses).toBeUndefined();
  });

  it("shows the experiment arm and which one is suggested, to everyone", async () => {
    const body = "Hi {{firstName}},\n\nI'm {{senderName}} from {{orgName}}. We run a hackathon for 600 students.\n\nWould you be open to a 10 minute call this month?\n\nThanks,\n{{senderName}}\n{{orgName}}";
    const base = await template("Base", body);
    const started = await startExperiment(OWNER_A, base, [{ kind: "ask", summary: "Softer ask.", body: body.replace("Would you be open to a 10 minute call this month?", "Could we set up a short call?") }]);
    if (!started.ok) throw new Error(started.error);
    const data = await json("officerA", "list_templates");
    const arms = data.templates.map((t: { experiment: { arm: string; suggested: boolean; experimentId: string } | null }) => t.experiment);
    expect(arms.map((a: { arm: string }) => a.arm).sort()).toEqual(["A", "B"]);
    expect(arms.filter((a: { suggested: boolean }) => a.suggested)).toHaveLength(1);
    expect(arms[0].experimentId).toBe(started.data.experimentId);
  });

  it("pages with a cursor", async () => {
    await withTenant(OWNER_A, (tx) =>
      tx.template.createMany({ data: Array.from({ length: 52 }, (_, i) => ({ workspaceId: "a", name: `Template ${String(i).padStart(2, "0")}`, body: "Hi" })) }),
    );
    const first = await json("officerA", "list_templates");
    expect(first.templates).toHaveLength(50);
    expect(first.more).toMatch(/Only the first 50 are listed/);
    expect((await json("officerA", "list_templates", { cursor: first.cursor })).templates).toHaveLength(2);
  });
});

describe("save_template", () => {
  it("adds a template through the app's form rules: line breaks normalized, trimmed", async () => {
    const data = await json("ownerA", "save_template", { name: "  Warm intro  ", body: "  Hi {{firstName}},\r\nThanks.  " });
    const row = (await listTemplates(OWNER_A))[0];
    expect(row).toMatchObject({ id: data.templateId, name: "Warm intro", body: "Hi {{firstName}},\nThanks." });
    expect(await activityRows("a")).toMatchObject([{ tool: "save_template", action: "added", targetId: data.templateId }]);
  });

  it("changes a template, and refuses what the app refuses: unknown placeholders, a taken name, an archived template", async () => {
    const id = await template("First");
    await template("Second");
    expect((await callAs("ownerA", "save_template", { templateId: id, name: "First, edited", body: "New {{orgName}} text" })).isError).toBeFalsy();
    expect((await listTemplates(OWNER_A)).find((t) => t.id === id)).toMatchObject({ name: "First, edited", body: "New {{orgName}} text" });
    expect(await activityRows("a")).toMatchObject([{ action: "updated", targetId: id }]);

    expect(resultText(await callAs("ownerA", "save_template", { name: "Bad", body: "Hello {{nickname}}" }))).toMatch(/Templates can only use \{\{firstName\}\}, \{\{senderName\}\} and \{\{orgName\}\}\. Fix \{\{nickname\}\}\./);
    expect(resultText(await callAs("ownerA", "save_template", { name: "Bad", body: "Hello {{firstName" }))).toMatch(/placeholder isn't closed/);
    expect(resultText(await callAs("ownerA", "save_template", { name: "   ", body: "Hi" }))).toBe("Name the template.");
    expect(said(await callAs("ownerA", "save_template", { name: "second", body: "Hi" }))).toBe('A template is already called "second". Pick another name.');
    await withTenant(OWNER_A, (tx) => tx.template.update({ where: { id }, data: { archivedAt: new Date() } }));
    expect(said(await callAs("ownerA", "save_template", { templateId: id, name: "First again", body: "Hi" }))).toMatch(/archived/);
    expect(await activityRows("a")).toHaveLength(1);
  });

  it("keeps the body of a template in a running experiment fixed, but lets it be renamed", async () => {
    const body = "Hi {{firstName}},\n\nI'm {{senderName}} from {{orgName}}. We run a hackathon for 600 students.\n\nWould you be open to a 10 minute call this month?\n\nThanks,\n{{senderName}}\n{{orgName}}";
    const base = await template("Base", body);
    const started = await startExperiment(OWNER_A, base, [{ kind: "ask", summary: "Softer ask.", body: body.replace("Would you be open to a 10 minute call this month?", "Could we set up a short call?") }]);
    if (!started.ok) throw new Error(started.error);
    expect(said(await callAs("ownerA", "save_template", { templateId: base, name: "Base", body: "Changed" }))).toBe("End the experiment first.");
    expect((await callAs("ownerA", "save_template", { templateId: base, name: "Base renamed", body })).isError).toBeFalsy();
    expect(said(await callAs("ownerA", "set_template_archived", { templateId: base, archived: true }))).toBe("End the experiment first.");
  });
});

describe("set_template_archived", () => {
  it("archives and brings back, one row each, and a missing template is not found", async () => {
    const id = await template("Acme intro");
    expect((await callAs("ownerA", "set_template_archived", { templateId: id, archived: true })).isError).toBeFalsy();
    expect((await json("officerA", "list_templates")).templates).toEqual([]);
    expect((await callAs("ownerA", "set_template_archived", { templateId: id, archived: false })).isError).toBeFalsy();
    expect((await json("officerA", "list_templates")).templates).toHaveLength(1);
    expect((await activityRows("a")).map((r) => [r.action, r.targetId])).toEqual([["archived", id], ["unarchived", id]]);
    expect(said(await callAs("ownerA", "set_template_archived", { templateId: "nope", archived: true }))).toBe("Template not found.");
    expect(await activityRows("a")).toHaveLength(2);
  });

  it("asking for the state it already has answers changed: false, writes no row and is not an error", async () => {
    const id = await template("Acme intro");
    expect(await json("ownerA", "set_template_archived", { templateId: id, archived: false })).toMatchObject({ archived: false, changed: false });
    await json("ownerA", "set_template_archived", { templateId: id, archived: true });
    expect(await json("ownerA", "set_template_archived", { templateId: id, archived: true })).toMatchObject({ archived: true, changed: false });
    expect(await activityRows("a")).toHaveLength(1);
  });
});

// ----- prepare_email -----

describe("prepare_email", () => {
  const verifiedNumbers = async () => {
    const fact = await addFact(OWNER_A, "Our hackathon draws 600 students.");
    if (!fact.ok) throw new Error("seed");
  };

  it("fills a template with the contact's first name, the person's name and the workspace name, and sends nothing", async () => {
    const co = await company("Acme");
    const contact = await addContact(OWNER_A, co, { name: "Sam Lee" });
    if (!contact.ok) throw new Error("seed");
    const id = await template("Intro", "Hi {{firstName}},\n\nI'm {{senderName}} from {{orgName}}.\n\n{{senderName}}");
    const data = await json("officerA", "prepare_email", { companyId: co, templateId: id, contactId: contact.data.contactId });
    expect(data.text).toEqual({ untrusted_text: "Hi Sam,\n\nI'm officerA from Org A.\n\nofficerA" });
    expect(data.findings).toEqual([]);
    expect(data.note).toMatch(/Coppice sends nothing/);
    // A read: no activity row, and it counted as a read, not as a change.
    expect(await activityRows("a")).toEqual([]);
    expect(await prisma.mcpRateLimit.findMany({ where: { userId: "officerA" } })).toMatchObject([{ kind: "read", count: 1 }]);
  });

  it("greets with 'there' when no contact is given", async () => {
    const co = await company("Acme");
    const id = await template("Intro", "Hi {{firstName}}, welcome.");
    expect((await json("ownerA", "prepare_email", { companyId: co, templateId: id })).text).toEqual({ untrusted_text: "Hi there, welcome." });
  });

  it("checks the filled text with the claim rules: numbers need a verified fact, links and past sponsorship are flagged", async () => {
    await verifiedNumbers();
    const co = await company("Acme", { website: "https://acme.example.com" });
    const text = "Our hackathon draws 600 students and 1,200 visitors. See https://other.example.org and https://acme.example.com. Acme sponsored us last year.";
    const data = await json("ownerA", "prepare_email", { companyId: co, text });
    const found = data.findings.map((f: { kind: string; quote: { untrusted_text: string } }) => [f.kind, f.quote.untrusted_text]);
    expect(found).toEqual(
      expect.arrayContaining([
        ["number", "1,200"],
        ["link", "https://other.example.org"],
        ["history", expect.stringMatching(/sponsored us/i)],
      ]),
    );
    expect(found).not.toContainEqual(["number", "600"]);
    expect(found.map((f: string[]) => f[1])).not.toContain("https://acme.example.com");
    expect(data.findings[0].reason).toEqual(expect.any(String));
    expect(typeof data.findings[0].reason).toBe("string");
  });

  it("takes your own text with the placeholders filled too, and refuses an unknown placeholder", async () => {
    const co = await company("Acme");
    const data = await json("ownerA", "prepare_email", { companyId: co, text: "Hello {{firstName}} at {{orgName}}" });
    expect(data.text).toEqual({ untrusted_text: "Hello there at Org A" });
    expect(resultText(await callAs("ownerA", "prepare_email", { companyId: co, text: "Hello {{nickname}}" }))).toMatch(/Templates can only use/);
  });

  it("needs exactly one of templateId or text", async () => {
    const co = await company("Acme");
    const id = await template("Intro");
    for (const args of [{}, { templateId: id, text: "Hi" }]) {
      expect(resultText(await callAs("ownerA", "prepare_email", { companyId: co, ...args }))).toMatch(/either templateId or text/);
    }
  });

  it("refuses an archived template, a contact of another company, another workspace's company and a missing one", async () => {
    const co = await company("Acme");
    const other = await company("Other");
    const foreign = await addContact(OWNER_A, other, { name: "Not Yours" });
    if (!foreign.ok) throw new Error("seed");
    const id = await template("Intro");
    expect(resultText(await callAs("ownerA", "prepare_email", { companyId: co, text: "Hi", contactId: foreign.data.contactId }))).toBe("Contact not found.");
    expect(resultText(await callAs("ownerA", "prepare_email", { companyId: co, templateId: "nope" }))).toMatch(/Template not found, or it is archived/);
    await withTenant(OWNER_A, (tx) => tx.template.update({ where: { id }, data: { archivedAt: new Date() } }));
    expect(resultText(await callAs("ownerA", "prepare_email", { companyId: co, templateId: id }))).toMatch(/Template not found, or it is archived/);
    const theirs = await createCompany(B, { name: "Theirs" });
    if (theirs.status !== "saved") throw new Error("seed");
    expect(resultText(await callAs("ownerA", "prepare_email", { companyId: theirs.companyId, text: "Hi" }))).toBe("Company not found.");
  });

  it("is a read: a read-only token may call it", async () => {
    const co = await company("Acme");
    const client = await mcpClient(await tokenFor("ownerA", "openid offline_access coppice:read"));
    const result = await client.callTool({ name: "prepare_email", arguments: { workspaceId: "a", companyId: co, text: "Hi" } });
    expect(result.isError).toBeFalsy();
  });
});

// ----- research sources -----

describe("list_research_sources", () => {
  it("gives an owner the sources with who added them, wrapped", async () => {
    const id = await source("https://acme.example.com/careers", "Acme careers");
    const data = await json("ownerA", "list_research_sources");
    expect(data.sources).toEqual([
      { id, url: { untrusted_text: "https://acme.example.com/careers" }, label: { untrusted_text: "Acme careers" }, addedBy: { untrusted_text: "ownerA" }, addedAt: expect.any(String) },
    ]);
  });

  it("gives an officer the list only while AI is on, as Settings does", async () => {
    await source("https://acme.example.com/careers", "Acme careers");
    expect((await json("officerA", "list_research_sources")).sources).toHaveLength(1);
    await prisma.workspace.update({ where: { id: "a" }, data: { aiEnabled: false } });
    const off = await json("officerA", "list_research_sources");
    expect(off.sources).toEqual([]);
    expect(off.note).toMatch(/only while AI is on/);
    expect((await json("ownerA", "list_research_sources")).sources).toHaveLength(1);
  });
});

describe("save_research_source", () => {
  it("adds a source stored as the parsed address, with a default label from the host and path", async () => {
    const data = await json("ownerA", "save_research_source", { url: "  careers.acme.example.com/students/#top " });
    const row = await withTenant(OWNER_A, (tx) => tx.researchSource.findUniqueOrThrow({ where: { id: data.sourceId } }));
    expect(row).toMatchObject({ url: "https://careers.acme.example.com/students/", label: "careers.acme.example.com/students", addedById: "ownerA" });
    expect(data.address).toEqual({ untrusted_text: "https://careers.acme.example.com/students/" });
    expect(await activityRows("a")).toMatchObject([{ tool: "save_research_source", action: "added", targetId: data.sourceId }]);
  });

  it("refuses what the app refuses, in its words, and writes nothing", async () => {
    for (const [url, message] of [
      ["https://www.linkedin.com/company/acme", "Coppice doesn't read LinkedIn or people-search sites."],
      ["http://192.168.1.5/page", "Use the site's name, not a numeric IP address."],
      ["https://user:pass@acme.example.com/x", "Addresses with a user name or password in them are refused."],
      ["https://acme.example.com:8443/x", "Only the standard web ports are used."],
      ["ftp://acme.example.com/x", "Only http and https pages can be read."],
      ["https://intranet/x", "That isn't a public website."],
    ] as const) {
      const refused = await callAs("ownerA", "save_research_source", { url });
      expect(refused.isError, url).toBe(true);
      expect(resultText(refused), url).toBe(message);
    }
    expect(await withTenant(OWNER_A, (tx) => tx.researchSource.count())).toBe(0);
    expect(await activityRows("a")).toEqual([]);
  });

  it("refuses a page that is already listed", async () => {
    await source("https://acme.example.com/careers");
    expect(said(await callAs("ownerA", "save_research_source", { url: "acme.example.com/careers" }))).toBe("That page is already on the list.");
  });

  it("renames a source, never changes its address, and needs a label to rename", async () => {
    const id = await source("https://acme.example.com/careers", "Old label");
    expect((await callAs("ownerA", "save_research_source", { sourceId: id, label: "  New label " })).isError).toBeFalsy();
    expect((await withTenant(OWNER_A, (tx) => tx.researchSource.findUniqueOrThrow({ where: { id } }))).label).toBe("New label");
    expect(await activityRows("a")).toMatchObject([{ action: "updated", targetId: id }]);
    expect(resultText(await callAs("ownerA", "save_research_source", { sourceId: id, url: "https://acme.example.com/other", label: "x" }))).toMatch(/address cannot be changed/);
    expect(resultText(await callAs("ownerA", "save_research_source", { sourceId: id, label: "  " }))).toBe("Write a label.");
    expect(resultText(await callAs("ownerA", "save_research_source", { label: "No address" }))).toMatch(/Send the page's address/);
    expect(said(await callAs("ownerA", "save_research_source", { sourceId: "nope", label: "x" }))).toBe("Source not found.");
    expect(await activityRows("a")).toHaveLength(1);
  });
});

describe("set_research_source_archived", () => {
  it("archives a source, which leaves the list, and adding the same address again brings it back", async () => {
    const id = await source("https://acme.example.com/careers", "Careers");
    const data = await json("ownerA", "set_research_source_archived", { sourceId: id, archived: true });
    expect(data.note).toMatch(/Add the same address again/);
    expect((await json("ownerA", "list_research_sources")).sources).toEqual([]);
    expect(await withTenant(OWNER_A, (tx) => tx.researchSource.count())).toBe(1);
    expect((await callAs("ownerA", "save_research_source", { url: "https://acme.example.com/careers" })).isError).toBeFalsy();
    expect(await activityRows("a")).toMatchObject([{ action: "archived", targetId: id }, { action: "added" }]);
  });

  it("only takes archived: true, a missing source is not found, and an archived one answers changed: false without a new row", async () => {
    const id = await source("https://acme.example.com/careers");
    expect((await callAs("ownerA", "set_research_source_archived", { sourceId: id, archived: false })).isError).toBe(true);
    await callAs("ownerA", "set_research_source_archived", { sourceId: id, archived: true });
    expect(await json("ownerA", "set_research_source_archived", { sourceId: id, archived: true })).toMatchObject({ archived: true, changed: false });
    expect(said(await callAs("ownerA", "set_research_source_archived", { sourceId: "nope", archived: true }))).toBe("Source not found.");
    expect(await activityRows("a")).toHaveLength(1);
  });
});

// ----- accept_brief_item -----

describe("accept_brief_item", () => {
  let made = 0;
  const setup = async (notes = "Met them at the fair.") => {
    const id = await company(`Acme ${++made}`, { notes });
    return { id, briefId: await storeBrief(id) };
  };

  it("adds the item to the notes through the usual company edit, marks it accepted and writes one row; twice is the same as once", async () => {
    const { id, briefId } = await setup();
    const data = await json("officerA", "accept_brief_item", { companyId: id, briefId, itemId: "i1" });
    expect(data).toMatchObject({ added: true });
    expect(await notesOf(id)).toBe("Met them at the fair.\nCoppice brief, Giving portal: Community Giving Portal. Takes requests twice a year. Deadline: March 1. Source: https://acme.example.com/giving");
    const again = await json("officerA", "accept_brief_item", { companyId: id, briefId, itemId: "i1" });
    expect(again).toMatchObject({ added: false, alreadyThere: true });
    expect((await notesOf(id))?.match(/Community Giving Portal/g)).toHaveLength(1);
    expect(await activityRows("a", "officerA")).toMatchObject([{ tool: "accept_brief_item", action: "updated", companyId: id }]);
    const inbox = await json("officerA", "accept_brief_item", { companyId: id, briefId, itemId: "m1-1" });
    expect(inbox.added).toBe(true);
    expect(await notesOf(id)).toContain("Coppice brief, team inbox: giving@acme.example.com.");
  });

  it("is refused while AI is off, with the app's wording, and changes nothing", async () => {
    const { id, briefId } = await setup();
    await prisma.workspace.update({ where: { id: "a" }, data: { aiEnabled: false } });
    expect(said(await callAs("ownerA", "accept_brief_item", { companyId: id, briefId, itemId: "i1" }))).toMatch(/AI is turned off/);
    expect(await notesOf(id)).toBe("Met them at the fair.");
    expect(await activityRows("a")).toEqual([]);
  });

  it("is refused on a closed company and on an archived one", async () => {
    const closed = await setup();
    await changeStage(OWNER_A, closed.id, "DECLINED");
    expect(resultText(await callAs("ownerA", "accept_brief_item", { companyId: closed.id, briefId: closed.briefId, itemId: "i1" }))).toBe(
      "This company is Declined. Reopen it before adding research to its notes.",
    );
    const archived = await setup();
    await patchCompany(archived.id, { archivedAt: new Date() });
    expect(resultText(await callAs("ownerA", "accept_brief_item", { companyId: archived.id, briefId: archived.briefId, itemId: "i1" }))).toBe(
      "This company is archived. Unarchive it first.",
    );
    expect(await activityRows("a")).toEqual([]);
  });

  it("an officer cannot add to a company someone else holds, but an owner can", async () => {
    const { id, briefId } = await setup();
    await claimCompany(OWNER_A, id);
    const refused = await callAs("officerA", "accept_brief_item", { companyId: id, briefId, itemId: "i1" });
    expect(resultText(refused)).toBe("Someone else holds this company. Only they or an owner can add research to its notes.");
    expect(await notesOf(id)).toBe("Met them at the fair.");
    expect((await callAs("officerA", "claim_company", { companyId: id })).isError).toBe(true);

    const other = await setup();
    await claimCompany(OFFICER, other.id);
    expect((await callAs("ownerA", "accept_brief_item", { companyId: other.id, briefId: other.briefId, itemId: "i2" })).isError).toBeFalsy();
    // An officer's own claim is no obstacle, and neither is an expired one.
    const own = await setup();
    await claimCompany(OFFICER, own.id);
    expect((await callAs("officerA", "accept_brief_item", { companyId: own.id, briefId: own.briefId, itemId: "i1" })).isError).toBeFalsy();
  });

  it("refuses an item that is not in the brief, full notes, and another workspace's brief, and writes nothing", async () => {
    const { id, briefId } = await setup();
    expect(said(await callAs("ownerA", "accept_brief_item", { companyId: id, briefId, itemId: "i99" }))).toBe("That item isn't in this brief.");
    expect(said(await callAs("ownerA", "accept_brief_item", { companyId: id, briefId: "no-such-brief", itemId: "i1" }))).toBe("Brief not found.");
    await patchCompany(id, { notes: "x".repeat(4990) });
    expect(said(await callAs("ownerA", "accept_brief_item", { companyId: id, briefId, itemId: "i1" }))).toBe("The company's notes are full. Shorten them first.");
    expect(await activityRows("a")).toEqual([]);
    const theirs = await createCompany(B, { name: "Theirs" });
    if (theirs.status !== "saved") throw new Error("seed");
    expect(resultText(await callAs("ownerA", "accept_brief_item", { companyId: theirs.companyId, briefId, itemId: "i1" }))).toBe("Company not found.");
  });

  it("does not ask for a brief: there is no tool for that, and the tools never reach a model", async () => {
    const client = await mcpClient(await tokenFor("ownerA"));
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).not.toContain("request_brief");
    expect(names).not.toContain("draft_email");
  });
});

// ----- Text with a NUL character -----

test.for([
  ["save_fact", { text: "A\0B" }],
  ["save_template", { name: "Fine", body: "A\0B" }],
  ["save_template", { name: "A\0B", body: "Fine" }],
  ["save_research_source", { url: "https://acme.example.com/a\0b" }],
  ["save_research_source", { url: "https://acme.example.com/a", label: "A\0B" }],
  ["prepare_email", { companyId: "x", text: "A\0B" }],
  ["accept_brief_item", { companyId: "x", briefId: "y", itemId: "A\0B" }],
] as const)("%s refuses text with a NUL character before it reaches the database and takes no rate count", async ([name, args]) => {
  const refused = await callAs("ownerA", name, args);
  expect(refused.isError).toBe(true);
  expect(await prisma.mcpRateLimit.count()).toBe(0);
  expect(await activityRows("a")).toEqual([]);
});

// ----- Text with a lone surrogate -----

test.for([
  ["save_fact", { text: "A\ud800B" }],
  ["save_template", { name: "Fine", body: "A\ud800B" }],
  ["save_template", { name: "A\udc00B", body: "Fine" }],
  ["save_research_source", { url: "https://acme.example.com/a", label: "A\ud800B" }],
  ["prepare_email", { companyId: "x", text: "A\ud800B" }],
  ["set_template_archived", { templateId: "x\u0000", archived: true }],
] as const)("%s refuses a lone surrogate or a NUL before it reaches the database and takes no rate count", async ([name, args]) => {
  const refused = await callAs("ownerA", name, args);
  expect(refused.isError).toBe(true);
  expect(await prisma.mcpRateLimit.count()).toBe(0);
  expect(await activityRows("a")).toEqual([]);
});
