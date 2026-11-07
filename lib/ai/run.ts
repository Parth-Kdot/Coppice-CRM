import type { z } from "zod";
import type { AiFeature } from "@/generated/prisma/enums";
import { generate, isConfigured, providerOf, type AiErrorCode, type GenerateRequest } from "@/lib/ai/client";
import { dbNow } from "@/lib/claims";
import { prisma, withTenant, type Tenant } from "@/lib/db";
import { breakdownAiUsage, type AiBreakdown } from "@/lib/ai/usage";
import type { ActionResult } from "@/lib/validation";

// Every AI call in the app goes through runAi(). In order, it:
// 1. refuses if the server has no API key for the feature's provider, or the workspace has AI
//    switched off;
// 2. refuses if the workspace used its limit of AI calls in the last 30 days, or (for drafts and
//    research briefs) this person made too many in the last 24 hours, so a free-tier quota is
//    shared fairly;
// 3. calls the model (lib/ai/client.ts), outside any database transaction;
// 4. logs the call in AiRun (feature, model, tokens, time, success or a short error code).
// Callers check membership first, as every server action does.

export const AI_WINDOW_DAYS = 30;
export const DAILY_DRAFTS_PER_PERSON = 40;
// Research briefs (lib/research/brief.ts) fetch pages and make two AI calls each, so fewer.
export const DAILY_BRIEFS_PER_PERSON = 10;

const DAY_MS = 24 * 60 * 60 * 1000;

// What people see when a call fails. Never the model's raw error.
export const AI_ERROR_MESSAGES: Record<AiErrorCode, string> = {
  not_configured: "AI isn't set up on this server yet.",
  bad_key: "The AI service rejected this server's key. Tell the app admin.",
  rate_limited: "The AI is busy right now. Try again in a minute.",
  timeout: "The AI took too long to answer. Try again.",
  blocked: "The AI declined to answer that. Try rewording your note.",
  truncated: "The AI's answer was cut off. Try again.",
  invalid_output: "The AI sent back something unusable. Try again.",
  rejected: "The AI service refused this request. Tell the app admin.",
  unavailable: "The AI service isn't responding. Try again in a few minutes.",
};

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

// Whether this person may make an AI call for this feature right now (steps 1 and 2 above).
// runAi() checks it itself; a feature that has a side effect before its AI call (the drafter
// claims the company) checks it first too, so a refused call leaves nothing behind.
// Groq is only used by Smart import, which says what still works without it.
export const GROQ_NOT_CONFIGURED = "Smart import needs a Groq key on this server (GROQ_API_KEY), and it isn't set. The normal import still works.";

export async function aiGate(tenant: Tenant, feature: AiFeature): Promise<ActionResult> {
  if (providerOf(feature) === "groq") {
    if (!isConfigured("groq")) return { ok: false, error: GROQ_NOT_CONFIGURED };
  } else if (!isConfigured()) return { ok: false, error: AI_ERROR_MESSAGES.not_configured };
  const usage = await aiUsage(tenant);
  if (!usage.enabled) return { ok: false, error: "AI is turned off for this workspace. An owner can turn it on in Settings." };
  if (usage.used >= usage.limit) {
    return {
      ok: false,
      error: `This workspace has used its ${usage.limit} AI calls for the last ${AI_WINDOW_DAYS} days. An owner can raise the limit in Settings.`,
    };
  }
  if (feature === "DRAFT") {
    const since = new Date((await dbNow()).getTime() - DAY_MS);
    const mine = await withTenant(tenant, (tx) =>
      tx.aiRun.count({ where: { workspaceId: tenant.workspaceId, userId: tenant.userId, feature: "DRAFT", createdAt: { gte: since } } }),
    );
    if (mine >= DAILY_DRAFTS_PER_PERSON) {
      return { ok: false, error: `You've made ${DAILY_DRAFTS_PER_PERSON} drafts in the last 24 hours. Try again tomorrow.` };
    }
  }
  // A brief starts with its RESEARCH_READ call, so those count briefs. requestBrief
  // (lib/research/brief.ts) also counts every brief row, written as RUNNING before any page is
  // fetched, which includes ones that made no call or failed.
  if (feature === "RESEARCH_READ") {
    const since = new Date((await dbNow()).getTime() - DAY_MS);
    const mine = await withTenant(tenant, (tx) =>
      tx.aiRun.count({ where: { workspaceId: tenant.workspaceId, userId: tenant.userId, feature: "RESEARCH_READ", createdAt: { gte: since } } }),
    );
    if (mine >= DAILY_BRIEFS_PER_PERSON) {
      return { ok: false, error: `You've asked for ${DAILY_BRIEFS_PER_PERSON} research briefs in the last 24 hours. Try again tomorrow.` };
    }
  }
  return { ok: true, data: undefined };
}

// The model's checked reply, and which model gave it (a fallback model can answer).
export type AiResult<T> = { ok: true; data: T; model: string } | { ok: false; error: string };

export async function runAi<S extends z.ZodType>(tenant: Tenant, request: GenerateRequest<S>): Promise<AiResult<z.output<S>>> {
  const gate = await aiGate(tenant, request.feature);
  if (!gate.ok) return gate;

  const started = performance.now();
  const result = await generate(request);
  const latencyMs = Math.round(performance.now() - started);

  await withTenant(tenant, (tx) =>
    tx.aiRun.create({
      data: {
        workspaceId: tenant.workspaceId,
        userId: tenant.userId,
        feature: request.feature,
        model: result.model,
        status: result.ok ? "SUCCEEDED" : "FAILED",
        error: result.ok ? null : result.error,
        promptTokens: result.usage?.promptTokens ?? null,
        outputTokens: result.usage?.outputTokens ?? null,
        thinkingTokens: result.usage?.thinkingTokens ?? null,
        latencyMs,
      },
    }),
  );

  return result.ok ? { ok: true, data: result.data, model: result.model } : { ok: false, error: AI_ERROR_MESSAGES[result.error] };
}
