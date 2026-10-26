import type { z } from "zod";
import { generate, isConfigured, type AiErrorCode, type GenerateRequest } from "@/lib/ai/client";
import { dbNow } from "@/lib/claims";
import { prisma, withTenant, type Tenant } from "@/lib/db";
import type { ActionResult } from "@/lib/validation";

// Every AI call in the app goes through runAi(). In order, it:
// 1. refuses if the server has no API key, or the workspace has AI switched off;
// 2. refuses if the workspace used its limit of AI calls in the last 30 days, or (for drafts)
//    this person made too many drafts in the last 24 hours, so a free-tier quota is shared fairly;
// 3. calls the model (lib/ai/client.ts), outside any database transaction;
// 4. logs the call in AiRun (feature, model, tokens, time, success or a short error code).
// Callers check membership first, as every server action does.

export const AI_WINDOW_DAYS = 30;
export const DAILY_DRAFTS_PER_PERSON = 40;

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

export async function runAi<S extends z.ZodType>(tenant: Tenant, request: GenerateRequest<S>): Promise<ActionResult<z.output<S>>> {
  if (!isConfigured()) return { ok: false, error: AI_ERROR_MESSAGES.not_configured };
  const usage = await aiUsage(tenant);
  if (!usage.enabled) return { ok: false, error: "AI is turned off for this workspace. An owner can turn it on in Settings." };
  if (usage.used >= usage.limit) {
    return {
      ok: false,
      error: `This workspace has used its ${usage.limit} AI calls for the last ${AI_WINDOW_DAYS} days. An owner can raise the limit in Settings.`,
    };
  }
  if (request.feature === "DRAFT") {
    const since = new Date((await dbNow()).getTime() - DAY_MS);
    const mine = await withTenant(tenant, (tx) =>
      tx.aiRun.count({ where: { workspaceId: tenant.workspaceId, userId: tenant.userId, feature: "DRAFT", createdAt: { gte: since } } }),
    );
    if (mine >= DAILY_DRAFTS_PER_PERSON) {
      return { ok: false, error: `You've made ${DAILY_DRAFTS_PER_PERSON} drafts in the last 24 hours. Try again tomorrow.` };
    }
  }

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

  return result.ok ? { ok: true, data: result.data } : { ok: false, error: AI_ERROR_MESSAGES[result.error] };
}
