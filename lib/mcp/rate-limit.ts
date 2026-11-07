import { Prisma } from "@/generated/prisma/client";
import { dbNow } from "@/lib/claims";
import { prisma } from "@/lib/db";

// How many MCP tool calls one person may make per minute, across every assistant they connected
// and every server instance (the counts live in the McpRateLimit table, not in memory). Reads are
// cheap; actions change shared data, so they get far fewer.
export const MCP_LIMITS = { read: 60, action: 10 } as const;
export type McpCallKind = keyof typeof MCP_LIMITS;

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number; limit: number };

const MINUTE = 60_000;

// Counts this call and says whether it fits. Each minute (by the database clock, like every other
// time rule in the app) is one row per person and kind; the count goes up with an upsert, so two
// calls at the same moment are both counted. When a person starts a new minute, their rows from
// more than ten minutes ago are deleted, so the table stays small.
export async function takeMcpCall(userId: string, kind: McpCallKind): Promise<RateLimitResult> {
  const now = await dbNow();
  const windowStart = new Date(Math.floor(now.getTime() / MINUTE) * MINUTE);
  const key = { userId_kind_windowStart: { userId, kind, windowStart } };

  let count: number;
  try {
    ({ count } = await prisma.mcpRateLimit.upsert({
      where: key,
      create: { userId, kind, windowStart, count: 1 },
      update: { count: { increment: 1 } },
      select: { count: true },
    }));
  } catch (e) {
    // Two first calls of a minute raced to create the row; the loser just counts on it.
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
    ({ count } = await prisma.mcpRateLimit.update({ where: key, data: { count: { increment: 1 } }, select: { count: true } }));
  }

  if (count === 1) {
    await prisma.mcpRateLimit.deleteMany({ where: { userId, windowStart: { lt: new Date(windowStart.getTime() - 10 * MINUTE) } } });
  }

  const limit = MCP_LIMITS[kind];
  if (count <= limit) return { ok: true };
  return { ok: false, limit, retryAfterSeconds: Math.max(1, Math.ceil((windowStart.getTime() + MINUTE - now.getTime()) / 1000)) };
}
