import { afterAll, afterEach, beforeEach, describe, expect, it, test, vi } from "vitest";
import { checkDraft as checkAction } from "@/app/(app)/[workspaceId]/companies/draft-actions";
import type { Membership } from "@/lib/authz";
import { aiCheck, checkDraft, readCheck } from "@/lib/claim-check";
import { checkRules, factNumbers } from "@/lib/claim-rules";
import { addContact, createCompany } from "@/lib/companies";
import { prisma, withTenant } from "@/lib/db";
import { draftEmail, recentDrafts } from "@/lib/drafts";
import { addFact } from "@/lib/facts";
import { fill, unfill } from "@/lib/placeholders";
import { form, redirectTo } from "./helpers/form";
import { answer, apiError, calls, fakeGemini } from "./helpers/gemini";
import { asUser, signedOut } from "./helpers/next-request";
import { resetAndSeed } from "./helpers/seed";

vi.mock("next/headers", () => import("./helpers/next-request"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const OWNER: Membership = { userId: "ownerA", workspaceId: "a", role: "owner" };
const OFFICER: Membership = { userId: "officerA", workspaceId: "a", role: "member" };
const OTHER_ORG: Membership = { userId: "ownerB", workspaceId: "b", role: "owner" };

const RULES = { factNumbers: ["600", "2500", "2025"], website: "https://www.globex.com" };
const issues = (...list: { email: number; quote: string; problem: string }[]) => answer(JSON.stringify({ issues: list }));
const NAMES = { firstName: "Hank", senderName: "Sam Lee", orgName: "Org A" };

describe("checkRules", () => {
  test.for([
    ["a number from a verified fact, however it's written", "Our hackathon draws 600 students; Gold is $2,500.", []],
    ["a number nobody verified", "We have 900 members and 3.5% growth.", ["900", "3.5%"]],
    ["a call length, which is an ask", "Could we do a 10-minute call, or 15 min?", []],
    ["the same number twice, once", "Gold is $3,000. Yes, $3,000.", ["$3,000"]],
    ["a date like the earlier email's", "Following up on my Oct 26 email and our October 3rd call.", []],
    ["a year after a month, which still counts", "We won in March 2025 and plan for Oct 2030.", ["2030"]],
  ] as const)("numbers: %s", ([, text, flagged]) => {
    expect(checkRules(text, RULES).map((f) => f.quote)).toEqual(flagged);
  });

  it("flags links other than the company's own website", () => {
    const text = "See globex.com/careers, https://www.globex.com, www.ourclub.org and purdue.edu/events.";
    expect(checkRules(text, RULES).map((f) => [f.kind, f.quote])).toEqual([
      ["link", "www.ourclub.org"],
      ["link", "purdue.edu/events"],
    ]);
    expect(checkRules("Visit acme.io.", { factNumbers: [], website: null })).toMatchObject([{ kind: "link", quote: "acme.io" }]);
  });

  test.for([
    "Thanks for sponsoring us last year!",
    "We'd love your continued support.",
    "As a past sponsor, you know our work.",
    "It was great working with you before.",
    // Typed into a live draft on 2026-11-07; only the AI check caught it then.
    "Last year Ferncliff Foods sponsored our Gold tier.",
    "Globex sponsored our hackathon before.",
    "In the past, your team was sponsoring the robotics expo.",
    "Previously Globex sponsored the Gold tier.",
    "Thanks for supporting us last year.",
    "You backed us before, and it meant a lot.",
  ])("flags a claimed history: %s", (text) => {
    expect(checkRules(text, RULES)).toMatchObject([{ kind: "history", reason: "Check this company really has a history with you." }]);
  });

  it("the invented sponsorship from the live test is flagged together with its number", () => {
    const text = "Last year Ferncliff Foods sponsored our Gold tier, and 40 companies backed us in total.";
    expect(checkRules(text, RULES).map((f) => [f.kind, f.quote])).toEqual([
      ["number", "40"],
      ["history", "Last year Ferncliff Foods sponsored"],
    ]);
  });

  test.for([
    "Would you consider sponsoring our hackathon this spring?",
    "Our sponsorship packet has the tiers. Last year 600 students came.",
    "Sponsoring the Gold tier puts your logo on every shirt.",
    "In the past year we grew a lot. Would Globex like to sponsor us?",
  ])("leaves an ask or an unrelated sentence alone: %s", (text) => {
    expect(checkRules(text, RULES).filter((f) => f.kind === "history")).toEqual([]);
  });

  it("collects the numbers in verified facts", () => {
    expect(factNumbers([{ text: "Gold is $2,500." }, { text: "600 students, 2,500 dollars" }])).toEqual(["2500", "600"]);
  });
});

describe("placeholders", () => {
  it("fills names in and takes them back out, longest name first", () => {
    const filled = fill("Hi {{firstName}}, from {{senderName}} of {{orgName}}", NAMES);
    expect(filled).toBe("Hi Hank, from Sam Lee of Org A");
    expect(unfill(`${filled}. Sam says hi.`, { ...NAMES, firstName: "Sam" })).toBe(
      "Hi Hank, from {{senderName}} of {{orgName}}. {{firstName}} says hi.",
    );
  });

  it("leaves a missing name alone, so 'there' is never replaced", () => {
    expect(unfill("Hi there, over there", { firstName: null, senderName: "", orgName: "Org A" })).toBe("Hi there, over there");
  });
  // A short first name is replaced only as a whole word: "Ed" is not in "Education" or "Edison".
  test.for([
    ["Ed", "Our Education Day reaches 1,200 students. Edison would approve. Thanks, Ed!", "Our Education Day reaches 1,200 students. Edison would approve. Thanks, {{firstName}}!"],
    ["Al", "Also, Al: we'd love a call. Alan says hi.", "Also, {{firstName}}: we'd love a call. Alan says hi."],
    ["Jo", "Join us, Jo. Jo's team and Jody too.", "Join us, {{firstName}}. {{firstName}}'s team and Jody too."],
    ["Di", "Did Di see it? Diana didn't.", "Did {{firstName}} see it? Diana didn't."],
    ["Ana", "Banana Ana anagram ANA", "Banana {{firstName}} anagram ANA"],
    ["Zoë", "Hi Zoë, Zoëlle wrote.", "Hi {{firstName}}, Zoëlle wrote."],
    ["J.R.", "Hi J.R., thanks. J.R.R. is someone else.", "Hi {{firstName}}, thanks. J.R.R. is someone else."],
  ] as const)("unfill replaces %s as a whole word only", ([name, text, expected]) => {
    expect(unfill(text, { firstName: name, senderName: "Sam Lee", orgName: "Org A" })).toBe(expected);
  });
});

describe("the AI check", () => {
  let companyId: string;

  beforeEach(async () => {
    await resetAndSeed();
    process.env.GEMINI_API_KEY = "test-key";
    await prisma.workspace.updateMany({ data: { aiEnabled: true } });
    const company = await createCompany(OWNER, { name: "Globex", website: "globex.com" });
    if (company.status !== "saved") throw new Error("flagged");
    companyId = company.companyId;
    await addFact(OWNER, "The annual hackathon draws 600 students.");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GEMINI_API_KEY;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const draft = { subject: "Org A at Purdue", body: "Hi Hank,\n\nOrg A has 900 members. Email sam@purdue.edu.\n\nSam Lee\nOrg A" };

  it("sends placeholders instead of names, masks contact details, and numbers the emails", async () => {
    fakeGemini(issues());
    await aiCheck(OWNER, [draft, { subject: "Two", body: "Second email" }], NAMES);
    const prompt = JSON.stringify(calls[0].body);
    expect(prompt).toContain("1. The annual hackathon draws 600 students.");
    expect(prompt).toContain('<email number=\\"1\\">\\nSubject: {{orgName}} at Purdue\\n\\nHi {{firstName}},');
    expect(prompt).toContain("{{orgName}} has 900 members. Email [email].");
    expect(prompt).toContain('<email number=\\"2\\">');
    expect(prompt).not.toMatch(/Hank|Sam Lee|sam@purdue/);
  });

  it("keeps only findings whose quote is really in that email, with names filled back in", async () => {
    fakeGemini(
      issues(
        { email: 1, quote: "{{orgName}} has 900 members", problem: "No fact gives a member count." },
        { email: 1, quote: "{{orgName}}  HAS 900 members", problem: "Same claim, said twice." },
        { email: 1, quote: "We won 12 awards", problem: "Not in the email at all." },
        { email: 2, quote: "{{orgName}} has 900 members", problem: "Wrong email." },
        { email: 1, quote: "Hi", problem: "Too short to mean anything." },
      ),
    );
    const [check] = await aiCheck(OWNER, [draft], NAMES);
    expect(check).toEqual({
      subject: draft.subject,
      body: draft.body,
      ai: [{ kind: "unsupported", quote: "Org A has 900 members", reason: "No fact gives a member count." }],
      error: null,
    });
  });

  it("sends a draft for a contact named Ed with 'Education' and 'Edison' intact", async () => {
    fakeGemini(issues());
    const text = { subject: "Education Day", body: "Hi Ed,\n\nOur Education Day reaches 1,200 students. Edison would approve.\n\nSam Lee\nOrg A" };
    await aiCheck(OWNER, [text], { ...NAMES, firstName: "Ed" });
    const prompt = JSON.stringify(calls[0].body);
    expect(prompt).toContain("Subject: Education Day");
    expect(prompt).toContain("Hi {{firstName}},");
    expect(prompt).toContain("Our Education Day reaches 1,200 students. Edison would approve.");
    expect(prompt).not.toContain("{{firstName}}ucation");
  });

  it("keeps the good findings when one quote is too long, and cuts a long problem to fit", async () => {
    fakeGemini(
      issues(
        { email: 1, quote: "x".repeat(301), problem: "Too long a quote." },
        { email: 1, quote: "{{orgName}} has 900 members", problem: `${"No fact gives a member count, ".repeat(10)}` },
      ),
    );
    const [check] = await aiCheck(OWNER, [draft], NAMES);
    expect(check.error).toBeNull();
    expect(check.ai).toHaveLength(1);
    expect(check.ai[0].quote).toBe("Org A has 900 members");
    expect(check.ai[0].reason.length).toBeLessThanOrEqual(200);
  });

  it("a reply whose every issue is broken is an error, never a clean result", async () => {
    const broken = () => answer(JSON.stringify({ issues: [{ email: "one", quote: 5, problem: null }, { email: "two" }] }));
    fakeGemini(broken(), broken(), broken());
    const [check] = await aiCheck(OWNER, [draft], NAMES);
    expect(check.ai).toEqual([]);
    expect(check.error).toBe("The AI sent back something unusable. Try again.");
    const logged = await withTenant(OWNER, (tx) => tx.aiRun.findMany({ where: { feature: "CLAIM_CHECK" }, select: { status: true, error: true } }));
    expect(logged).toEqual([{ status: "FAILED", error: "invalid_output" }]);
  });

  it("a 500 on Flash-Lite moves on to 3.6 Flash for Check again", async () => {
    fakeGemini(apiError(500, "Internal", "INTERNAL"), issues({ email: 1, quote: "{{orgName}} has 900 members", problem: "No member count." }));
    const [check] = await aiCheck(OWNER, [draft], NAMES);
    expect(check.ai).toHaveLength(1);
    expect(calls.map((c) => c.url.match(/models\/([^:]+)/)?.[1])).toEqual(["gemini-3.5-flash-lite", "gemini-3.6-flash"]);
  });

  it("returns the reason, and no AI findings, when the AI can't answer", async () => {
    // Every model in line is out of quota.
    fakeGemini(...Array.from({ length: 2 }, () => apiError(429, "Resource exhausted", "RESOURCE_EXHAUSTED")));
    expect(await aiCheck(OWNER, [draft], NAMES)).toEqual([{ ...draft, ai: [], error: "The AI is busy right now. Try again in a minute." }]);
  });

  // Recorded from the live test on 2026-11-07: a draft listed the Gold benefits the way the facts
  // define them ("everything in Silver, plus ..."), and the check flagged it: "The Gold tier
  // description combines benefits from multiple tiers instead of just the Gold tier benefits."
  it("tells the check to read the facts together, following one tier to the tier it builds on", async () => {
    await addFact(OWNER, "Silver ($1,000): logo on the event page, plus everything in Bronze.");
    await addFact(OWNER, "Bronze ($500): a thank-you post.");
    await addFact(OWNER, "Gold ($2,500): a booth, plus everything in Silver.");
    const gold = { subject: "Gold", body: "Hi Hank,\n\nGold ($2,500) gets a booth, logo on the event page and a thank-you post.\n\nSam Lee\nOrg A" };
    fakeGemini(issues());
    const [check] = await aiCheck(OWNER, [gold], NAMES);
    expect(check).toMatchObject({ ai: [], error: null });
    const body = calls[0].body as { systemInstruction: unknown; contents: unknown };
    const system = JSON.stringify(body.systemInstruction);
    expect(system).toContain("Read the facts together, not one at a time.");
    expect(system).toContain("resolve such a reference by following it to the fact it names");
    expect(system).not.toMatch(/student organization/);
    // Every verified fact goes in one numbered list, so a reference can be followed.
    const prompt = JSON.stringify(body.contents);
    expect(prompt).toMatch(/1\. The annual hackathon[^]*2\. Silver[^]*3\. Bronze[^]*4\. Gold/);
  });

  it("says when no facts are verified", async () => {
    await withTenant(OWNER, (tx) => tx.factSheetItem.deleteMany());
    fakeGemini(issues());
    await aiCheck(OWNER, [draft], NAMES);
    expect(JSON.stringify(calls[0].body)).toContain("(none verified)");
  });

  it("runs after drafting, and the result survives a reload", async () => {
    const variants = [{ angle: "A", subject: "Hello {{firstName}}", body: "Hi {{firstName}}, we have 900 members.\n\n{{senderName}}\n{{orgName}}" }];
    fakeGemini(answer(JSON.stringify({ variants })), issues({ email: 1, quote: "we have 900 members", problem: "No member count." }));
    const result = await draftEmail(OWNER, companyId, { kind: "FIRST_TOUCH", contactId: null, note: null });
    const expected = { subject: "Hello there", body: "Hi there, we have 900 members.\n\nownerA\nOrg A", ai: [expect.objectContaining({ quote: "we have 900 members" })], error: null };
    expect(result).toMatchObject({ ok: true, data: [{ check: expected }] });
    expect(calls[1].url).toContain("gemini-3.5-flash-lite");
    expect(await recentDrafts(OWNER, companyId)).toMatchObject([{ check: expected }]);
  });

  describe("Check again", () => {
    async function myDraft(member: Membership, withContact = true) {
      const contact = withContact ? await addContact(OWNER, companyId, { name: "Hank Scorpio", email: null, title: null }) : null;
      const variants = [{ angle: "A", subject: "Hi", body: "Hi {{firstName}}\n\n{{senderName}}\n{{orgName}}" }];
      fakeGemini(answer(JSON.stringify({ variants })), issues());
      const result = await draftEmail(member, companyId, { kind: "FIRST_TOUCH", contactId: contact?.ok ? contact.data.contactId : null, note: null });
      if (!result.ok) throw new Error(result.error);
      return result.data[0].id;
    }

    it("checks the edited text with names masked, and saves the result", async () => {
      const id = await myDraft(OFFICER);
      fakeGemini(issues({ email: 1, quote: "{{firstName}}, we won 12 awards", problem: "No awards fact." }));
      const text = { subject: "Hi", body: "Hi Hank, we won 12 awards.\n\nofficerA" };
      expect(await checkDraft(OFFICER, id, text)).toEqual({
        ok: true,
        data: { ...text, ai: [{ kind: "unsupported", quote: "Hank, we won 12 awards", reason: "No awards fact." }], error: null },
      });
      expect(JSON.stringify(calls[0].body)).toContain("Hi {{firstName}}, we won 12 awards.\\n\\n{{senderName}}");
      const stored = await withTenant(OWNER, (tx) => tx.aiDraft.findUniqueOrThrow({ where: { id }, select: { check: true } }));
      expect(readCheck(stored.check)).toMatchObject({ body: text.body });
    });

    it("doesn't turn 'there' into a placeholder when the draft had no contact", async () => {
      const id = await myDraft(OWNER, false);
      fakeGemini(issues());
      await checkDraft(OWNER, id, { subject: "Hi", body: "Hi there, over there." });
      expect(JSON.stringify(calls[0].body)).toContain("Hi there, over there.");
    });

    it("only checks your own draft", async () => {
      const id = await myDraft(OFFICER);
      fakeGemini();
      expect(await checkDraft(OWNER, id, { subject: "x", body: "y" })).toEqual({ ok: false, error: "Draft not found." });
      expect(await checkDraft(OTHER_ORG, id, { subject: "x", body: "y" })).toEqual({ ok: false, error: "Draft not found." });
      expect(calls).toHaveLength(0);
    });

    it("works through the form, and refuses bad input or a signed-out visitor", async () => {
      const id = await myDraft(OFFICER);
      const fields = { workspaceId: "a", draftId: id, subject: "Hi", body: "Hi Hank" };
      fakeGemini(issues());
      // Form text arrives with CRLF line breaks; the check must match the LF text on the page.
      expect(await asUser("officerA", () => checkAction(null, form({ ...fields, body: "Hi Hank,\r\n\r\nBye" })))).toMatchObject({
        ok: true,
        data: { body: "Hi Hank,\n\nBye", ai: [], error: null },
      });
      expect(await asUser("officerA", () => checkAction(null, form({ ...fields, body: "  " })))).toEqual({ ok: false, error: "Write the email first." });
      expect(await asUser("officerA", () => checkAction(null, form({ ...fields, subject: "x".repeat(301) })))).toEqual({
        ok: false,
        error: "The subject is too long to check.",
      });
      expect(await asUser("ownerB", () => checkAction(null, form(fields)))).toMatchObject({ ok: false });
      await expect(signedOut(() => checkAction(null, form(fields)))).rejects.toEqual(redirectTo("/signin"));
    });
  });

  it("reads back only checks in the shape it writes", () => {
    expect(readCheck(null)).toBeNull();
    expect(readCheck({ subject: "x" })).toBeNull();
    expect(readCheck({ subject: "s", body: "b", ai: [], error: null })).toEqual({ subject: "s", body: "b", ai: [], error: null });
  });
});
