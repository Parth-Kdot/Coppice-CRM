import { afterAll, afterEach, beforeEach, describe, expect, it, test, vi } from "vitest";
import { claimCompany as claimAction, forceRelease as forceReleaseAction, logOutreach as logAction, moveStage as moveAction, releaseClaim as releaseAction, setFollowUp as setFollowUpAction } from "@/app/(app)/[workspaceId]/companies/actions";
import { FOLLOW_UP_RANGE_MESSAGE } from "@/lib/claims";
import { addDays } from "@/lib/dates";
import { prisma, withTenant } from "@/lib/db";
import { askCopilot, previewMove, type CardInput } from "@/lib/copilot";
import { companyCard } from "@/lib/copilot/cards";
import { claimTaken, followUpClosed, NOT_YOURS_TO_RELEASE, OWNERS_FORCE_RELEASE, stageHeld } from "@/lib/claim-messages";
import { DEFAULT_FILTER } from "@/lib/copilot/intent";
import type { CopilotIntent } from "@/lib/validation";
import { form } from "./helpers/form";
import { calls, fakeGemini } from "./helpers/gemini";
import { groqAnswer } from "./helpers/groq";
import { asUser } from "./helpers/next-request";
import { NAMES, OFFICER, OTHER_ORG, OWNER, seedPipeline, type Pipeline } from "./helpers/copilot";
import { resetAndSeed } from "./helpers/seed";

vi.mock("next/headers", () => import("./helpers/next-request"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

// The confirm cards and the company card (lib/copilot/cards.ts) against the real database, and the
// existing server actions a confirm calls, which refuse what a card should never have offered.
let p: Pipeline;
beforeEach(async () => {
  await resetAndSeed();
  process.env.GROQ_API_KEY = "test-groq-key";
  await prisma.workspace.updateMany({ data: { aiEnabled: true } });
  p = await seedPipeline();
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GROQ_API_KEY;
});
afterAll(async () => {
  await prisma.$disconnect();
});

const card = async (who: typeof OFFICER, input: Partial<CardInput> & Pick<CardInput, "companyId" | "type">) => {
  const result = await previewMove(who, { stage: null, followUpOn: null, ...input });
  if (!result.ok) throw new Error(result.error);
  return result.data;
};
const NOT_FOUND = { ok: false, error: "Company not found." };

describe("a card says exactly what will happen, and whether it can", () => {
  it("CLAIM on a free company", async () => {
    expect(await card(OFFICER, { companyId: p.id.acme, type: "CLAIM" })).toMatchObject({
      type: "CLAIM",
      companyName: NAMES.acme,
      label: "Claim",
      text: "Claim Acme Tech for 14 days.",
      legal: true,
      reason: null,
      opensForm: false,
      href: `/a/companies/${p.id.acme}`,
    });
  });

  it("CLAIM on a company you hold renews it", async () => {
    expect(await card(OFFICER, { companyId: p.id.bramble, type: "CLAIM" })).toMatchObject({ label: "Renew claim", text: "Renew your claim on Bramblewick Consulting for 14 days.", legal: true });
  });

  it("CLAIM under someone else's live claim is disabled with the app's own words", async () => {
    const result = await card(OFFICER, { companyId: p.id.globex, type: "CLAIM" });
    expect(result.legal).toBe(false);
    expect(result.reason).toMatch(/^ownerA claimed this first\. They hold it until [A-Z][a-z]{2} \d{1,2}\.$/);
  });

  it("CLAIM on a closed company is disabled", async () => {
    expect(await card(OFFICER, { companyId: p.id.hooli, type: "CLAIM" })).toMatchObject({ legal: false, reason: "This company is Committed, so it can't be claimed." });
  });

  it("RELEASE of your own claim says the stage and date stay", async () => {
    expect(await card(OFFICER, { companyId: p.id.bramble, type: "RELEASE" })).toMatchObject({
      label: "Release",
      text: "Release your claim on Bramblewick Consulting. The stage and follow-up date stay as they are.",
      legal: true,
      force: false,
    });
  });

  it("RELEASE of someone else's live claim: an owner can force it, an officer can't", async () => {
    const owner = await card(OWNER, { companyId: p.id.bramble, type: "RELEASE" });
    expect(owner).toMatchObject({ legal: true, force: true, label: "Force release", text: "Force-release officerA's claim on Bramblewick Consulting." });
    const officer = await card(OFFICER, { companyId: p.id.globex, type: "RELEASE" });
    expect(officer).toMatchObject({ legal: false, force: false, reason: OWNERS_FORCE_RELEASE });
  });

  it("RELEASE of a company you don't hold is disabled", async () => {
    expect(await card(OFFICER, { companyId: p.id.acme, type: "RELEASE" })).toMatchObject({ legal: false, reason: NOT_YOURS_TO_RELEASE });
  });

  it("LOG opens the log form with nothing filled in, and is legal only on a company you hold", async () => {
    expect(await card(OFFICER, { companyId: p.id.bramble, type: "LOG" })).toMatchObject({
      opensForm: true,
      legal: true,
      label: "Log outreach",
      text: "Log outreach for Bramblewick Consulting. The log form opens, and you write the note and pick the follow-up date.",
    });
    expect(await card(OFFICER, { companyId: p.id.acme, type: "LOG" })).toMatchObject({ legal: false, reason: "Claim this company before logging outreach." });
    expect(await card(OWNER, { companyId: p.id.bramble, type: "LOG" })).toMatchObject({ legal: false });
    expect((await card(OWNER, { companyId: p.id.bramble, type: "LOG" })).reason).toMatch(/^officerA holds this company now, until .+\.$/);
  });

  test.for<[string, string, "CONTACTED" | "COMMITTED" | "DECLINED", string | null, string]>([
    ["a plain step forward", "acme", "CONTACTED", null, "Move Acme Tech to Contacted."],
    ["into Committed, which closes the pitch", "acme", "COMMITTED", "closes", "Move Acme Tech to Committed. This closes the pitch and releases any claim."],
    ["into Declined, which closes the pitch", "acme", "DECLINED", "closes", "Move Acme Tech to Declined. This closes the pitch and releases any claim."],
    ["backwards", "globex", "CONTACTED", "back", "Move Globex back from Replied to Contacted."],
    ["reopening a closed one", "hooli", "CONTACTED", "reopens", "Reopen Hooli as Contacted."],
  ])("MOVE_STAGE, %s", async ([, key, to, confirm, text]) => {
    const result = await card(OWNER, { companyId: p.id[key], type: "MOVE_STAGE", stage: to });
    expect(result).toMatchObject({ type: "MOVE_STAGE", stage: to, confirm, text, legal: true });
  });

  it("MOVE_STAGE under someone else's live claim: disabled for an officer, open to an owner", async () => {
    const officer = await card(OFFICER, { companyId: p.id.globex, type: "MOVE_STAGE", stage: "IN_CONVERSATION" });
    expect(officer.legal).toBe(false);
    expect(officer.reason).toMatch(/^ownerA holds this company until .+\. Ask them, or an owner\.$/);
    expect(await card(OWNER, { companyId: p.id.bramble, type: "MOVE_STAGE", stage: "REPLIED" })).toMatchObject({ legal: true });
  });

  it("MOVE_STAGE to the stage it is already in is disabled", async () => {
    expect(await card(OFFICER, { companyId: p.id.acme, type: "MOVE_STAGE", stage: "NOT_CONTACTED" })).toMatchObject({ legal: false, reason: "This company is already Not contacted." });
  });

  it("MOVE_STAGE needs a stage", async () => {
    expect(await previewMove(OFFICER, { companyId: p.id.acme, type: "MOVE_STAGE", stage: null, followUpOn: null })).toEqual({ ok: false, error: "Pick a stage." });
  });

  it("SET_FOLLOW_UP names the date and says nothing else changes", async () => {
    const on = addDays(p.today, 9);
    const result = await card(OFFICER, { companyId: p.id.acme, type: "SET_FOLLOW_UP", followUpOn: on });
    expect(result).toMatchObject({ followUpOn: on, legal: true, label: "Set follow-up" });
    expect(result.text).toMatch(/^Set the follow-up for Acme Tech to [A-Z][a-z]{2} \d{1,2}(, \d{4})?\. Nothing else changes\.$/);
  });

  it("SET_FOLLOW_UP: a date outside today to a year out is refused before a card exists", async () => {
    for (const on of [addDays(p.today, -1), addDays(p.today, 366), "2027-02-30", "soon", null]) {
      expect(await previewMove(OFFICER, { companyId: p.id.acme, type: "SET_FOLLOW_UP", stage: null, followUpOn: on })).toEqual({ ok: false, error: FOLLOW_UP_RANGE_MESSAGE });
    }
  });

  it("SET_FOLLOW_UP: disabled under someone's live claim (an owner too) and on a closed company", async () => {
    const on = addDays(p.today, 3);
    // Globex is held by ownerA, Bramblewick by officerA: nobody but the holder changes the date.
    expect(await card(OFFICER, { companyId: p.id.globex, type: "SET_FOLLOW_UP", followUpOn: on })).toMatchObject({ legal: false, reason: expect.stringMatching(/^ownerA holds this company until /) });
    expect(await card(OWNER, { companyId: p.id.bramble, type: "SET_FOLLOW_UP", followUpOn: on })).toMatchObject({ legal: false, reason: expect.stringMatching(/^officerA holds this company until /) });
    expect(await card(OFFICER, { companyId: p.id.hooli, type: "SET_FOLLOW_UP", followUpOn: on })).toMatchObject({ legal: false, reason: followUpClosed("COMMITTED") });
  });

  it("an archived company: every card is disabled", async () => {
    for (const type of ["CLAIM", "RELEASE", "LOG", "MOVE_STAGE", "SET_FOLLOW_UP"] as const) {
      const result = await card(OWNER, { companyId: p.id.archived, type, stage: type === "MOVE_STAGE" ? "REPLIED" : null, followUpOn: type === "SET_FOLLOW_UP" ? addDays(p.today, 2) : null });
      expect(result).toMatchObject({ legal: false, reason: "This company is archived." });
    }
  });

  it("a company in another workspace, or one that doesn't exist, has no card for any of the five", async () => {
    for (const type of ["CLAIM", "RELEASE", "LOG", "MOVE_STAGE", "SET_FOLLOW_UP"] as const) {
      const input = { type, stage: type === "MOVE_STAGE" ? ("REPLIED" as const) : null, followUpOn: type === "SET_FOLLOW_UP" ? addDays(p.today, 2) : null };
      expect(await previewMove(OWNER, { companyId: p.id.theirs, ...input })).toEqual(NOT_FOUND);
      expect(await previewMove(OWNER, { companyId: "nope", ...input })).toEqual(NOT_FOUND);
      expect(await previewMove(OTHER_ORG, { companyId: p.id.acme, ...input })).toEqual(NOT_FOUND);
    }
  });

  it("claimTaken and stageHeld are the app's words", () => {
    // The wordings the cards share with lib/claims.ts (tests/copilot-moves.test.ts checks them against the real actions).
    expect(claimTaken("Sam", new Date("2026-11-20T12:00:00Z"))).toBe("Sam claimed this first. They hold it until Nov 20.");
    expect(stageHeld("Sam", new Date("2026-11-20T12:00:00Z"))).toBe("Sam holds this company until Nov 20. Ask them, or an owner.");
  });
});

describe("a confirm still goes through the existing actions, which check again", () => {
  const ref = (workspaceId: string, companyId: string, extra: Record<string, string> = {}) => form({ workspaceId, companyId, ...extra });
  const company = (id: string, who = OWNER) =>
    withTenant(who, (tx) => tx.company.findUniqueOrThrow({ where: { id }, select: { stage: true, claimedById: true, claimExpiresAt: true, nextFollowUpAt: true, lastContactedAt: true, archivedAt: true } }));
  const outreachCount = () => withTenant(OWNER, (tx) => tx.outreach.count());

  it("an id from another workspace is refused by every action, and that company is left alone", async () => {
    const before = await company(p.id.theirs, OTHER_ORG);
    const outreach = await outreachCount();
    const on = addDays(p.today, 4);
    const results = await asUser("ownerA", async () => [
      await claimAction(null, ref("a", p.id.theirs)),
      await releaseAction(null, ref("a", p.id.theirs)),
      await forceReleaseAction(null, ref("a", p.id.theirs)),
      await moveAction(null, ref("a", p.id.theirs, { stage: "REPLIED" })),
      await setFollowUpAction(null, ref("a", p.id.theirs, { followUpOn: on })),
      await logAction(null, ref("a", p.id.theirs, { channel: "EMAIL", note: "", followUpOn: on })),
    ]);
    for (const result of results) expect(result.ok).toBe(false);
    expect(await company(p.id.theirs, OTHER_ORG)).toEqual(before);
    expect(await outreachCount()).toBe(outreach);
  });

  it("naming the other workspace in the form doesn't help either: a person acts only where they are a member", async () => {
    const results = await asUser("ownerA", async () => [
      await claimAction(null, ref("b", p.id.theirs)),
      await moveAction(null, ref("b", p.id.theirs, { stage: "REPLIED" })),
      await setFollowUpAction(null, ref("b", p.id.theirs, { followUpOn: addDays(p.today, 4) })),
    ]);
    for (const result of results) expect(result.ok).toBe(false);
  });

  it("an officer can't get an owner-only move: force release is refused and the claim stays", async () => {
    const before = await company(p.id.globex);
    const result = await asUser("officerA", () => forceReleaseAction(null, ref("a", p.id.globex)));
    expect(result.ok).toBe(false);
    expect(await company(p.id.globex)).toEqual(before);
    // Releasing it as an ordinary release is refused too: it isn't theirs.
    expect(await asUser("officerA", () => releaseAction(null, ref("a", p.id.globex)))).toEqual({ ok: false, error: NOT_YOURS_TO_RELEASE });
    expect(await company(p.id.globex)).toEqual(before);
  });

  it("an owner can force it, which is what the card offered", async () => {
    expect((await asUser("ownerA", () => forceReleaseAction(null, ref("a", p.id.bramble)))).ok).toBe(true);
    expect((await company(p.id.bramble)).claimedById).toBeNull();
  });

  it("setFollowUp confirms what its card said: the date changes and nothing else does", async () => {
    const on = addDays(p.today, 9);
    const before = await company(p.id.acme);
    expect(await asUser("officerA", () => setFollowUpAction(null, ref("a", p.id.acme, { followUpOn: on })))).toEqual({ ok: true, data: undefined });
    const after = await company(p.id.acme);
    expect(after.nextFollowUpAt).not.toEqual(before.nextFollowUpAt);
    expect({ ...after, nextFollowUpAt: null }).toEqual({ ...before, nextFollowUpAt: null });
  });

  it("a card that was legal a minute ago is refused if the claim changed in between", async () => {
    const on = addDays(p.today, 5);
    expect((await card(OFFICER, { companyId: p.id.acme, type: "SET_FOLLOW_UP", followUpOn: on })).legal).toBe(true);
    await asUser("ownerA", () => claimAction(null, ref("a", p.id.acme)));
    const refused = await asUser("officerA", () => setFollowUpAction(null, ref("a", p.id.acme, { followUpOn: on })));
    expect(refused).toMatchObject({ ok: false, error: expect.stringContaining("ownerA holds this company until") });
    expect((await company(p.id.acme)).nextFollowUpAt).toBeNull();
  });
});

describe("Apply all and the cap, from a model's actions", () => {
  const turn = (actions: CopilotIntent["actions"]): CopilotIntent => ({ view: "none", reply: "Done.", filter: null, company: null, minutes: null, guideTopics: [], actions });
  const list: CopilotIntent = { view: "companies", reply: "These.", filter: DEFAULT_FILTER, company: null, minutes: null, guideTopics: [], actions: [] };

  it("is offered only when every card sets a follow-up date", async () => {
    const on = addDays(p.today, 6);
    fakeGemini(
      groqAnswer(list),
      groqAnswer(turn([{ type: "SET_FOLLOW_UP", companyIds: [p.id.bramble, p.id.acme], stage: null, followUpOn: on }])),
      groqAnswer(turn([{ type: "SET_FOLLOW_UP", companyIds: [p.id.bramble], stage: null, followUpOn: on }, { type: "CLAIM", companyIds: [p.id.acme], stage: null, followUpOn: null }])),
      groqAnswer(turn([{ type: "SET_FOLLOW_UP", companyIds: [p.id.bramble], stage: null, followUpOn: on }])),
    );
    const first = await askCopilot(OFFICER, { threadId: null, question: "Show everything" });
    if (!first.ok) throw new Error(first.error);
    const ask = async (question: string) => {
      const result = await askCopilot(OFFICER, { threadId: first.data.threadId, question });
      if (!result.ok) throw new Error(result.error);
      return result.data;
    };
    const dates = await ask("push the first two out a week");
    expect(dates.cards.map((c) => [c.type, c.companyId, c.followUpOn, c.legal])).toEqual([
      ["SET_FOLLOW_UP", p.id.bramble, on, true],
      ["SET_FOLLOW_UP", p.id.acme, on, true],
    ]);
    expect(dates.applyAll).toBe(true);
    expect((await ask("and claim acme")).applyAll).toBe(false);
    // One card alone is just a card.
    expect((await ask("only bramblewick")).applyAll).toBe(false);
    expect(calls).toHaveLength(4);
  });
});

describe("the company card", () => {
  it("shows the company as the app does: stage, claim, dates, contacts and the last three outreach entries", async () => {
    await withTenant(OWNER, async (tx) => {
      await tx.contact.create({ data: { workspaceId: "a", companyId: p.id.bramble, name: "Dana", email: "dana@bramble.example", title: "Recruiter" } });
      for (let i = 1; i <= 4; i++) await tx.outreach.create({ data: { workspaceId: "a", companyId: p.id.bramble, senderId: "officerA", channel: "EMAIL", note: `Touch ${i}`, sentAt: new Date(Date.now() - (5 - i) * 86_400_000) } });
    });
    const result = await companyCard(OFFICER, p.id.bramble);
    expect(result).toMatchObject({
      id: p.id.bramble,
      name: NAMES.bramble,
      stage: "CONTACTED",
      stageLabel: "Contacted",
      industry: "Consulting",
      archived: false,
      dueLabel: "12 days overdue",
      claim: { state: "mine", holderName: "officerA" },
      outreachTotal: 5,
      href: `/a/companies/${p.id.bramble}`,
    });
    expect(result?.contacts).toEqual([expect.objectContaining({ name: "Dana", email: "dana@bramble.example", title: "Recruiter" })]);
    expect(result?.outreach.map((o) => o.note)).toEqual(["Sent the packet.", "Touch 4", "Touch 3"]);
    expect(result?.outreach).toHaveLength(3);
  });

  it("lists the legal moves for this person, and the stages a move can go to", async () => {
    const officer = await companyCard(OFFICER, p.id.globex);
    expect(officer?.moves.MOVE_STAGE.legal).toBe(false);
    expect(officer?.stages).toEqual([]);
    expect(officer?.moves.RELEASE).toMatchObject({ legal: false, reason: OWNERS_FORCE_RELEASE });
    const owner = await companyCard(OWNER, p.id.globex);
    expect(owner?.moves.MOVE_STAGE.legal).toBe(true);
    expect(owner?.stages.map((s) => [s.stage, s.confirm])).toEqual([
      ["NOT_CONTACTED", "back"],
      ["CONTACTED", "back"],
      ["IN_CONVERSATION", null],
      ["COMMITTED", "closes"],
      ["DECLINED", "closes"],
    ]);
  });

  it("is not found for a company in another workspace, an archived-or-missing id aside", async () => {
    expect(await companyCard(OWNER, p.id.theirs)).toBeNull();
    expect(await companyCard(OWNER, "nope")).toBeNull();
    expect((await companyCard(OWNER, p.id.archived))?.archived).toBe(true);
  });
});
