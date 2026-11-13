import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { askQuestion, chooseStarter, previewCard, removeChip, showAgain, startConversation } from "@/app/(app)/[workspaceId]/ask/actions";
import { prisma, withTenant } from "@/lib/db";
import { AI_OFF_MESSAGE } from "@/lib/ai/run";
import { COPILOT_NOT_CONFIGURED, type CopilotResult } from "@/lib/copilot";
import { DEFAULT_FILTER } from "@/lib/copilot/intent";
import type { CopilotFilter, CopilotIntent } from "@/lib/validation";
import { calls, fakeGemini } from "./helpers/gemini";
import { groqAnswer } from "./helpers/groq";
import { redirectTo } from "./helpers/form";
import { asUser, signedOut } from "./helpers/next-request";
import { NAMES, OFFICER, seedPipeline, type Pipeline } from "./helpers/copilot";
import { resetAndSeed } from "./helpers/seed";

// The actions behind the Ask Coppice screen (app/(app)/[workspaceId]/ask/actions.ts), as the browser
// calls them: real actions, real database as app_user, Groq replaced by a fake fetch. Starters, chip
// edits, Show again, New conversation and next-move chips make no AI call (the fake queues no reply
// for them, so an extra call throws).
vi.mock("next/headers", () => import("./helpers/next-request"));

let p: Pipeline;
beforeEach(async () => {
  await resetAndSeed();
  process.env.GROQ_API_KEY = "test-groq-key";
  await prisma.workspace.update({ where: { id: "a" }, data: { aiEnabled: true } });
  p = await seedPipeline();
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GROQ_API_KEY;
});
afterAll(async () => {
  await prisma.$disconnect();
});

const intent = (rest: Partial<CopilotIntent> & Pick<CopilotIntent, "view">): CopilotIntent => ({ reply: "Here you go.", filter: null, company: null, minutes: null, guideTopics: [], actions: [], ...rest });
const list = (filter: Partial<CopilotFilter> = {}) => intent({ view: "companies", filter: { ...DEFAULT_FILTER, ...filter } });
const NOT_OK = { ok: false, error: expect.any(String) };
const officer = <T>(run: () => Promise<T>) => asUser("officerA", run);
const win = (result: CopilotResult) => {
  if (!result.ok) throw new Error(result.error);
  return result.data;
};
const turnCount = () => withTenant(OFFICER, (tx) => tx.copilotTurn.count());

describe("who may call them", () => {
  const calls_ = (): [string, () => Promise<unknown>][] => [
    ["askQuestion", () => askQuestion({ workspaceId: "a", threadId: null, question: "Who's overdue?", retryOf: null })],
    ["chooseStarter", () => chooseStarter({ workspaceId: "a", threadId: null, starter: "overdue" })],
    ["showAgain", () => showAgain({ workspaceId: "a", turnId: "t1", filter: null })],
    ["removeChip", () => removeChip({ workspaceId: "a", turnId: "t1", filter: DEFAULT_FILTER, remove: "due" })],
    ["startConversation", () => startConversation("a")],
    ["previewCard", () => previewCard({ workspaceId: "a", companyId: p.id.acme, type: "CLAIM", stage: null, followUpOn: null })],
  ];

  it("sends a signed-out visitor to /signin and writes nothing", async () => {
    fakeGemini();
    for (const [, run] of calls_()) await expect(signedOut(run)).rejects.toEqual(redirectTo("/signin"));
    expect(calls).toHaveLength(0);
    expect(await prisma.copilotTurn.count()).toBe(0);
    expect(await prisma.copilotThread.count()).toBe(0);
  });

  it("refuses a member of another workspace, with no AI call and nothing saved", async () => {
    fakeGemini();
    for (const [name, run] of calls_()) {
      const result = await asUser("ownerB", run);
      expect(result, name).toMatchObject({ ok: false });
    }
    expect(calls).toHaveLength(0);
    expect(await prisma.copilotTurn.count()).toBe(0);
    expect(await prisma.copilotThread.count()).toBe(0);
  });

  it("refuses input that doesn't fit the schema, before anything else", async () => {
    fakeGemini();
    expect(await officer(() => askQuestion({ workspaceId: "a", threadId: null, question: "   ", retryOf: null }))).toMatchObject({ ok: false, error: "Ask a question." });
    expect(await officer(() => askQuestion({ workspaceId: "a", threadId: null, question: "x".repeat(501), retryOf: null }))).toMatchObject({ ok: false, error: "A question can be at most 500 characters." });
    expect(await officer(() => askQuestion({ workspaceId: "a" }))).toMatchObject({ ok: false });
    expect(await officer(() => chooseStarter({ workspaceId: "a", threadId: null, starter: "delete-everything" }))).toEqual(NOT_OK);
    expect(await officer(() => removeChip({ workspaceId: "a", turnId: "t1", filter: DEFAULT_FILTER, remove: "workspaceId" }))).toEqual(NOT_OK);
    expect(await officer(() => previewCard({ workspaceId: "a", companyId: p.id.acme, type: "CLAIM", stage: null, followUpOn: "next friday" }))).toEqual(NOT_OK);
    expect(calls).toHaveLength(0);
  });
});

describe("a question, and what the screen does with the answer", () => {
  it("answers with one AI call, then edits the chips, shows it again and starts over with none", async () => {
    fakeGemini(groqAnswer(list({ due: "overdue", industry: "Technology" })));
    const answer = win(await officer(() => askQuestion({ workspaceId: "a", threadId: null, question: "who's overdue in tech?", retryOf: null })));
    expect(calls).toHaveLength(1);
    expect(answer.chips.map((c) => c.key)).toEqual(["stages", "due", "industry", "sort"]);
    expect(answer.rows.map((r) => r.name)).toEqual([NAMES.globex]);

    // Take the industry off: the same list without it, from the stored turn, no AI call.
    const edited = await officer(() => removeChip({ workspaceId: "a", turnId: answer.turnId, filter: answer.filter as CopilotFilter, remove: "industry" }));
    expect(edited.ok && edited.data.chips.map((c) => c.key)).toEqual(["stages", "due", "sort"]);
    expect(edited.ok && edited.data.rows.map((r) => r.name)).toEqual([NAMES.bramble, NAMES.globex, NAMES.aperture]);
    // It is saved, so the next question builds on what the person sees.
    const stored = await withTenant(OFFICER, (tx) => tx.copilotTurn.findUniqueOrThrow({ where: { id: answer.turnId }, select: { intent: true } }));
    expect((stored.intent as { filter: CopilotFilter }).filter.industry).toBeNull();

    // Show again: the stored intent, run fresh.
    const again = await officer(() => showAgain({ workspaceId: "a", turnId: answer.turnId, filter: null }));
    expect(again.ok && again.data.rows).toHaveLength(3);

    const fresh = await officer(() => startConversation("a"));
    expect(fresh.ok && fresh.data.threadId).toEqual(expect.any(String));
    expect(calls).toHaveLength(1);
  });

  it("starts a conversation with a starter chip and keeps going in it", async () => {
    fakeGemini();
    const first = await officer(() => chooseStarter({ workspaceId: "a", threadId: null, starter: "claims" }));
    expect(first.ok && first.data).toMatchObject({ question: "My claims", view: "companies" });
    const threadId = first.ok ? first.data.threadId : "";
    const second = await officer(() => chooseStarter({ workspaceId: "a", threadId, starter: "how-claims-work" }));
    expect(second.ok && second.data.threadId).toBe(threadId);
    expect(second.ok && second.data.guide.map((g) => g.id)).toEqual(["claims", "release"]);
    expect(calls).toHaveLength(0);
    expect(await turnCount()).toBe(2);
  });

  it("asks again for a failed turn and replaces it", async () => {
    fakeGemini(new Response("{}", { status: 503 }), groqAnswer(list()));
    const failed = await officer(() => askQuestion({ workspaceId: "a", threadId: null, question: "Show everything", retryOf: null }));
    expect(failed).toMatchObject({ ok: false, retryable: true, turnId: expect.any(String), threadId: expect.any(String) });
    if (failed.ok) throw new Error("should have failed");
    const retried = await officer(() => askQuestion({ workspaceId: "a", threadId: failed.threadId, question: "Show everything", retryOf: failed.turnId }));
    expect(retried.ok && retried.data.threadId).toBe(failed.threadId);
    expect(await turnCount()).toBe(1);
  });

  it("says why when AI is off or Groq isn't set up, and the starter chips still say the same", async () => {
    fakeGemini();
    delete process.env.GROQ_API_KEY;
    expect(await officer(() => askQuestion({ workspaceId: "a", threadId: null, question: "Show everything", retryOf: null }))).toMatchObject({ ok: false, error: COPILOT_NOT_CONFIGURED });
    expect((await officer(() => chooseStarter({ workspaceId: "a", threadId: null, starter: "overdue" }))).ok).toBe(true);
    await prisma.workspace.update({ where: { id: "a" }, data: { aiEnabled: false } });
    expect(await officer(() => askQuestion({ workspaceId: "a", threadId: null, question: "Show everything", retryOf: null }))).toMatchObject({ ok: false, error: AI_OFF_MESSAGE });
    expect(await officer(() => chooseStarter({ workspaceId: "a", threadId: null, starter: "overdue" }))).toEqual({ ok: false, error: AI_OFF_MESSAGE });
    expect(await officer(() => startConversation("a"))).toEqual({ ok: false, error: AI_OFF_MESSAGE });
    expect(calls).toHaveLength(0);
  });

  it("won't show or edit another person's turn", async () => {
    fakeGemini();
    const mine = await officer(() => chooseStarter({ workspaceId: "a", threadId: null, starter: "overdue" }));
    if (!mine.ok) throw new Error(mine.error);
    // The owner of the same workspace can't reach an officer's conversation.
    expect(await asUser("ownerA", () => showAgain({ workspaceId: "a", turnId: mine.data.turnId, filter: null }))).toEqual({ ok: false, error: "Conversation not found." });
    expect(await asUser("ownerA", () => removeChip({ workspaceId: "a", turnId: mine.data.turnId, filter: mine.data.filter as CopilotFilter, remove: "due" }))).toEqual({
      ok: false,
      error: "Conversation not found.",
    });
  });
});

describe("a next-move chip", () => {
  it("builds the confirm card for one move from the company as it is now, with no AI call", async () => {
    fakeGemini();
    const result = await officer(() => previewCard({ workspaceId: "a", companyId: p.id.acme, type: "CLAIM", stage: null, followUpOn: null }));
    expect(result).toMatchObject({ ok: true, data: { type: "CLAIM", legal: true, companyName: NAMES.acme, label: "Claim" } });
    // Held by someone else: still a card, disabled, with the app's reason.
    const held = await officer(() => previewCard({ workspaceId: "a", companyId: p.id.globex, type: "CLAIM", stage: null, followUpOn: null }));
    expect(held).toMatchObject({ ok: true, data: { legal: false, reason: expect.stringContaining("claimed this first") } });
    expect(calls).toHaveLength(0);
  });

  it("doesn't find a company of another workspace", async () => {
    const other = await withTenant({ userId: "ownerB", workspaceId: "b" }, (tx) => tx.company.findFirstOrThrow({ select: { id: true } }));
    expect(await officer(() => previewCard({ workspaceId: "a", companyId: other.id, type: "CLAIM", stage: null, followUpOn: null }))).toEqual({ ok: false, error: "Company not found." });
  });
});
