import { afterAll, afterEach, beforeEach, describe, expect, it, test, vi } from "vitest";
import { logOutreach as logOutreachAction } from "@/app/(app)/[workspaceId]/companies/actions";
import { draftEmail as draftAction } from "@/app/(app)/[workspaceId]/companies/draft-actions";
import type { Membership } from "@/lib/authz";
import { changeStage, claimCompany, dbToday, logOutreach, markReply } from "@/lib/claims";
import { composeLinks, LINK_MAX } from "@/lib/compose-links";
import { addContact, createCompany } from "@/lib/companies";
import { addDays } from "@/lib/dates";
import { prisma, withTenant } from "@/lib/db";
import { draftEmail, recentDrafts } from "@/lib/drafts";
import { addFact } from "@/lib/facts";
import { form, redirectTo } from "./helpers/form";
import { answer, apiError, calls, fakeGemini, reply } from "./helpers/gemini";
import { asUser, signedOut } from "./helpers/next-request";
import { resetAndSeed } from "./helpers/seed";

vi.mock("next/headers", () => import("./helpers/next-request"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const OWNER: Membership = { userId: "ownerA", workspaceId: "a", role: "owner" };
const OFFICER: Membership = { userId: "officerA", workspaceId: "a", role: "member" };
const OTHER_ORG: Membership = { userId: "ownerB", workspaceId: "b", role: "owner" };

const variant = (n: number, extra: Partial<{ angle: string; subject: string; body: string }> = {}) => ({
  angle: `Angle ${n}`,
  subject: `Subject ${n} for {{orgName}}`,
  body: `Hi {{firstName}},\n\nOur hackathon draws 600 students.\n\n{{senderName}}\n{{orgName}}`,
  ...extra,
});
// One Draft click makes two AI calls: the drafts, then the Claim Checker (here finding nothing).
const drafted = (...variants: unknown[]) => [answer(JSON.stringify({ variants })), answer(JSON.stringify({ issues: [] }))];

let companyId: string;
let contactId: string;

async function newCompany(name: string) {
  const result = await createCompany(OWNER, { name, industry: "Energy", website: `${name.toLowerCase()}.com` });
  if (result.status !== "saved") throw new Error("seed company flagged");
  return result.companyId;
}

const claimOf = (id: string) => withTenant(OWNER, (tx) => tx.company.findUniqueOrThrow({ where: { id }, select: { claimedById: true } }));
const draftCount = () => withTenant(OWNER, (tx) => tx.aiDraft.count());
const promptOf = (i = 0) => JSON.stringify(calls[i].body);
// Tests may clear a claim directly; the app only does it through lib/claims.ts.
const unclaim = (id: string) => withTenant(OWNER, (tx) => tx.company.update({ where: { id }, data: { claimedById: null, claimExpiresAt: null } }));

beforeEach(async () => {
  await resetAndSeed();
  process.env.GEMINI_API_KEY = "test-key";
  await prisma.workspace.update({ where: { id: "a" }, data: { aiEnabled: true } });
  companyId = await newCompany("Globex");
  const contact = await addContact(OWNER, companyId, { name: "Hank Scorpio", email: "hank@globex.com", title: "Head of University Relations" });
  if (!contact.ok) throw new Error(contact.error);
  contactId = contact.data.contactId;
  await addFact(OWNER, "The annual hackathon draws 600 students.");
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GEMINI_API_KEY;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("composeLinks", () => {
  it("encodes spaces as %20, never +, and uses CRLF line breaks in mailto", () => {
    const links = composeLinks({ to: "hank@globex.com", subject: "Hello & welcome", body: "Line one\nLine two" });
    expect(links).toEqual({
      gmail: "https://mail.google.com/mail/?view=cm&fs=1&tf=cm&to=hank%40globex.com&su=Hello%20%26%20welcome&body=Line%20one%0ALine%20two",
      outlook: "https://outlook.office.com/mail/deeplink/compose?to=hank%40globex.com&subject=Hello%20%26%20welcome&body=Line%20one%0ALine%20two",
      mailto: "mailto:hank%40globex.com?subject=Hello%20%26%20welcome&body=Line%20one%0D%0ALine%20two",
      bodyIncluded: true,
    });
  });

  it("flattens line breaks in the recipient and subject, so they can't add headers", () => {
    const links = composeLinks({ to: "a@b.co\r\nbcc: evil@x.co", subject: "Hi\nthere", body: "" });
    expect(links.mailto).toBe("mailto:a%40b.co%20bcc%3A%20evil%40x.co?subject=Hi%20there");
  });

  it("leaves out a body too long for a link", () => {
    const links = composeLinks({ to: "", subject: "Long", body: "x".repeat(LINK_MAX) });
    expect(links.bodyIncluded).toBe(false);
    expect(links.gmail).not.toContain("body=");
    expect(links.mailto).toBe("mailto:?subject=Long");
  });
});

describe("draftEmail", () => {
  it("claims the company, writes two drafts from verified facts, and fills in names", async () => {
    fakeGemini(...drafted(variant(1), variant(2)));
    const result = await draftEmail(OFFICER, companyId, { kind: "FIRST_TOUCH", contactId, note: null });
    expect(result).toEqual({
      ok: true,
      data: [1, 2].map((n) => ({
        id: expect.any(String),
        kind: "FIRST_TOUCH",
        angle: `Angle ${n}`,
        subject: `Subject ${n} for Org A`,
        body: "Hi Hank,\n\nOur hackathon draws 600 students.\n\nofficerA\nOrg A",
        to: "hank@globex.com",
        createdAt: expect.any(Date),
        check: { subject: `Subject ${n} for Org A`, body: "Hi Hank,\n\nOur hackathon draws 600 students.\n\nofficerA\nOrg A", ai: [], error: null },
      })),
    });
    expect(await claimOf(companyId)).toEqual({ claimedById: "officerA" });
    const rows = await withTenant(OWNER, (tx) => tx.aiDraft.findMany({ select: { model: true, contactId: true, createdById: true, createdAt: true } }));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ model: "gemini-3.6-flash", contactId, createdById: "officerA" });
    expect(rows[0].createdAt).toEqual(rows[1].createdAt);
  });

  it("never shows the AI a name or contact detail, and wraps the note as data", async () => {
    await addFact(OWNER, "Questions go to sponsor@club.org.");
    fakeGemini(...drafted(variant(1)));
    await draftEmail(OWNER, companyId, { kind: "FIRST_TOUCH", contactId, note: "Mention <b>Hank</b>'s email hank@globex.com and the 600 students" });
    const prompt = promptOf();
    expect(prompt).toContain("Head of University Relations");
    expect(prompt).toContain("1. The annual hackathon draws 600 students.");
    expect(prompt).toContain("Questions go to [email].");
    expect(prompt).toContain("‹b›Hank‹/b›'s email [email] and the 600 students");
    expect(prompt).not.toMatch(/Scorpio|hank@globex|sponsor@club/);
    expect(prompt).toContain("Write two first-touch emails.");
  });

  it("uses only verified facts, and says so when there are none or the company is bare", async () => {
    await withTenant(OWNER, (tx) => tx.factSheetItem.updateMany({ data: { verifiedAt: null, verifiedById: null } }));
    const bare = await createCompany(OWNER, { name: "Bare Co" });
    if (bare.status !== "saved") throw new Error("flagged");
    fakeGemini(...drafted(variant(1)));
    await draftEmail(OWNER, bare.companyId, { kind: "FIRST_TOUCH", contactId: null, note: null });
    expect(promptOf()).toContain("Name: Bare Co\\nIndustry: unknown\\nWebsite: unknown");
    expect(promptOf()).toContain("(none verified yet");
    expect(promptOf()).not.toContain("600 students.");
  });

  it("greets 'there' with no contact, and leaves the To line empty", async () => {
    fakeGemini(...drafted(variant(1)));
    const result = await draftEmail(OWNER, companyId, { kind: "FIRST_TOUCH", contactId: null, note: null });
    expect(result).toMatchObject({ ok: true, data: [{ body: expect.stringMatching(/^Hi there,/), to: "" }] });
  });

  it("shows a follow-up the earlier outreach, with the subject of the draft it sent", async () => {
    fakeGemini(...drafted(variant(1)));
    const first = await draftEmail(OWNER, companyId, { kind: "FIRST_TOUCH", contactId, note: null });
    if (!first.ok) throw new Error(first.error);
    const followUpOn = addDays(await dbToday(), 7);
    await logOutreach(OWNER, companyId, { channel: "EMAIL", note: null, followUpOn, aiDraftId: first.data[0].id });
    await logOutreach(OWNER, companyId, { channel: "LINKEDIN", note: "Talked to Hank", followUpOn });

    fakeGemini(...drafted(variant(2)));
    await draftEmail(OWNER, companyId, { kind: "FOLLOW_UP", contactId, note: null });
    const prompt = promptOf();
    expect(prompt).toContain("<earlier_outreach>");
    // The workspace name in the saved subject goes back to its placeholder.
    expect(prompt).toContain('Email: \\"Subject 1 for {{orgName}}\\"');
    expect(prompt).toContain("LinkedIn");
    expect(prompt).not.toContain("Talked to Hank");
    expect(prompt).toContain("Write two follow-up emails.");
  });

  // A model can put a placeholder in a subject, and code fills it in before the draft is saved. The
  // saved subject then holds real names, so they come back out before it goes into a follow-up prompt.
  it("takes the contact's first name, the sender's name and the workspace name out of an earlier draft's subject", async () => {
    fakeGemini(...drafted(variant(1, { subject: "{{firstName}}, a note from {{senderName}} at {{orgName}}" })));
    const first = await draftEmail(OFFICER, companyId, { kind: "FIRST_TOUCH", contactId, note: null });
    if (!first.ok) throw new Error(first.error);
    expect(first.data[0].subject).toBe("Hank, a note from officerA at Org A");
    const logged = await logOutreach(OFFICER, companyId, { channel: "EMAIL", note: null, followUpOn: addDays(await dbToday(), 7), aiDraftId: first.data[0].id });
    expect(logged.ok).toBe(true);

    fakeGemini(...drafted(variant(2)));
    expect((await draftEmail(OFFICER, companyId, { kind: "FOLLOW_UP", contactId, note: null })).ok).toBe(true);
    const prompt = promptOf();
    expect(prompt).toContain('Email: \\"{{firstName}}, a note from {{senderName}} at {{orgName}}\\"');
    expect(prompt).not.toMatch(/Hank|officerA|Org A/);
  });

  // Recorded case: Glasswing Hardware was Replied, its only outreach had
  // a reply ("Hugo replied and asked whether students could visit"), and both follow-ups said
  // "following up on my October 30 email" as if nobody had answered.
  it("tells a follow-up that the company replied: its stage, and which outreach got the reply, never the note", async () => {
    const followUpOn = addDays(await dbToday(), 7);
    expect((await claimCompany(OWNER, companyId)).ok).toBe(true);
    const logged = await logOutreach(OWNER, companyId, { channel: "EMAIL", note: "Hank replied and asked whether students could visit", followUpOn });
    if (!logged.ok) throw new Error(logged.error);
    expect((await changeStage(OWNER, companyId, "REPLIED")).ok).toBe(true);
    expect((await markReply(OWNER, companyId, logged.data.outreachId)).ok).toBe(true);

    const replied = variant(2, { body: "Hi {{firstName}},\n\nThanks for getting back to me. Our hackathon draws 600 students.\n\n{{senderName}}\n{{orgName}}" });
    fakeGemini(...drafted(replied));
    const result = await draftEmail(OWNER, companyId, { kind: "FOLLOW_UP", contactId, note: null });
    expect(result).toMatchObject({ ok: true, data: [{ body: expect.stringContaining("Thanks for getting back to me.") }] });
    const prompt = promptOf();
    expect(prompt).toContain("Website: globex.com\\nStage: Replied\\n</company>");
    expect(prompt).toMatch(/<earlier_outreach>\\n[A-Z][a-z]{2} \d{1,2}, Email, they replied\\n<\/earlier_outreach>/);
    expect(prompt).toContain("never write as if they hadn't answered");
    expect(prompt).not.toMatch(/Hank|visit/);
  });

  it("an outreach with no reply says nothing about one, and the stage is still given", async () => {
    expect((await claimCompany(OWNER, companyId)).ok).toBe(true);
    expect((await logOutreach(OWNER, companyId, { channel: "EMAIL", note: null, followUpOn: addDays(await dbToday(), 7) })).ok).toBe(true);
    fakeGemini(...drafted(variant(1)));
    await draftEmail(OWNER, companyId, { kind: "FOLLOW_UP", contactId: null, note: null });
    expect(promptOf()).toContain("Stage: Contacted");
    expect(promptOf()).not.toContain("Email, they replied");
  });

  // The drafting rules once said "a Purdue University student organization" for every workspace.
  it("describes the organization only through its verified facts and {{orgName}}, never a school it assumed", async () => {
    fakeGemini(...drafted(variant(1)));
    await draftEmail(OWNER, companyId, { kind: "FIRST_TOUCH", contactId, note: null });
    const system = JSON.stringify(calls[0].body.systemInstruction);
    expect(system).not.toMatch(/Purdue|University|student organization/i);
    expect(system).toContain("names the organization only as {{orgName}}");
    expect(system).toContain("Say nothing about the organization except what the numbered facts state");
  });

  it("says when nothing has been logged yet for a follow-up", async () => {
    fakeGemini(...drafted(variant(1)));
    await draftEmail(OWNER, companyId, { kind: "FOLLOW_UP", contactId: null, note: null });
    expect(promptOf()).toContain("(none logged)");
  });

  test.for([
    ["an unknown placeholder", variant(9, { body: "Hi {{lastName}}" })],
    ["a stray brace", variant(9, { subject: "Hello {{orgName}" })],
    ["an email address", variant(9, { body: "Write to me at sam@purdue.edu" })],
    ["a masked phone number", variant(9, { body: "Call [phone]" })],
    ["names written out instead of placeholders", variant(9, { body: "Hi John,\n\nSarah\nPurdue Hackers" })],
    ["no sign-off placeholders", variant(9, { body: "Hi {{firstName}}, thanks." })],
  ] as const)("drops a variant with %s", async ([, bad]) => {
    fakeGemini(...drafted(bad, variant(1)));
    const result = await draftEmail(OWNER, companyId, { kind: "FIRST_TOUCH", contactId: null, note: null });
    expect(result).toMatchObject({ ok: true, data: [{ angle: "Angle 1" }] });
  });

  it("refuses when every variant breaks the rules, and saves nothing", async () => {
    fakeGemini(...drafted(variant(1, { body: "Hi {{name}}" })));
    expect(await draftEmail(OWNER, companyId, { kind: "FIRST_TOUCH", contactId: null, note: null })).toEqual({
      ok: false,
      error: "The AI's drafts broke the drafting rules. Try again.",
    });
    expect(await draftCount()).toBe(0);
  });

  it("takes no claim when AI is off or the contact isn't this company's", async () => {
    fakeGemini();
    const other = await newCompany("Initech");
    await prisma.workspace.update({ where: { id: "a" }, data: { aiEnabled: false } });
    expect(await draftEmail(OWNER, companyId, { kind: "FIRST_TOUCH", contactId: null, note: null })).toEqual({
      ok: false,
      error: "AI is turned off for this workspace. An owner can turn it on in Settings.",
    });
    await prisma.workspace.update({ where: { id: "a" }, data: { aiEnabled: true } });
    expect(await draftEmail(OWNER, other, { kind: "FIRST_TOUCH", contactId, note: null })).toEqual({ ok: false, error: "Contact not found." });
    expect(await claimOf(companyId)).toEqual({ claimedById: null });
    expect(await claimOf(other)).toEqual({ claimedById: null });
    expect(calls).toHaveLength(0);
  });

  it("refuses a company someone else holds, without calling the AI", async () => {
    fakeGemini();
    await claimCompany(OWNER, companyId);
    const result = await draftEmail(OFFICER, companyId, { kind: "FIRST_TOUCH", contactId: null, note: null });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("ownerA claimed this first") });
    expect(calls).toHaveLength(0);
  });

  it("keeps the claim but saves nothing when the AI fails", async () => {
    // Every model in line is out of quota.
    fakeGemini(...Array.from({ length: 3 }, () => apiError(429, "Resource exhausted", "RESOURCE_EXHAUSTED")));
    expect(await draftEmail(OFFICER, companyId, { kind: "FIRST_TOUCH", contactId: null, note: null })).toEqual({
      ok: false,
      error: "The AI is busy right now. Try again in a minute.",
    });
    expect(await claimOf(companyId)).toEqual({ claimedById: "officerA" });
    expect(await draftCount()).toBe(0);
  });

  it("can't reach another workspace's company or contact", async () => {
    fakeGemini();
    await prisma.workspace.update({ where: { id: "b" }, data: { aiEnabled: true } });
    expect(await draftEmail(OTHER_ORG, companyId, { kind: "FIRST_TOUCH", contactId: null, note: null })).toEqual({
      ok: false,
      error: "Company not found.",
    });
    expect(await draftEmail(OTHER_ORG, companyId, { kind: "FIRST_TOUCH", contactId, note: null })).toEqual({ ok: false, error: "Contact not found." });
    expect(calls).toHaveLength(0);
  });
});

describe("recentDrafts", () => {
  it("returns only your latest click's drafts for that company", async () => {
    fakeGemini(...drafted(variant(1), variant(2)), ...drafted(variant(3)), ...drafted(variant(4)));
    await draftEmail(OWNER, companyId, { kind: "FIRST_TOUCH", contactId: null, note: null });
    await draftEmail(OWNER, companyId, { kind: "FOLLOW_UP", contactId, note: null });
    await unclaim(companyId);
    await draftEmail(OFFICER, companyId, { kind: "FIRST_TOUCH", contactId: null, note: null });

    expect((await recentDrafts(OWNER, companyId)).map((d) => [d.angle, d.to])).toEqual([["Angle 3", "hank@globex.com"]]);
    expect((await recentDrafts(OFFICER, companyId)).map((d) => d.angle)).toEqual(["Angle 4"]);
    expect(await recentDrafts(OWNER, await newCompany("Initech"))).toEqual([]);
  });
});

describe("logging a draft as sent", () => {
  async function myDraft(member: Membership, company = companyId) {
    fakeGemini(...drafted(variant(1)));
    const result = await draftEmail(member, company, { kind: "FIRST_TOUCH", contactId: null, note: null });
    if (!result.ok) throw new Error(result.error);
    return result.data[0].id;
  }

  it("links the outreach to the draft", async () => {
    const aiDraftId = await myDraft(OWNER);
    const followUpOn = addDays(await dbToday(), 7);
    expect(await logOutreach(OWNER, companyId, { channel: "EMAIL", note: null, followUpOn, aiDraftId })).toMatchObject({ ok: true });
    expect(await withTenant(OWNER, (tx) => tx.outreach.findMany({ select: { aiDraftId: true } }))).toEqual([{ aiDraftId }]);
  });

  it("refuses someone else's draft, or a draft of another company, and writes nothing", async () => {
    const officers = await myDraft(OFFICER);
    await unclaim(companyId);
    const other = await newCompany("Initech");
    const mineElsewhere = await myDraft(OWNER, other);
    await claimCompany(OWNER, companyId);
    const followUpOn = addDays(await dbToday(), 7);
    for (const aiDraftId of [officers, mineElsewhere, "missing"]) {
      expect(await logOutreach(OWNER, companyId, { channel: "EMAIL", note: null, followUpOn, aiDraftId })).toEqual({
        ok: false,
        error: "That draft wasn't found. Nothing was saved.",
      });
    }
    expect(await withTenant(OWNER, (tx) => tx.outreach.count())).toBe(0);
  });
});

describe("draft actions", () => {
  const draftForm = (fields: Record<string, string> = {}) =>
    form({ workspaceId: "a", companyId, kind: "FIRST_TOUCH", contactId, note: "", ...fields });

  it("drafts for any member, with or without a contact", async () => {
    fakeGemini(...drafted(variant(1)), ...drafted(variant(2)));
    expect(await asUser("officerA", () => draftAction(null, draftForm()))).toMatchObject({ ok: true, data: [{ to: "hank@globex.com" }] });
    expect(await asUser("officerA", () => draftAction(null, draftForm({ contactId: "", kind: "FOLLOW_UP" })))).toMatchObject({
      ok: true,
      data: [{ kind: "FOLLOW_UP", to: "" }],
    });
  });

  test.for([
    ["a bad kind", { kind: "THIRD" }, "Pick first email or follow-up."],
    ["a note over 300 characters", { note: "x".repeat(301) }, "Note can be at most 300 characters."],
    ["a missing company", { companyId: "" }, expect.any(String)],
  ] as const)("refuses %s", async ([, fields, error]) => {
    fakeGemini();
    expect(await asUser("officerA", () => draftAction(null, draftForm(fields as Record<string, string>)))).toEqual({ ok: false, error });
    expect(calls).toHaveLength(0);
  });

  it("refuses another workspace and a signed-out visitor", async () => {
    fakeGemini();
    expect(await asUser("ownerB", () => draftAction(null, draftForm()))).toMatchObject({ ok: false });
    await expect(signedOut(() => draftAction(null, draftForm()))).rejects.toEqual(redirectTo("/signin"));
    expect(calls).toHaveLength(0);
  });

  it("logs outreach with the draft id from the I sent it form", async () => {
    fakeGemini(...drafted(variant(1)));
    const result = await asUser("officerA", () => draftAction(null, draftForm()));
    if (!result.ok) throw new Error(result.error);
    const aiDraftId = result.data[0].id;
    const fields = { workspaceId: "a", companyId, channel: "EMAIL", note: "Sent", followUpOn: addDays(await dbToday(), 7), aiDraftId };
    expect(await asUser("officerA", () => logOutreachAction(null, form(fields)))).toEqual({ ok: true, data: undefined });
    expect(await withTenant(OWNER, (tx) => tx.outreach.findFirst({ select: { aiDraftId: true, note: true } }))).toEqual({ aiDraftId, note: "Sent" });
  });
});

// ----- Drafting edge cases: bad fields, the log, the claim check -----

describe("draftEmail: one bad field never wastes the call", () => {
  const ask = (tenant: Membership = OWNER, id = companyId) => draftEmail(tenant, id, { kind: "FIRST_TOUCH", contactId: null, note: null });

  it("cuts an angle over 80 characters to fit, instead of failing the reply", async () => {
    const long = "Leads with the six hundred students at the hackathon and the career fair right after";
    expect(long.length).toBeGreaterThan(80);
    fakeGemini(...drafted(variant(1, { angle: long }), variant(2)));
    const result = await ask();
    if (!result.ok) throw new Error(result.error);
    expect(result.data).toHaveLength(2);
    expect(result.data[0].angle.length).toBeLessThanOrEqual(80);
    expect(long.startsWith(result.data[0].angle)).toBe(true);
  });

  it("keeps the first two of three variants", async () => {
    fakeGemini(...drafted(variant(1), variant(2), variant(3)));
    const result = await ask();
    expect(result).toMatchObject({ ok: true, data: [{ angle: "Angle 1" }, { angle: "Angle 2" }] });
  });

  it("drops only the variant whose subject or body is over its limit", async () => {
    fakeGemini(...drafted(variant(1, { subject: "S".repeat(121) }), variant(2)));
    expect(await ask()).toMatchObject({ ok: true, data: [{ angle: "Angle 2" }] });
    fakeGemini(...drafted(variant(3), variant(4, { body: `Hi {{firstName}},\n\n${"x".repeat(3000)}\n\n{{senderName}}\n{{orgName}}` })));
    expect(await ask()).toMatchObject({ ok: true, data: [{ angle: "Angle 3" }] });
  });
});

describe("draftEmail: what the log says", () => {
  const runs = () => withTenant(OWNER, (tx) => tx.aiRun.findMany({ select: { userId: true, feature: true, status: true, error: true }, orderBy: { createdAt: "asc" } }));

  it("logs drafts that all broke the rules as FAILED broke_rules, not SUCCEEDED", async () => {
    fakeGemini(answer(JSON.stringify({ variants: [variant(1, { body: "Hi John,\n\nDana\nRiverbend" })] })));
    expect(await draftEmail(OWNER, companyId, { kind: "FIRST_TOUCH", contactId: null, note: null })).toEqual({
      ok: false,
      error: "The AI's drafts broke the drafting rules. Try again.",
    });
    expect(await runs()).toEqual([{ userId: "ownerA", feature: "DRAFT", status: "FAILED", error: "broke_rules" }]);
  });

  it("a blocked draft says to reword the note", async () => {
    fakeGemini(reply({ promptFeedback: { blockReason: "SAFETY" } }));
    expect(await draftEmail(OWNER, companyId, { kind: "FIRST_TOUCH", contactId: null, note: "something" })).toEqual({
      ok: false,
      error: "The AI declined to answer that. Try rewording your note.",
    });
  });

  it("a claim someone else holds gives the reserved call back: nothing is logged", async () => {
    fakeGemini();
    await claimCompany(OWNER, companyId);
    expect((await draftEmail(OFFICER, companyId, { kind: "FIRST_TOUCH", contactId: null, note: null })).ok).toBe(false);
    expect(await runs()).toEqual([]);
  });

  it("refused by the workspace limit: no claim is taken, and no call is made", async () => {
    await prisma.workspace.update({ where: { id: "a" }, data: { aiMonthlyLimit: 0 } });
    fakeGemini();
    expect(await draftEmail(OFFICER, companyId, { kind: "FIRST_TOUCH", contactId: null, note: null })).toMatchObject({ ok: false, error: expect.stringContaining("AI calls") });
    expect(await claimOf(companyId)).toEqual({ claimedById: null });
    expect(calls).toHaveLength(0);
  });

  it("three officers drafting different companies at once with one call left: one drafts, the others keep no claim", async () => {
    // Two calls per click (draft, then check), so a limit with room for one draft call only.
    await prisma.workspace.update({ where: { id: "a" }, data: { aiMonthlyLimit: 1 } });
    await prisma.membership.create({ data: { id: "m-ownerB-a", workspaceId: "a", userId: "ownerB", role: "member", createdAt: new Date() } });
    const people: Membership[] = [OWNER, OFFICER, { userId: "ownerB", workspaceId: "a", role: "member" }];
    const ids = [companyId, await newCompany("Initech"), await newCompany("Hooli")];
    fakeGemini(answer(JSON.stringify({ variants: [variant(1), variant(2)] })));
    const results = await Promise.all(people.map((p, i) => draftEmail(p, ids[i], { kind: "FIRST_TOUCH", contactId: null, note: null })));
    const won = results.findIndex((r) => r.ok);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect((await runs()).filter((r) => r.feature === "DRAFT")).toHaveLength(1);
    for (const [i, id] of ids.entries()) expect(await claimOf(id)).toEqual({ claimedById: i === won ? people[i].userId : null });
    // The winner's drafts are saved; its claim check found the limit reached and said so.
    const saved = results[won];
    if (!saved.ok) throw new Error(saved.error);
    expect(saved.data[0].check?.error).toMatch(/has used its 1 AI calls/);
  });
});

describe("draftEmail: the claim check right after drafting is quick", () => {
  const draft = () => draftEmail(OWNER, companyId, { kind: "FIRST_TOUCH", contactId, note: null });
  const variants = () => answer(JSON.stringify({ variants: [variant(1), variant(2)] }));

  test.for([
    ["a rate limit", () => apiError(429, "Resource exhausted", "RESOURCE_EXHAUSTED"), "The AI is busy right now. Try again in a minute."],
    ["an overloaded model", () => apiError(503, "Overloaded", "UNAVAILABLE"), "The AI service isn't responding. Try again in a few minutes."],
    ["a cut-off answer", () => answer('{"issues": [', "MAX_TOKENS"), "The AI's answer was cut off. Try again."],
    ["a timeout", () => new DOMException("The operation was aborted.", "AbortError"), "The AI took too long to answer. Try again."],
    ["a blocked check", () => reply({ promptFeedback: { blockReason: "SAFETY" } }), "The AI declined to answer this request. Try again later."],
  ] as const)("on %s: one try on Flash-Lite, the drafts are kept, and each says why it wasn't checked", async ([, failure, message]) => {
    fakeGemini(variants(), failure());
    const result = await draft();
    if (!result.ok) throw new Error(result.error);
    expect(result.data).toHaveLength(2);
    for (const d of result.data) expect(d.check).toMatchObject({ ai: [], error: message });
    // The draft call, then one claim-check call: no fallback model after a Draft click.
    expect(calls.map((c) => c.url.match(/models\/([^:]+)/)?.[1])).toEqual(["gemini-3.6-flash", "gemini-3.5-flash-lite"]);
    expect(await draftCount()).toBe(2);
  });

  it("asks for at most 20 seconds", async () => {
    const { DRAFT_CHECK_DEADLINE_MS } = await import("@/lib/drafts");
    expect(DRAFT_CHECK_DEADLINE_MS).toBe(20_000);
  });
});
