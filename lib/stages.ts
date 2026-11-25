import { Stage } from "@/generated/prisma/enums";

// Stage order and labels, shared by the server and the stage dropdown in the browser.
export const STAGES: Stage[] = Object.values(Stage);

export const STAGE_LABELS: Record<Stage, string> = {
  NOT_CONTACTED: "Not contacted",
  CONTACTED: "Contacted",
  REPLIED: "Replied",
  IN_CONVERSATION: "In conversation",
  COMMITTED: "Committed",
  DECLINED: "Declined",
};

// The outcomes. Moving here closes the pitch and clears any claim, so the UI asks first.
export const TERMINAL_STAGES: Stage[] = ["COMMITTED", "DECLINED"];

// What the stage form and the board ask before a move into an outcome.
export function closeQuestion(companyName: string, to: Stage): { message: string; confirmLabel: string } {
  return { message: `Move ${companyName} to ${STAGE_LABELS[to]}? This closes the pitch and releases any claim.`, confirmLabel: `Move to ${STAGE_LABELS[to]}` };
}

// The stages that mean the company answered. The "replied companies with no reply marked" gap on
// the stats page counts only these, because an unmarked Declined company is often a silent no.
export const ANSWERED_STAGES: Stage[] = ["REPLIED", "IN_CONVERSATION", "COMMITTED"];

// The stages where an outreach can be marked as the one that got the answer (lib/claims.ts
// markReply). Declined is one of them, since a "no thanks" email is a reply too.
export const REPLY_STAGES: Stage[] = [...ANSWERED_STAGES, "DECLINED"];

// Whether a move asks "Which outreach got the reply?". It asks when a company moves into any
// reply stage from Not contacted, Contacted or Declined. So Contacted into Declined asks, Declined
// into Replied or Committed asks, and a move from Replied, In conversation or Committed into
// Declined doesn't ask a second time.
export const opensReply = (from: Stage, to: Stage) => !ANSWERED_STAGES.includes(from) && REPLY_STAGES.includes(to);
