import type { Prisma } from "@/generated/prisma/client";
import type { CopilotTurnStatus } from "@/generated/prisma/enums";
import type { Membership } from "@/lib/authz";
import { dbNow } from "@/lib/claims";
import { withTenant } from "@/lib/db";
import { PROMPT_LIMITS } from "@/lib/copilot/prompt";
import type { StoredIntent } from "@/lib/copilot/intent";
import { copilotIntentSchema } from "@/lib/validation";

// A person's conversations with Ask Coppice (CopilotThread and CopilotTurn). Private to the person:
// the tables' row-level security lets only the member a row belongs to see or write it, owners
// included, and every query here names the workspace and the user as well. Only what the screen
// needs is kept: the question, the checked intent, the reply sentence and the ids of the rows shown.
// Rows themselves are never stored; they are read again from the workspace when a turn is shown.
//
// Expiry: whenever a person starts a turn, their turns older than 30 days (by the database clock)
// and their empty threads are deleted, in the same transaction that opens the thread. Reading a
// thread or a turn leaves out anything past the window too, so someone who comes back after two
// months doesn't see old turns before the clean-up has run.

type Tx = Prisma.TransactionClient;

export const KEEP_DAYS = 30;
export const SHOWN_STORED_MAX = 25;
// How many turns of a reloaded thread the screen reads at most.
export const THREAD_TURNS_MAX = 50;
const DAY_MS = 24 * 60 * 60 * 1000;
// Turns made before this are past the keep window, whether or not the clean-up has run yet.
const keptSince = (now: Date) => new Date(now.getTime() - KEEP_DAYS * DAY_MS);

export type Turn = {
  id: string;
  question: string;
  // null when the stored intent no longer reads (an older shape); the turn still shows its question and reply.
  intent: StoredIntent | null;
  reply: string;
  shown: string[];
  status: CopilotTurnStatus;
  error: string | null;
  createdAt: Date;
};

const TURN_SELECT = { id: true, question: true, intent: true, reply: true, shown: true, status: true, error: true, createdAt: true } as const;

export function parseIntent(json: unknown): StoredIntent | null {
  const parsed = copilotIntentSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

const toTurn = (row: Prisma.CopilotTurnGetPayload<{ select: typeof TURN_SELECT }>): Turn => ({
  id: row.id,
  question: row.question,
  intent: parseIntent(row.intent),
  reply: row.reply,
  shown: Array.isArray(row.shown) ? row.shown.filter((id): id is string => typeof id === "string") : [],
  status: row.status,
  error: row.error,
  createdAt: row.createdAt,
});

// Deletes this person's turns past the keep window and their empty threads, except the thread being
// used. `now` is the database's clock (dbNow).
async function expire(tx: Tx, member: Membership, now: Date, keepThreadId: string | null) {
  const cutoff = keptSince(now);
  await tx.copilotTurn.deleteMany({ where: { workspaceId: member.workspaceId, userId: member.userId, createdAt: { lt: cutoff } } });
  await tx.copilotThread.deleteMany({
    where: { workspaceId: member.workspaceId, userId: member.userId, turns: { none: {} }, ...(keepThreadId ? { id: { not: keepThreadId } } : {}) },
  });
}

export type ThreadContext = {
  threadId: string;
  // The answered turns of the thread, oldest first, the most recent ones only (what the prompt can use).
  turns: Turn[];
  // The ids shown by the latest answered turn, at most as many as the prompt lists.
  shownIds: string[];
};

// Opens the thread a question goes into: the person's own thread with this id, or a new one when
// there is none (no id, or an id that is gone, another person's or another workspace's: all look the
// same and cost nothing). Runs the expiry first, in the same transaction.
export function openForTurn(member: Membership, threadId: string | null, now: Date): Promise<ThreadContext> {
  return withTenant(member, async (tx) => {
    const found = threadId
      ? await tx.copilotThread.findFirst({ where: { id: threadId, workspaceId: member.workspaceId, userId: member.userId }, select: { id: true } })
      : null;
    await expire(tx, member, now, found?.id ?? null);
    const thread = found ?? (await tx.copilotThread.create({ data: { workspaceId: member.workspaceId, userId: member.userId }, select: { id: true } }));
    const rows = await tx.copilotTurn.findMany({
      where: { threadId: thread.id, workspaceId: member.workspaceId, userId: member.userId, status: "ANSWERED" },
      select: TURN_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: PROMPT_LIMITS.recentTurns + PROMPT_LIMITS.earlierQuestions,
    });
    const turns = rows.map(toTurn).reverse();
    const latest = turns[turns.length - 1];
    return { threadId: thread.id, turns, shownIds: (latest?.shown ?? []).slice(0, PROMPT_LIMITS.shown) };
  });
}

export type NewTurn = {
  threadId: string;
  question: string;
  intent: StoredIntent;
  reply: string;
  shown: string[];
  status: CopilotTurnStatus;
  error: string | null;
  // A failed turn this one replaces ("Try again"): deleted in the same transaction.
  retryOf?: string | null;
};

// Saves a turn and moves its thread to the top. If the thread was deleted while the AI answered (an
// empty thread another tab's expiry removed), the turn starts a new one, so an answer is never lost.
export function recordTurn(member: Membership, turn: NewTurn, now: Date): Promise<{ turnId: string; threadId: string; createdAt: Date }> {
  return withTenant(member, async (tx) => {
    const scope = { workspaceId: member.workspaceId, userId: member.userId };
    const found = await tx.copilotThread.findFirst({ where: { id: turn.threadId, ...scope }, select: { id: true } });
    const thread = found ?? (await tx.copilotThread.create({ data: scope, select: { id: true } }));
    if (turn.retryOf) await tx.copilotTurn.deleteMany({ where: { id: turn.retryOf, threadId: thread.id, status: "FAILED", ...scope } });
    const created = await tx.copilotTurn.create({
      data: {
        threadId: thread.id,
        ...scope,
        question: turn.question,
        intent: turn.intent as unknown as Prisma.InputJsonValue,
        reply: turn.reply.slice(0, 600),
        shown: turn.shown.slice(0, SHOWN_STORED_MAX),
        status: turn.status,
        error: turn.error,
      },
      select: { id: true, createdAt: true },
    });
    await tx.copilotThread.updateMany({ where: { id: thread.id, ...scope }, data: { updatedAt: now } });
    return { turnId: created.id, threadId: thread.id, createdAt: created.createdAt };
  });
}

// A new, empty conversation ("New conversation").
export function newThread(member: Membership): Promise<string> {
  return withTenant(member, async (tx) => {
    const thread = await tx.copilotThread.create({ data: { workspaceId: member.workspaceId, userId: member.userId }, select: { id: true } });
    return thread.id;
  });
}

// A thread with its turns (oldest first), for the screen. Without an id, the person's most recently
// used thread. Null when there is none.
export async function readThread(member: Membership, threadId: string | null): Promise<{ threadId: string; turns: Turn[] } | null> {
  const since = keptSince(await dbNow());
  return withTenant(member, async (tx) => {
    const scope = { workspaceId: member.workspaceId, userId: member.userId };
    const thread = await tx.copilotThread.findFirst({
      where: threadId ? { id: threadId, ...scope } : scope,
      select: { id: true },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    });
    if (!thread) return null;
    const rows = await tx.copilotTurn.findMany({
      where: { threadId: thread.id, ...scope, createdAt: { gte: since } },
      select: TURN_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: THREAD_TURNS_MAX,
    });
    return { threadId: thread.id, turns: rows.map(toTurn).reverse() };
  });
}

// One of this person's turns, with the thread it is in.
export async function readTurn(member: Membership, turnId: string): Promise<(Turn & { threadId: string }) | null> {
  const since = keptSince(await dbNow());
  return withTenant(member, async (tx) => {
    const row = await tx.copilotTurn.findFirst({
      where: { id: turnId, workspaceId: member.workspaceId, userId: member.userId, createdAt: { gte: since } },
      select: { ...TURN_SELECT, threadId: true },
    });
    return row ? { ...toTurn(row), threadId: row.threadId } : null;
  });
}

// After a chip edit: the turn's intent and the rows it now shows.
export function saveEdit(member: Membership, turnId: string, intent: StoredIntent, shown: string[]): Promise<boolean> {
  return withTenant(member, async (tx) => {
    const { count } = await tx.copilotTurn.updateMany({
      where: { id: turnId, workspaceId: member.workspaceId, userId: member.userId, status: "ANSWERED" },
      data: { intent: intent as unknown as Prisma.InputJsonValue, shown: shown.slice(0, SHOWN_STORED_MAX) },
    });
    return count === 1;
  });
}

// The names of the companies behind a list of ids, in the order given (an id with no company, or in
// another workspace, is left out), for the prompt's shown list.
export function namesOf(member: Membership, ids: readonly string[]): Promise<{ id: string; name: string }[]> {
  if (ids.length === 0) return Promise.resolve([]);
  return withTenant(member, async (tx) => {
    const rows = await tx.company.findMany({ where: { workspaceId: member.workspaceId, id: { in: [...ids] } }, select: { id: true, name: true } });
    const byId = new Map(rows.map((r) => [r.id, r.name]));
    return ids.flatMap((id) => (byId.has(id) ? [{ id, name: byId.get(id) as string }] : []));
  });
}
