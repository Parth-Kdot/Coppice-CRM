import { timingSafeEqual } from "node:crypto";
import { PURGE_BATCH, purgeExpiredPreviousVersions } from "@/lib/db";

// Vercel Cron calls this once a day (vercel.json), so previous versions older than an hour are
// deleted even in a workspace nobody opens. It needs no secret to work: the database function it
// runs can only delete previous versions that are already past their hour, which nobody can see any
// more, so a stranger calling it can only make Coppice delete what it would delete anyway. If
// CRON_SECRET is set, Vercel sends it as a bearer token and the route refuses a call without it, so
// a flood of requests cannot compete with real users for database connections. It answers with no
// body, so it tells a caller nothing. proxy.ts skips /api, so no page logic runs here.
export const dynamic = "force-dynamic";

// At most 20 batches a run; the rest go on the next edit, page view or run.
const MAX_BATCHES = 20;

// Compared in constant time, so the time a refusal takes says nothing about how much of a guess was right.
function sentSecret(header: string | null, secret: string): boolean {
  const sent = Buffer.from(header ?? "");
  const wanted = Buffer.from(`Bearer ${secret}`);
  return sent.length === wanted.length && timingSafeEqual(sent, wanted);
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && !sentSecret(request.headers.get("authorization"), secret)) {
    return new Response(null, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  try {
    for (let i = 0; i < MAX_BATCHES; i++) {
      if ((await purgeExpiredPreviousVersions()) < PURGE_BATCH) break;
    }
  } catch (error) {
    console.error("Purging previous versions failed", error);
    return new Response(null, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
