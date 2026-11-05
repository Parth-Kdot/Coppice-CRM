import { afterAll, afterEach, beforeEach, describe, expect, it, test, vi } from "vitest";
import { logOutreach as logOutreachAction, markReply as markReplyAction, moveStage } from "@/app/(app)/[workspaceId]/companies/actions";
import { draftEmail as draftAction } from "@/app/(app)/[workspaceId]/companies/draft-actions";
import { archiveTemplate, createTemplate, unarchiveTemplate, updateTemplate } from "@/app/(app)/[workspaceId]/settings/template-actions";
import type { Membership } from "@/lib/authz";
import { claimCompany, dbToday, logOutreach, markReply } from "@/lib/claims";
import { createCompany } from "@/lib/companies";
import { addDays } from "@/lib/dates";
import { prisma, withTenant } from "@/lib/db";
import { addFact } from "@/lib/facts";
import { placeholderProblem } from "@/lib/placeholders";
import * as templates from "@/lib/templates";
import { templateFieldsSchema } from "@/lib/validation";
import { form, redirectTo } from "./helpers/form";
import { answer, calls, fakeGemini } from "./helpers/gemini";
import { asUser, signedOut } from "./helpers/next-request";
import { resetAndSeed } from "./helpers/seed";

// Templates (Milestone 5), the template picked when logging outreach, and "Which outreach got the
// reply?". Real server actions and the real database as app_user; only Next.js's request APIs and
// the Gemini HTTP calls are swapped.
vi.mock("next/headers", () => import("./helpers/next-request"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const OWNER: Membership = { userId: "ownerA", workspaceId: "a", role: "owner" };
const OFFICER: Membership = { userId: "officerA", workspaceId: "a", role: "member" };
const OTHER_ORG: Membership = { userId: "ownerB", workspaceId: "b", role: "owner" };
const OK = { ok: true, data: undefined };
const NOT_OK = { ok: false, error: expect.any(String) };
const BODY = "Hi {{firstName}},\n\nOur hackathon is in March.\n\n{{senderName}}\n{{orgName}}";

const template = async (owner: Membership, name: string, body = BODY) => {
  const result = await templates.createTemplate(owner, { name, body });
  if (!result.ok) throw new Error(result.error);
  return result.data.templateId;
};
const templateRow = (id: string, tenant: Membership = OWNER) =>
  withTenant(tenant, (tx) => tx.template.findUnique({ where: { id }, select: { name: true, body: true, archivedAt: true } }));
const company = async (name = "Globex") => {
  const result = await createCompany(OWNER, { name, industry: "Energy" });
  if (result.status !== "saved") throw new Error("seed company flagged");
  return result.companyId;
};
const outreachRows = (companyId: string) =>
  withTenant(OWNER, (tx) => tx.outreach.findMany({ where: { companyId }, select: { id: true, templateId: true, gotReply: true }, orderBy: { sentAt: "asc" } }));
const followUp = async () => addDays(await dbToday(), 7);
// Tests may set a stage directly (raw SQL is allowed in tests); the app moves stages through lib/claims.ts.
const setStage = (id: string, stage: string) => withTenant(OWNER, (tx) => tx.$executeRaw`UPDATE "Company" SET stage = ${stage}::"Stage" WHERE id = ${id}`);

beforeEach(resetAndSeed);

afterAll(async () => {
  await prisma.$disconnect();
});

describe("template placeholders", () => {
  test.each([
    ["the three placeholders", BODY],
    ["spaces inside the braces", "Hi {{ firstName }}, from {{senderName }}"],
    ["no placeholders at all", "Hello there, we'd love to talk."],
    ["single braces, which are just text", "Use {curly} braces {freely}"],
  ])("accepts %s", (_label, body) => {
    expect(placeholderProblem(body)).toBeNull();
    expect(templateFieldsSchema.safeParse({ name: "T", body }).success).toBe(true);
  });

  test.each([
    ["an unknown name", "Hi {{name}}", "Fix {{name}}."],
    ["the wrong case", "Hi {{FirstName}}", "Fix {{FirstName}}."],
    ["an empty placeholder", "Hi {{}}", "Fix {{}}."],
    ["several unknown ones, each listed once", "{{company}} and {{name}} and {{company}}", "Fix {{company}}, {{name}}."],
    ["an unclosed one", "Hi {{firstName", "A placeholder isn't closed. Write it like {{firstName}}."],
    ["a stray closing", "Hi firstName}}", "A placeholder isn't closed. Write it like {{firstName}}."],
  ])("refuses %s with a clear message", (_label, body, message) => {
    expect(placeholderProblem(body)).toContain(message);
    const parsed = templateFieldsSchema.safeParse({ name: "T", body });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0].message).toContain(message);
  });

  it("names the allowed placeholders in the message", () => {
    expect(placeholderProblem("{{x}}")).toBe("Templates can only use {{firstName}}, {{senderName}} and {{orgName}}. Fix {{x}}.");
  });

  test.each([
    [{ name: "  ", body: BODY }, "Name the template."],
    [{ name: "x".repeat(81), body: BODY }, "A name can be at most 80 characters."],
    [{ name: "T", body: "   " }, "Write the template."],
    [{ name: "T", body: "x".repeat(5001) }, "A template can be at most 5000 characters."],
  ])("refuses %j", (fields, message) => {
    expect(templateFieldsSchema.safeParse(fields).error?.issues[0].message).toBe(message);
  });

  it("stores browser line breaks (CRLF) as plain LF, trimmed", () => {
    expect(templateFieldsSchema.parse({ name: " Intro ", body: "  Hi {{firstName}},\r\n\r\nThanks\r\n" })).toEqual({ name: "Intro", body: "Hi {{firstName}},\n\nThanks" });
  });
});

describe("template actions", () => {
  const as = (user: string, run: () => Promise<unknown>) => asUser(user, run);
  const fields = (extra: Record<string, string>) => form({ workspaceId: "a", name: "Alumni angle", body: BODY, ...extra });

  it("an owner creates, edits, archives and unarchives a template", async () => {
    expect(await as("ownerA", () => createTemplate(null, fields({})))).toEqual(OK);
    const [created] = await templates.listTemplates(OWNER);
    expect(created).toMatchObject({ name: "Alumni angle", body: BODY, archivedAt: null, uses: 0 });

    expect(await as("ownerA", () => updateTemplate(null, fields({ templateId: created.id, name: "Alumni, v2", body: "Hi {{firstName}}" })))).toEqual(OK);
    expect(await templateRow(created.id)).toMatchObject({ name: "Alumni, v2", body: "Hi {{firstName}}" });

    expect(await as("ownerA", () => archiveTemplate(null, form({ workspaceId: "a", templateId: created.id })))).toEqual(OK);
    expect((await templateRow(created.id))?.archivedAt).toBeInstanceOf(Date);
    expect(await templates.activeTemplates(OWNER)).toEqual([]);
    // Archived templates stay listed in Settings.
    expect(await templates.listTemplates(OWNER)).toHaveLength(1);

    expect(await as("ownerA", () => unarchiveTemplate(null, form({ workspaceId: "a", templateId: created.id })))).toEqual(OK);
    expect((await templateRow(created.id))?.archivedAt).toBeNull();
  });

  it("an officer can read templates but not manage them", async () => {
    const id = await template(OWNER, "Alumni angle");
    expect(await templates.activeTemplates(OFFICER)).toEqual([{ id, name: "Alumni angle", body: BODY }]);
    const refused = { ok: false, error: "Only the workspace owner can do that." };
    expect(await as("officerA", () => createTemplate(null, fields({ name: "Mine" })))).toEqual(refused);
    expect(await as("officerA", () => updateTemplate(null, fields({ templateId: id, name: "Hacked" })))).toEqual(refused);
    expect(await as("officerA", () => archiveTemplate(null, form({ workspaceId: "a", templateId: id })))).toEqual(refused);
    await templates.archiveTemplate(OWNER, id);
    expect(await as("officerA", () => unarchiveTemplate(null, form({ workspaceId: "a", templateId: id })))).toEqual(refused);
    expect(await templates.listTemplates(OWNER)).toMatchObject([{ id, name: "Alumni angle", archivedAt: expect.any(Date) }]);
  });

  it("lib/templates.ts refuses an officer too, if an action ever forgot to", async () => {
    const id = await template(OWNER, "Alumni angle");
    const refused = { ok: false, error: "Only the workspace owner can manage templates." };
    expect(await templates.createTemplate(OFFICER, { name: "Mine", body: BODY })).toEqual(refused);
    expect(await templates.updateTemplate(OFFICER, id, { name: "Hacked", body: BODY })).toEqual(refused);
    expect(await templates.archiveTemplate(OFFICER, id)).toEqual(refused);
    expect(await templates.unarchiveTemplate(OFFICER, id)).toEqual(refused);
    expect(await templateRow(id)).toMatchObject({ name: "Alumni angle", archivedAt: null });
  });

  describe("refuses anyone outside the workspace", () => {
    let id: string;
    beforeEach(async () => {
      id = await template(OWNER, "Alumni angle");
    });
    const calls = (workspaceId: string): [string, () => Promise<unknown>][] => [
      ["createTemplate", () => createTemplate(null, form({ workspaceId, name: "Planted", body: BODY }))],
      ["updateTemplate", () => updateTemplate(null, form({ workspaceId, templateId: id, name: "Hacked", body: BODY }))],
      ["archiveTemplate", () => archiveTemplate(null, form({ workspaceId, templateId: id }))],
      ["unarchiveTemplate", () => unarchiveTemplate(null, form({ workspaceId, templateId: id }))],
    ];
    const unchanged = async () => {
      expect(await templates.listTemplates(OWNER)).toMatchObject([{ id, name: "Alumni angle", body: BODY, archivedAt: null }]);
      expect(await templates.listTemplates(OTHER_ORG)).toEqual([]);
    };

    it("sends a signed-out visitor to /signin", async () => {
      for (const [, run] of calls("a")) await expect(signedOut(run)).rejects.toEqual(redirectTo("/signin"));
      await unchanged();
    });

    it("refuses another workspace's owner using this workspace's id", async () => {
      for (const [, run] of calls("a")) expect(await asUser("ownerB", run)).toEqual({ ok: false, error: "You are not a member of this workspace." });
      await unchanged();
    });

    it("refuses another workspace's owner passing their own workspace id with this template's id", async () => {
      const results = await asUser("ownerB", () => Promise.all(calls("b").slice(1).map(([, run]) => run())));
      for (const result of results) expect(result).toEqual(NOT_OK);
      await unchanged();
    });
  });

  it("refuses a second template with the same name, archived or not, whatever the case", async () => {
    const id = await template(OWNER, "Alumni angle");
    expect(await templates.createTemplate(OWNER, { name: "alumni ANGLE", body: BODY })).toEqual({
      ok: false,
      error: 'A template is already called "alumni ANGLE". Pick another name.',
    });
    const other = await template(OWNER, "Cold intro");
    expect(await templates.updateTemplate(OWNER, other, { name: "Alumni Angle", body: BODY })).toEqual(NOT_OK);
    await templates.archiveTemplate(OWNER, id);
    expect(await templates.createTemplate(OWNER, { name: "Alumni angle", body: BODY })).toEqual({
      ok: false,
      error: 'An archived template is already called "Alumni angle". Unarchive it, or pick another name.',
    });
    // The same name in another workspace is fine.
    expect((await templates.createTemplate(OTHER_ORG, { name: "Alumni angle", body: BODY })).ok).toBe(true);
    // Saving a template under its own name is fine.
    expect(await templates.updateTemplate(OWNER, other, { name: "Cold intro", body: "Hi {{firstName}}" })).toEqual(OK);
  });

  it("refuses editing an archived template, archiving twice and unknown ids", async () => {
    const id = await template(OWNER, "Alumni angle");
    await templates.archiveTemplate(OWNER, id);
    expect(await templates.updateTemplate(OWNER, id, { name: "New", body: BODY })).toEqual({
      ok: false,
      error: "Template not found, or it's archived. Unarchive it to edit it.",
    });
    expect(await templates.archiveTemplate(OWNER, id)).toEqual({ ok: false, error: "Template not found." });
    expect(await templates.unarchiveTemplate(OWNER, "missing")).toEqual({ ok: false, error: "Template not found." });
    expect(await asUser("ownerA", () => archiveTemplate(null, form({ workspaceId: "a", templateId: "" })))).toEqual({ ok: false, error: "Template not found." });
  });

  it("refuses a body with an unknown placeholder, with the reason", async () => {
    expect(await asUser("ownerA", () => createTemplate(null, fields({ body: "Hi {{name}}" })))).toEqual({
      ok: false,
      error: "Templates can only use {{firstName}}, {{senderName}} and {{orgName}}. Fix {{name}}.",
    });
    expect(await templates.listTemplates(OWNER)).toEqual([]);
  });

  it("counts how many outreach entries used each template, in Settings", async () => {
    const used = await template(OWNER, "Alumni angle");
    await template(OWNER, "Cold intro");
    const acme = await company("Acme");
    await claimCompany(OWNER, acme);
    for (let i = 0; i < 2; i++) await logOutreach(OWNER, acme, { channel: "EMAIL", note: null, followUpOn: await followUp(), templateId: used });
    expect((await templates.listTemplates(OWNER)).map((t) => [t.name, t.uses])).toEqual([
      ["Alumni angle", 2],
      ["Cold intro", 0],
    ]);
  });
});

describe("logging outreach with a template", () => {
  let acme: string;
  beforeEach(async () => {
    acme = await company("Acme");
    await claimCompany(OFFICER, acme);
  });
  const log = async (templateId: string) =>
    asUser("officerA", async () => logOutreachAction(null, form({ workspaceId: "a", companyId: acme, channel: "EMAIL", followUpOn: await followUp(), templateId })));

  it("records the template picked", async () => {
    const id = await template(OWNER, "Alumni angle");
    expect(await log(id)).toEqual(OK);
    expect(await outreachRows(acme)).toMatchObject([{ templateId: id, gotReply: false }]);
  });

  it("records no template for 'No template' (an empty choice)", async () => {
    expect(await log("")).toEqual(OK);
    expect(await outreachRows(acme)).toMatchObject([{ templateId: null }]);
  });

  it("refuses another workspace's template with a clear message, and saves nothing", async () => {
    const theirs = await template(OTHER_ORG, "Their template");
    expect(await log(theirs)).toEqual({ ok: false, error: "That template wasn't found, or it's archived. Nothing was saved." });
    expect(await outreachRows(acme)).toEqual([]);
    expect(await withTenant(OWNER, (tx) => tx.company.findUniqueOrThrow({ where: { id: acme }, select: { stage: true, lastContactedAt: true } }))).toEqual({
      stage: "NOT_CONTACTED",
      lastContactedAt: null,
    });
  });

  it("refuses an archived template for a new log, and an id that doesn't exist", async () => {
    const id = await template(OWNER, "Alumni angle");
    await templates.archiveTemplate(OWNER, id);
    expect(await log(id)).toEqual({ ok: false, error: "That template wasn't found, or it's archived. Nothing was saved." });
    expect(await log("missing-template")).toEqual({ ok: false, error: "That template wasn't found, or it's archived. Nothing was saved." });
    expect(await outreachRows(acme)).toEqual([]);
  });
});

describe("which outreach got the reply", () => {
  let acme: string;
  let first: string;
  let second: string;
  beforeEach(async () => {
    acme = await company("Acme");
    await claimCompany(OFFICER, acme);
    const id = await template(OWNER, "Alumni angle");
    await logOutreach(OFFICER, acme, { channel: "EMAIL", note: "First email", followUpOn: await followUp(), templateId: id });
    await logOutreach(OFFICER, acme, { channel: "LINKEDIN", note: "Nudge", followUpOn: await followUp() });
    [first, second] = (await outreachRows(acme)).map((o) => o.id);
  });
  const move = (stage: string, user = "officerA", companyId = acme) => asUser(user, () => moveStage(null, form({ workspaceId: "a", companyId, stage })));
  const mark = (outreachId: string, user = "officerA", workspaceId = "a", companyId = acme) =>
    asUser(user, () => markReplyAction(null, form({ workspaceId, companyId, outreachId })));

  test.each(["REPLIED", "IN_CONVERSATION", "COMMITTED"])("moving from Contacted to %s asks, listing the company's outreach newest first", async (stage) => {
    const result = await move(stage);
    expect(result).toMatchObject({
      ok: true,
      data: {
        replyChoices: [
          { id: second, channel: "LINKEDIN", note: "Nudge", senderName: "officerA", templateName: null, aiDrafted: false, gotReply: false },
          { id: first, channel: "EMAIL", note: "First email", templateName: "Alumni angle", gotReply: false },
        ],
      },
    });
  });

  test.each([
    ["CONTACTED", "NOT_CONTACTED"],
    ["CONTACTED", "DECLINED"],
    ["REPLIED", "IN_CONVERSATION"],
    ["IN_CONVERSATION", "COMMITTED"],
  ])("moving from %s to %s doesn't ask", async (from, to) => {
    await setStage(acme, from);
    expect(await move(to)).toEqual(OK);
  });

  it("doesn't ask when the company has no outreach to pick from", async () => {
    const bare = await company("Bare");
    expect(await move("REPLIED", "officerA", bare)).toEqual(OK);
  });

  it("marks the outreach picked, and only that one; marking it again is fine", async () => {
    await move("REPLIED");
    expect(await mark(first)).toEqual(OK);
    expect(await mark(first)).toEqual(OK);
    expect((await outreachRows(acme)).map((o) => o.gotReply)).toEqual([true, false]);
    // A later move into a reply stage asks again and shows what is already marked.
    await setStage(acme, "CONTACTED");
    expect(await move("IN_CONVERSATION")).toMatchObject({ data: { replyChoices: [{ id: second, gotReply: false }, { id: first, gotReply: true }] } });
  });

  it("is refused while the company isn't in a reply stage", async () => {
    expect(await mark(first)).toEqual({ ok: false, error: "This company is Contacted, so no outreach can be marked as the reply." });
    expect((await outreachRows(acme)).every((o) => !o.gotReply)).toBe(true);
  });

  it("is refused for outreach on another company, and for an archived company", async () => {
    await move("REPLIED");
    const other = await company("Initech");
    await setStage(other, "REPLIED");
    expect(await mark(first, "officerA", "a", other)).toEqual({ ok: false, error: "That outreach wasn't found on this company." });
    await withTenant(OWNER, (tx) => tx.company.update({ where: { id: acme }, data: { archivedAt: new Date() } }));
    expect(await mark(first)).toEqual({ ok: false, error: "Company not found." });
    expect((await outreachRows(acme)).every((o) => !o.gotReply)).toBe(true);
  });

  it("follows the claim rule: someone else's live claim blocks an officer, not an owner", async () => {
    await move("REPLIED");
    await withTenant(OWNER, (tx) => tx.$executeRaw`UPDATE "Company" SET "claimedById" = 'ownerA' WHERE id = ${acme}`);
    expect(await markReply(OFFICER, acme, first)).toEqual({ ok: false, error: expect.stringMatching(/^ownerA holds this company until .*Ask them, or an owner\.$/) });
    expect(await markReply(OWNER, acme, first)).toEqual(OK);
  });

  it("refuses anyone outside the workspace", async () => {
    await move("REPLIED");
    await expect(signedOut(() => markReplyAction(null, form({ workspaceId: "a", companyId: acme, outreachId: first })))).rejects.toEqual(redirectTo("/signin"));
    expect(await mark(first, "ownerB")).toEqual({ ok: false, error: "You are not a member of this workspace." });
    expect(await mark(first, "ownerB", "b")).toEqual({ ok: false, error: "Company not found." });
    expect(await markReply(OTHER_ORG, acme, first)).toEqual({ ok: false, error: "Company not found." });
    expect(await mark("", "officerA")).toEqual({ ok: false, error: "Pick the outreach that got the reply." });
    expect((await outreachRows(acme)).every((o) => !o.gotReply)).toBe(true);
  });

  it("a move by another workspace's member never returns this company's outreach", async () => {
    expect(await move("REPLIED", "ownerB")).toEqual(NOT_OK);
    expect(await asUser("ownerB", () => moveStage(null, form({ workspaceId: "b", companyId: acme, stage: "REPLIED" })))).toEqual({ ok: false, error: "Company not found." });
  });
});

describe("drafting from a template", () => {
  let globex: string;
  const variant = (n: number) => ({ angle: `Angle ${n}`, subject: `Subject ${n}`, body: "Hi {{firstName}},\n\nOur hackathon draws 600 students.\n\n{{senderName}}\n{{orgName}}" });
  const drafted = () => [answer(JSON.stringify({ variants: [variant(1), variant(2)] })), answer(JSON.stringify({ issues: [] }))];
  const draft = (templateId: string, user = "officerA") =>
    asUser(user, () => draftAction(null, form({ workspaceId: "a", companyId: globex, kind: "FIRST_TOUCH", contactId: "", note: "", templateId })));
  const claimOf = () => withTenant(OWNER, (tx) => tx.company.findUniqueOrThrow({ where: { id: globex }, select: { claimedById: true } }));

  beforeEach(async () => {
    process.env.GEMINI_API_KEY = "test-key";
    await prisma.workspace.update({ where: { id: "a" }, data: { aiEnabled: true } });
    globex = await company("Globex");
    await addFact(OWNER, "The annual hackathon draws 600 students.");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GEMINI_API_KEY;
  });

  it("sends the template to the AI as data, with emails and phone numbers masked", async () => {
    const id = await template(OWNER, "Alumni angle", "Hi {{firstName}},\n\nWrite to chair@club.org or 765-555-0142 <b>now</b>.\n\n{{senderName}}\n{{orgName}}");
    fakeGemini(...drafted());
    const result = await draft(id);
    expect(result).toMatchObject({ ok: true, data: [{ angle: "Angle 1" }, { angle: "Angle 2" }] });
    const prompt = JSON.stringify(calls[0].body);
    expect(prompt).toContain("<template>\\nHi {{firstName}},\\n\\nWrite to [email] or [phone] ‹b›now‹/b›.\\n\\n{{senderName}}\\n{{orgName}}\\n</template>");
    expect(prompt).toContain("Base both on the template");
    expect(prompt).not.toContain("chair@club.org");
    expect(prompt).not.toContain("555-0142");
  });

  it("still drops a draft that leaves out a placeholder, template or not", async () => {
    const id = await template(OWNER, "Alumni angle");
    fakeGemini(answer(JSON.stringify({ variants: [{ ...variant(1), body: "Hi there,\n\nOur hackathon draws 600 students.\n\nSam\n{{orgName}}" }] })));
    expect(await draft(id)).toEqual({ ok: false, error: "The AI's drafts broke the drafting rules. Try again." });
  });

  it("without a template, the prompt has none", async () => {
    fakeGemini(...drafted());
    expect((await draft("")).ok).toBe(true);
    expect(JSON.stringify(calls[0].body)).not.toContain("<template>");
  });

  test.each([
    ["another workspace's template", async () => template(OTHER_ORG, "Theirs")],
    [
      "an archived template",
      async () => {
        const id = await template(OWNER, "Old");
        await templates.archiveTemplate(OWNER, id);
        return id;
      },
    ],
    ["an id that doesn't exist", async () => "missing-template"],
  ])("refuses %s before any AI call or claim", async (_label, make) => {
    const id = await make();
    fakeGemini();
    expect(await draft(id)).toEqual({ ok: false, error: "That template wasn't found, or it's archived." });
    expect(calls).toHaveLength(0);
    expect(await claimOf()).toEqual({ claimedById: null });
  });
});
