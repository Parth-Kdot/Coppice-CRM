"use server";

import { failure } from "@/lib/action-failure";
import { requireMembership } from "@/lib/authz";
import { askCopilot, previewMove, rerunTurn, runStarter, startThread, withoutChip, type ActionCard, type CopilotAnswer, type CopilotResult } from "@/lib/copilot";
import { askCopilotSchema, copilotChipSchema, copilotMoveSchema, copilotStarterSchema, rerunTurnSchema, workspaceIdSchema, type ActionResult } from "@/lib/validation";

// The actions behind the Ask Coppice screen. Each checks the input, then membership (every server
// action starts with requireMembership or requireOwner), then calls lib/copilot, which does the
// work inside withTenant. Only askQuestion makes an AI call. Starter chips, chip edits, "Show again",
// next-move chips and "New conversation" make none. Confirming a card does not go through here: it
// calls the existing company actions (claimCompany, releaseClaim, forceRelease, moveStage,
// setFollowUp, logOutreach), which check everything again.

const BAD_INPUT = "Something was wrong with that request. Reload the page and try again.";
const refused = (error: string): CopilotResult => ({ ok: false, error, retryable: false, rateLimited: false, threadId: null, turnId: null });

export async function askQuestion(input: unknown): Promise<CopilotResult> {
  const parsed = askCopilotSchema.safeParse(input);
  if (!parsed.success) return refused(parsed.error.issues[0]?.message ?? BAD_INPUT);
  const { workspaceId, ...ask } = parsed.data;
  try {
    const member = await requireMembership(workspaceId);
    return await askCopilot(member, ask);
  } catch (e) {
    return refused(failure(e, "askQuestion").error);
  }
}

export async function chooseStarter(input: unknown): Promise<ActionResult<CopilotAnswer>> {
  const parsed = copilotStarterSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: BAD_INPUT };
  const { workspaceId, ...pick } = parsed.data;
  try {
    const member = await requireMembership(workspaceId);
    return await runStarter(member, pick);
  } catch (e) {
    return failure(e, "chooseStarter");
  }
}

// "Show again": the stored intent, run fresh.
export async function showAgain(input: unknown): Promise<ActionResult<CopilotAnswer>> {
  const parsed = rerunTurnSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: BAD_INPUT };
  try {
    const member = await requireMembership(parsed.data.workspaceId);
    return await rerunTurn(member, parsed.data.turnId, parsed.data.filter);
  } catch (e) {
    return failure(e, "showAgain");
  }
}

// A chip taken off a list: the list again without it, saved so the next question builds on it.
export async function removeChip(input: unknown): Promise<ActionResult<CopilotAnswer>> {
  const parsed = copilotChipSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: BAD_INPUT };
  const { workspaceId, turnId, filter, remove } = parsed.data;
  try {
    const member = await requireMembership(workspaceId);
    return await rerunTurn(member, turnId, withoutChip(filter, remove));
  } catch (e) {
    return failure(e, "removeChip");
  }
}

// "New conversation".
export async function startConversation(workspaceId: string): Promise<ActionResult<{ threadId: string }>> {
  const parsed = workspaceIdSchema.safeParse(workspaceId);
  if (!parsed.success) return { ok: false, error: BAD_INPUT };
  try {
    const member = await requireMembership(parsed.data);
    return await startThread(member);
  } catch (e) {
    return failure(e, "startConversation");
  }
}

// A next-move chip or a move on the company card: the confirm card, from the company as it is now.
export async function previewCard(input: unknown): Promise<ActionResult<ActionCard>> {
  const parsed = copilotMoveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? BAD_INPUT };
  const { workspaceId, ...move } = parsed.data;
  try {
    const member = await requireMembership(workspaceId);
    return await previewMove(member, move);
  } catch (e) {
    return failure(e, "previewCard");
  }
}
