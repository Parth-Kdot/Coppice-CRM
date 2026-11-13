import type { z } from "zod";
import type { AiFeature } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { generate, isConfigured, providerOf, ROUTES, type AiErrorCode, type FailedTry, type GenerateRequest } from "@/lib/ai/client";
import { dbNow } from "@/lib/claims";
import { advisoryXactLock, prisma, withTenant, type Tenant } from "@/lib/db";
import { breakdownAiUsage, type AiBreakdown } from "@/lib/ai/usage";
import type { ActionResult } from "@/lib/validation";

// Every AI call in the app goes through runAi(). In order, it:
// 1. refuses if the server has no API key for the feature's provider, or the workspace has AI
//    switched off;
// 2. refuses if the workspace used its limit of AI calls in the last 30 days, or (for drafts and
//    research briefs) this person made too many in the last 24 hours, so a free-tier quota is
//    shared fairly;
// 3. reserves the call: steps 1-2 and writing the AiRun row as RUNNING happen in one transaction
//    that first takes the workspace's advisory lock, so calls made at the same moment are counted
//    one after another and can't all pass a limit (reserveAi);
// 4. calls the model (lib/ai/client.ts), outside any database transaction;
// 5. updates the row: the model that answered, tokens, time, and SUCCEEDED or FAILED with a short
//    error code (a SUCCEEDED call a fallback model answered notes the models that failed first). A reply the caller's own checks reject (drafts that broke the rules) is FAILED
//    too, so the log never counts an unusable answer as a success.
// Callers check membership first, as every server action does.

export const AI_WINDOW_DAYS = 30;
export const DAILY_DRAFTS_PER_PERSON = 40;
// Research briefs (lib/research/brief.ts) fetch pages and make two AI calls each, so fewer.
export const DAILY_BRIEFS_PER_PERSON = 10;
// Ask Coppice (lib/copilot): one call per typed question. Starter chips, chip edits and "Show again"
// make no call, so they never count.
export const DAILY_COPILOT_PER_PERSON = 50;

const DAY_MS = 24 * 60 * 60 * 1000;

// A failed call's code in AiRun: the client's codes, plus a reply the caller's checks refused.
export type AiRunError = AiErrorCode | "broke_rules";

// What people see when a call fails. Never the model's raw error.
export const AI_ERROR_MESSAGES: Record<AiErrorCode, string> = {
  not_configured: "AI isn't set up on this server yet.",
  bad_key: "The AI service rejected this server's key. Tell the app admin.",
  rate_limited: "The AI is busy right now. Try again in a minute.",
  timeout: "The AI took too long to answer. Try again.",
  // Features with something the person can change say so through runAi's `messages` (drafts: the note).
  blocked: "The AI declined to answer this request. Try again later.",
  truncated: "The AI's answer was cut off. Try again.",
  invalid_output: "The AI sent back something unusable. Try again.",
  rejected: "The AI service refused this request. Tell the app admin.",
  unavailable: "The AI service isn't responding. Try again in a few minutes.",
};
const BROKE_RULES = "The AI's answer didn't pass Coppice's checks. Try again.";

// The failures that can clear on their own, so trying again (Smart import's Continue) makes sense.
// A bad key, a refused request or a limit won't change by waiting.
const RETRYABLE: AiRunError[] = ["rate_limited", "timeout", "unavailable", "truncated", "invalid_output", "broke_rules"];
export const isRetryableAiError = (message: string) => RETRYABLE.some((code) => (code === "broke_rules" ? BROKE_RULES : AI_ERROR_MESSAGES[code]) === message);

// Failures that are the AI service's, not the person's: they don't count toward a person's daily
// drafts, so a bad provider day can't lock someone out (they still count toward the workspace's
// limit, which is what the provider's quota is shared by).
const PROVIDER_ERRORS: AiErrorCode[] = ["rate_limited", "timeout", "unavailable", "rejected", "bad_key", "not_configured"];
const countsForPerson: Prisma.AiRunWhereInput = { OR: [{ status: { not: "FAILED" } }, { error: { notIn: PROVIDER_ERRORS } }] };

export type AiUsage = { enabled: boolean; limit: number; used: number };

// The workspace's switch, limit, and AI calls in the last 30 days (for Settings).
export async function aiUsage(tenant: Tenant): Promise<AiUsage> {
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: tenant.workspaceId },
    select: { aiEnabled: true, aiMonthlyLimit: true },
  });
  const since = new Date((await dbNow()).getTime() - AI_WINDOW_DAYS * DAY_MS);
  const used = await withTenant(tenant, (tx) => tx.aiRun.count({ where: { workspaceId: tenant.workspaceId, createdAt: { gte: since } } }));
  return { enabled: workspace.aiEnabled, limit: workspace.aiMonthlyLimit, used };
}

// What the same 30-day count is made of, by feature. One grouped query, scoped to the workspace,
// counting failed calls too (they count toward the limit).
export async function aiBreakdown(tenant: Tenant): Promise<AiBreakdown> {
  const since = new Date((await dbNow()).getTime() - AI_WINDOW_DAYS * DAY_MS);
  const groups = await withTenant(tenant, (tx) =>
    tx.aiRun.groupBy({
      by: ["feature", "status"],
      where: { workspaceId: tenant.workspaceId, createdAt: { gte: since } },
      _count: { _all: true },
    }),
  );
  return breakdownAiUsage(groups.map((g) => ({ feature: g.feature, status: g.status, count: g._count._all })));
}

// For Settings: the switch, the limit, and the 30-day count with what it is made of. The count is
// the breakdown's total, so the two numbers come from one query and can never disagree.
export async function aiUsageDetail(tenant: Tenant): Promise<AiUsage & { breakdown: AiBreakdown }> {
  const [workspace, breakdown] = await Promise.all([
    prisma.workspace.findUniqueOrThrow({ where: { id: tenant.workspaceId }, select: { aiEnabled: true, aiMonthlyLimit: true } }),
    aiBreakdown(tenant),
  ]);
  return { enabled: workspace.aiEnabled, limit: workspace.aiMonthlyLimit, used: breakdown.total, breakdown };
}

// Whether this person may make an AI call for this feature right now (steps 1 and 2 above), as
// the reason it may not, or null. Runs inside a transaction: reserveAi's, under the workspace lock.
// Groq is only used by Smart import, which says what still works without it.
export const GROQ_NOT_CONFIGURED = "Smart import isn't set up on this server yet. Ask the app admin. The normal import below still works.";
export const AI_OFF_MESSAGE = "AI is turned off for this workspace. An owner can turn it on in Settings.";

function configProblem(feature: AiFeature): string | null {
  if (providerOf(feature) === "groq") return isConfigured("groq") ? null : GROQ_NOT_CONFIGURED;
  return isConfigured() ? null : AI_ERROR_MESSAGES.not_configured;
}

async function gateIn(tx: Prisma.TransactionClient, tenant: Tenant, feature: AiFeature, now: Date): Promise<string | null> {
  const workspace = await tx.workspace.findUniqueOrThrow({ where: { id: tenant.workspaceId }, select: { aiEnabled: true, aiMonthlyLimit: true } });
  if (!workspace.aiEnabled) return AI_OFF_MESSAGE;
  const used = await tx.aiRun.count({ where: { workspaceId: tenant.workspaceId, createdAt: { gte: new Date(now.getTime() - AI_WINDOW_DAYS * DAY_MS) } } });
  if (used >= workspace.aiMonthlyLimit) {
    return `This workspace has used its ${workspace.aiMonthlyLimit} AI calls for the last ${AI_WINDOW_DAYS} days. An owner can raise the limit in Settings.`;
  }
  const since = new Date(now.getTime() - DAY_MS);
  const mine = { workspaceId: tenant.workspaceId, userId: tenant.userId, createdAt: { gte: since } };
  if (feature === "DRAFT") {
    if ((await tx.aiRun.count({ where: { ...mine, feature: "DRAFT", ...countsForPerson } })) >= DAILY_DRAFTS_PER_PERSON) {
      return `You've made ${DAILY_DRAFTS_PER_PERSON} drafts in the last 24 hours. Try again tomorrow.`;
    }
  }
  // A brief starts with its RESEARCH_READ call, so those count briefs. requestBrief
  // (lib/research/brief.ts) also counts every brief row, written as RUNNING before any page is
  // fetched, which includes ones that made no call or failed.
  if (feature === "RESEARCH_READ") {
    if ((await tx.aiRun.count({ where: { ...mine, feature: "RESEARCH_READ" } })) >= DAILY_BRIEFS_PER_PERSON) {
      return `You've asked for ${DAILY_BRIEFS_PER_PERSON} research briefs in the last 24 hours. Try again tomorrow.`;
    }
  }
  // Counted like drafts: a provider failure (a rate limit, a timeout) doesn't count against the person.
  if (feature === "COPILOT") {
    if ((await tx.aiRun.count({ where: { ...mine, feature: "COPILOT", ...countsForPerson } })) >= DAILY_COPILOT_PER_PERSON) {
      return `You've asked Coppice ${DAILY_COPILOT_PER_PERSON} questions in the last 24 hours. Try again tomorrow.`;
    }
  }
  return null;
}

// The check alone, for a feature that wants to refuse early, before work that makes no AI call
// (Smart import's session, a brief's page fetches). It reserves nothing: runAi checks again.
export async function aiGate(tenant: Tenant, feature: AiFeature): Promise<ActionResult> {
  const config = configProblem(feature);
  if (config) return { ok: false, error: config };
  const now = await dbNow();
  const refused = await withTenant(tenant, (tx) => gateIn(tx, tenant, feature, now));
  return refused ? { ok: false, error: refused } : { ok: true, data: undefined };
}

// A call that passed the gate and is counted (as RUNNING) until it is finished or released.
export type AiReservation = { id: string; feature: AiFeature };

// Steps 1-3: checks the gate and writes the call as RUNNING in one transaction holding the
// workspace's advisory lock, so parallel calls are counted one after another. A feature that has
// a side effect before its AI call (the drafter claims the company) reserves first, then passes
// the reservation to runAi, and releases it if the side effect is refused.
export async function reserveAi(tenant: Tenant, feature: AiFeature): Promise<ActionResult<AiReservation>> {
  const config = configProblem(feature);
  if (config) return { ok: false, error: config };
  const now = await dbNow();
  return withTenant(tenant, async (tx): Promise<ActionResult<AiReservation>> => {
    await advisoryXactLock(tx, `ai:${tenant.workspaceId}`);
    const refused = await gateIn(tx, tenant, feature, now);
    if (refused) return { ok: false, error: refused };
    const run = await tx.aiRun.create({
      data: { workspaceId: tenant.workspaceId, userId: tenant.userId, feature, model: ROUTES[feature].model, status: "RUNNING", latencyMs: 0 },
      select: { id: true },
    });
    return { ok: true, data: { id: run.id, feature } };
  });
}

// A reserved call that won't be made after all (the drafter lost the claim): no model was asked,
// so it doesn't count.
export async function releaseAi(tenant: Tenant, reservation: AiReservation): Promise<void> {
  await withTenant(tenant, (tx) => tx.aiRun.deleteMany({ where: { id: reservation.id, workspaceId: tenant.workspaceId, status: "RUNNING" } }));
}

// This person's drafts in the last 24 hours, as the daily limit counts them (for the Draft panel).
export async function draftsToday(tenant: Tenant): Promise<number> {
  const since = new Date((await dbNow()).getTime() - DAY_MS);
  return withTenant(tenant, (tx) =>
    tx.aiRun.count({ where: { workspaceId: tenant.workspaceId, userId: tenant.userId, feature: "DRAFT", createdAt: { gte: since }, ...countsForPerson } }),
  );
}

// This person's Ask Coppice questions in the last 24 hours, as the daily limit counts them.
export async function copilotToday(tenant: Tenant): Promise<number> {
  const since = new Date((await dbNow()).getTime() - DAY_MS);
  return withTenant(tenant, (tx) =>
    tx.aiRun.count({ where: { workspaceId: tenant.workspaceId, userId: tenant.userId, feature: "COPILOT", createdAt: { gte: since }, ...countsForPerson } }),
  );
}

// The model's checked reply, and which model gave it (a fallback model can answer).
export type AiResult<T> = { ok: true; data: T; model: string } | { ok: false; error: string };

export type RunOptions<T> = {
  // Already reserved with reserveAi (the drafter); otherwise runAi reserves.
  reservation?: AiReservation;
  // The caller's own check of a reply that passed the schema: null to accept it, or the code it is
  // logged FAILED with (and the message shown).
  accept?: (data: T) => AiRunError | null;
  // What this feature tells people instead of the default message for a code.
  messages?: Partial<Record<AiRunError, string>>;
};

export async function runAi<S extends z.ZodType>(
  tenant: Tenant,
  request: GenerateRequest<S>,
  options: RunOptions<z.output<S>> = {},
): Promise<AiResult<z.output<S>>> {
  let reservation = options.reservation;
  if (!reservation) {
    const reserved = await reserveAi(tenant, request.feature);
    if (!reserved.ok) return reserved;
    reservation = reserved.data;
  }

  const started = performance.now();
  let result: Awaited<ReturnType<typeof generate<S>>>;
  try {
    result = await generate(request);
  } catch (e) {
    // Never left RUNNING by a crash in the call itself.
    await finish(tenant, reservation.id, { model: ROUTES[request.feature].model, error: "unavailable", usage: null, latencyMs: Math.round(performance.now() - started) });
    throw e;
  }
  const latencyMs = Math.round(performance.now() - started);
  const error: AiRunError | null = result.ok ? (options.accept?.(result.data) ?? null) : result.error;
  await finish(tenant, reservation.id, { model: result.model, error, usage: result.usage, latencyMs, fellBack: result.fellBack });

  if (error === null && result.ok) return { ok: true, data: result.data, model: result.model };
  const code = error ?? "invalid_output";
  return { ok: false, error: options.messages?.[code] ?? (code === "broke_rules" ? BROKE_RULES : AI_ERROR_MESSAGES[code]) };
}

type Finished = {
  model: string;
  error: AiRunError | null;
  usage: { promptTokens: number | null; outputTokens: number | null; thinkingTokens: number | null } | null;
  latencyMs: number;
  fellBack?: FailedTry[];
};

// A call that a fallback model answered keeps, in its error column, which models failed first, how
// and after how long ("fallback after gemini-3.6-flash timeout 20004ms"), so a slow fallback shows
// in the log even though the call SUCCEEDED. A FAILED call's column stays its bare code, which the
// daily limit reads (countsForPerson).
export const fallbackNote = (tries: FailedTry[] | undefined): string | null =>
  tries?.length ? `fallback after ${tries.map((t) => `${t.model} ${t.error} ${t.ms}ms`).join(", ")}` : null;

function finish(tenant: Tenant, id: string, { model, error, usage, latencyMs, fellBack }: Finished) {
  return withTenant(tenant, (tx) =>
    tx.aiRun.updateMany({
      where: { id, workspaceId: tenant.workspaceId },
      data: {
        model,
        status: error ? "FAILED" : "SUCCEEDED",
        error: error ?? fallbackNote(fellBack),
        promptTokens: usage?.promptTokens ?? null,
        outputTokens: usage?.outputTokens ?? null,
        thinkingTokens: usage?.thinkingTokens ?? null,
        latencyMs,
      },
    }),
  );
}
