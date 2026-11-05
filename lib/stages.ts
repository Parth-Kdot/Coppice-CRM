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

// The stages that mean the company answered. Moving into one of them from any other stage asks
// "Which outreach got the reply?", so template stats know what worked (lib/claims.ts markReply).
export const REPLY_STAGES: Stage[] = ["REPLIED", "IN_CONVERSATION", "COMMITTED"];
export const opensReply = (from: Stage, to: Stage) => !REPLY_STAGES.includes(from) && REPLY_STAGES.includes(to);
