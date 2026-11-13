import type { Membership } from "@/lib/authz";
import { AI_ERROR_MESSAGES, AI_OFF_MESSAGE, copilotToday, DAILY_COPILOT_PER_PERSON, aiGate, isRetryableAiError, reserveAi, runAi } from "@/lib/ai/run";
import { isConfigured } from "@/lib/ai/client";
import { dbNow, dbToday } from "@/lib/claims";
import { listIndustries } from "@/lib/companies";
import { prisma } from "@/lib/db";
import { buildView, type BuiltView, type CopilotView, type ViewParts } from "@/lib/copilot/answer";
import { filterChips, type FilterChip } from "@/lib/copilot/chips";
import { GUIDE_IDS, guideIndex } from "@/lib/copilot/guide";
import { checkIntent, NONE_INTENT, questionProblem, recheckStored, type CheckContext } from "@/lib/copilot/intent";
import { namesOf, newThread, openForTurn, readThread, readTurn, recordTurn, saveEdit, type Turn } from "@/lib/copilot/memory";
import { buildPrompt } from "@/lib/copilot/prompt";
import { starterById, STARTERS, type Starter, type StarterId } from "@/lib/copilot/starters";
import { copilotIntentSchema, type ActionResult, type CopilotFilter } from "@/lib/validation";

// Ask Coppice: the entry points the screen calls. A person asks a question in plain English; one
// Groq call turns it into an intent; code checks the intent, reads the workspace and builds
// everything shown. The model never sees pipeline rows, notes, contacts or outreach history and
// calls no tools (see lib/copilot/prompt.ts for exactly what it is sent). So:
//   askCopilot      one AI call: reserve it, ask Groq outside any transaction, check, run, save the turn.
//   runStarter      a starter chip: a fixed intent, no AI call.
//   rerunTurn       "Show again" (and a chip edit, with a new filter): the stored intent run fresh, no AI call.
//   openThread      a reloaded thread: each turn's question, reply and chips, and the latest turn's rows, fresh.
//   startThread     "New conversation".
//   previewMove     a next-move chip: the confirm card for one action, from the company as it is now.
//   copilotStatus   what the screen needs to know first: AI on, Groq set up, questions used today.
// Callers check membership first (requireMembership) and pass the Membership; nothing here trusts a
// workspace id from anywhere else. Confirming a card calls the existing server actions
// (app/(app)/[workspaceId]/companies/actions.ts), which check everything again.

export { previewMove, type ActionCard, type CardInput, type CompanyCard } from "@/lib/copilot/cards";
export { filterChips, withoutChip, type FilterChip } from "@/lib/copilot/chips";
export { GUIDE, type GuideTopic } from "@/lib/copilot/guide";
export { legalMoves, nextBestMove, type LegalMoves, type Move, type MoveType, type NextMove } from "@/lib/copilot/moves";
export type { CopilotRow } from "@/lib/copilot/query";
export type { CopilotView } from "@/lib/copilot/answer";
export { STARTERS, type Starter, type StarterId } from "@/lib/copilot/starters";
export { COPILOT_ROWS } from "@/lib/copilot/query";

export const COPILOT_NOT_CONFIGURED = "Ask Coppice isn't set up on this server yet. It needs a Groq key. The starter chips still work.";
export const COPILOT_RATE_LIMITED = "Groq's free tier has reached its limit for the minute. Wait a minute, then try again.";
const THREAD_NOT_FOUND = "Conversation not found.";
const TURN_UNANSWERED = "That question didn't get an answer. Ask it again.";

// Everything a finished turn shows, plus where it belongs.
export type CopilotAnswer = ViewParts & {
  threadId: string;
  turnId: string;
  question: string;
  createdAt: string;
};

// A call that didn't produce an answer. `retryable`: asking again can help (a busy service, a
// timeout, a reply that failed the checks). `rateLimited`: Groq's free tier, so the screen can count
// down a minute like Smart import does. `turnId` and `threadId` are set when the failure was saved
// as a turn in the thread (the AI was asked and failed); a refusal before any AI call saves nothing.
export type CopilotFailure = { ok: false; error: string; retryable: boolean; rateLimited: boolean; threadId: string | null; turnId: string | null };
export type CopilotResult = { ok: true; data: CopilotAnswer } | CopilotFailure;

const failure = (error: string, extra: Partial<Pick<CopilotFailure, "retryable" | "rateLimited" | "threadId" | "turnId">> = {}): CopilotFailure => ({
  ok: false,
  error,
  retryable: false,
  rateLimited: false,
  threadId: null,
  turnId: null,
  ...extra,
});

// ----- What the screen needs first -----

export type CopilotStatus = { aiOn: boolean; groqConfigured: boolean; askedToday: number; dailyLimit: number };

export async function copilotStatus(member: Membership): Promise<CopilotStatus> {
  const [workspace, askedToday] = await Promise.all([
    prisma.workspace.findUniqueOrThrow({ where: { id: member.workspaceId }, select: { aiEnabled: true } }),
    copilotToday(member),
  ]);
  return { aiOn: workspace.aiEnabled, groqConfigured: isConfigured("groq"), askedToday, dailyLimit: DAILY_COPILOT_PER_PERSON };
}

async function aiTurnedOff(member: Membership): Promise<boolean> {
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: member.workspaceId }, select: { aiEnabled: true } });
  return !workspace.aiEnabled;
}

// ----- Failures that were saved as turns -----

// The short code a failed turn keeps, from the message people were shown.
function codeOf(message: string, brokeRules: boolean): string {
  if (brokeRules) return "broke_rules";
  if (message === COPILOT_RATE_LIMITED) return "rate_limited";
  const found = Object.entries(AI_ERROR_MESSAGES).find(([, text]) => text === message);
  return found ? found[0] : "unavailable";
}
const BROKE_RULES_MESSAGE = "The AI's answer didn't pass Coppice's checks. Try again.";
const messageOfCode = (code: string | null): string =>
  code === "rate_limited" ? COPILOT_RATE_LIMITED : code === "broke_rules" ? BROKE_RULES_MESSAGE : (AI_ERROR_MESSAGES as Record<string, string>)[code ?? ""] ?? AI_ERROR_MESSAGES.unavailable;
const retryableCode = (code: string | null) => code === "rate_limited" || isRetryableAiError(messageOfCode(code));

// ----- Building an answer -----

function present(built: BuiltView, ids: { threadId: string; turnId: string; question: string; createdAt: Date }): CopilotAnswer {
  return { ...built.parts, threadId: ids.threadId, turnId: ids.turnId, question: ids.question, createdAt: ids.createdAt.toISOString() };
}

// ----- One AI call per typed question -----

export type AskInput = {
  // The conversation, or null to start one.
  threadId: string | null;
  question: string;
  // A failed turn this question asks again: it is replaced by the new answer.
  retryOf?: string | null;
};

export async function askCopilot(member: Membership, input: AskInput): Promise<CopilotResult> {
  const problem = questionProblem(input.question);
  if (problem) return failure(problem);
  const question = input.question.trim();
  // Refused before anything is written: AI off, no key, the workspace's limit, this person's 50 a day.
  if (await aiTurnedOff(member)) return failure(AI_OFF_MESSAGE);
  if (!isConfigured("groq")) return failure(COPILOT_NOT_CONFIGURED);
  const gate = await aiGate(member, "COPILOT");
  if (!gate.ok) return failure(gate.error);

  const now = await dbNow();
  const today = await dbToday();
  const thread = await openForTurn(member, input.threadId, now);
  const industries = await listIndustries(member);
  const shown = await namesOf(member, thread.shownIds);
  const guide = guideIndex();
  const check: CheckContext = {
    question,
    shownIds: new Set(shown.map((s) => s.id)),
    industries,
    today,
    guideIds: GUIDE_IDS,
    names: [...shown.map((s) => s.name), ...guide.map((g) => g.title)],
  };
  const { system, prompt } = buildPrompt({
    today,
    role: member.role,
    industries,
    guide,
    turns: thread.turns.flatMap((t) => (t.intent ? [{ question: t.question, intent: t.intent }] : [])),
    shown,
    question,
  });

  // The call is reserved (counted) first, in its own transaction under the workspace lock, then made
  // here, outside any transaction: nothing holds a database connection while Groq answers.
  const reserved = await reserveAi(member, "COPILOT");
  if (!reserved.ok) return failure(reserved.error);
  let brokeRules = false;
  const result = await runAi(
    member,
    { feature: "COPILOT", system, prompt, schema: copilotIntentSchema },
    {
      reservation: reserved.data,
      accept: (raw) => {
        if (checkIntent(raw, check).usable) return null;
        brokeRules = true;
        return "broke_rules";
      },
      messages: { rate_limited: COPILOT_RATE_LIMITED },
    },
  );

  if (!result.ok) {
    const code = codeOf(result.error, brokeRules);
    const saved = await recordTurn(
      member,
      { threadId: thread.threadId, question, intent: NONE_INTENT, reply: result.error, shown: [], status: "FAILED", error: code, retryOf: input.retryOf },
      await dbNow(),
    );
    return failure(result.error, { retryable: retryableCode(code), rateLimited: code === "rate_limited", threadId: saved.threadId, turnId: saved.turnId });
  }

  const checked = checkIntent(result.data, check);
  const built = await buildView(member, checked.intent, checked.notes, now);
  const saved = await recordTurn(
    member,
    { threadId: thread.threadId, question, intent: built.intent, reply: built.parts.reply, shown: built.shown, status: "ANSWERED", error: null, retryOf: input.retryOf },
    await dbNow(),
  );
  return { ok: true, data: present(built, { ...saved, question }) };
}

// ----- Starter chips: a fixed intent, no AI call -----

export async function runStarter(member: Membership, input: { threadId: string | null; starter: StarterId }): Promise<ActionResult<CopilotAnswer>> {
  const starter: Starter | undefined = starterById(input.starter);
  if (!starter) return { ok: false, error: "That starter isn't available." };
  if (await aiTurnedOff(member)) return { ok: false, error: AI_OFF_MESSAGE };
  const now = await dbNow();
  const thread = await openForTurn(member, input.threadId, now);
  const built = await buildView(member, starter.intent, [], now);
  const saved = await recordTurn(
    member,
    { threadId: thread.threadId, question: starter.label, intent: built.intent, reply: built.parts.reply, shown: built.shown, status: "ANSWERED", error: null },
    await dbNow(),
  );
  return { ok: true, data: present(built, { ...saved, question: starter.label }) };
}

// ----- Show again, and chip edits: the stored intent, run fresh, no AI call -----

async function checkContext(member: Membership, question: string, today: string): Promise<Omit<CheckContext, "shownIds">> {
  return { question, industries: await listIndustries(member), today, guideIds: GUIDE_IDS };
}

// Runs a turn's stored intent again against the workspace as it is now. With `filter` (a chip edit),
// the turn's filter becomes that one (checked like the model's, and saved), so the next question
// builds on what the person sees. Only a list of companies has a filter to edit.
export async function rerunTurn(member: Membership, turnId: string, filter: CopilotFilter | null = null): Promise<ActionResult<CopilotAnswer>> {
  if (await aiTurnedOff(member)) return { ok: false, error: AI_OFF_MESSAGE };
  const turn = await readTurn(member, turnId);
  if (!turn) return { ok: false, error: THREAD_NOT_FOUND };
  if (turn.status !== "ANSWERED" || !turn.intent) return { ok: false, error: TURN_UNANSWERED };
  if (filter && turn.intent.view !== "companies") return { ok: false, error: "This answer has no filters to change." };

  const now = await dbNow();
  const base = filter ? { ...turn.intent, filter } : turn.intent;
  const checked = recheckStored(base, await checkContext(member, turn.question, await dbToday()));
  if (!checked.usable) return { ok: false, error: TURN_UNANSWERED };
  const built = await buildView(member, checked.intent, checked.notes, now);
  if (filter) await saveEdit(member, turnId, built.intent, built.shown);
  return { ok: true, data: present(built, { threadId: turn.threadId, turnId: turn.id, question: turn.question, createdAt: turn.createdAt }) };
}

// ----- Threads -----

export async function startThread(member: Membership): Promise<ActionResult<{ threadId: string }>> {
  if (await aiTurnedOff(member)) return { ok: false, error: AI_OFF_MESSAGE };
  return { ok: true, data: { threadId: await newThread(member) } };
}

// A turn as a reloaded thread lists it: the question, the reply and the chips, with no rows.
export type TurnView = {
  turnId: string;
  question: string;
  reply: string;
  status: "ANSWERED" | "FAILED";
  // The failure in plain words, for a FAILED turn.
  error: string | null;
  retryable: boolean;
  view: CopilotView;
  chips: FilterChip[];
  createdAt: string;
};

function turnView(turn: Turn): TurnView {
  const failed = turn.status === "FAILED";
  return {
    turnId: turn.id,
    question: turn.question,
    reply: failed ? "" : turn.reply,
    status: turn.status,
    error: failed ? messageOfCode(turn.error) : null,
    retryable: failed && retryableCode(turn.error),
    view: turn.intent?.view ?? "none",
    chips: turn.intent?.view === "companies" && turn.intent.filter ? filterChips(turn.intent.filter) : [],
    createdAt: turn.createdAt.toISOString(),
  };
}

export type OpenedThread = {
  // null when the person has no conversation yet.
  threadId: string | null;
  turns: TurnView[];
  // The latest answered turn, with its rows read fresh. Older turns have "Show again" (rerunTurn).
  latest: CopilotAnswer | null;
};

// The thread to show: the one asked for, else the person's most recent. Only the latest turn's rows
// are read again; every other turn is just its question, reply and chips.
export async function openThread(member: Membership, threadId: string | null = null): Promise<OpenedThread> {
  const thread = await readThread(member, threadId);
  if (!thread) return { threadId: null, turns: [], latest: null };
  const last = thread.turns[thread.turns.length - 1];
  let latest: CopilotAnswer | null = null;
  if (last && last.status === "ANSWERED" && last.intent) {
    const checked = recheckStored(last.intent, await checkContext(member, last.question, await dbToday()));
    if (checked.usable) {
      const built = await buildView(member, checked.intent, checked.notes, await dbNow());
      latest = present(built, { threadId: thread.threadId, turnId: last.id, question: last.question, createdAt: last.createdAt });
    }
  }
  return { threadId: thread.threadId, turns: thread.turns.map(turnView), latest };
}

export const STARTER_CHIPS = STARTERS.map(({ id, label }) => ({ id, label }));
