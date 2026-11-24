import type { StoredIntent } from "@/lib/copilot/intent";
import { DEFAULT_FILTER, PLAN_MINUTES } from "@/lib/copilot/intent";
import type { COPILOT_STARTERS } from "@/lib/validation";

// The four starter chips of an empty conversation. Each is a fixed intent written here in code, so
// choosing one makes no AI call and costs nothing against any limit. They run through exactly the
// code a model's intent runs through (lib/copilot/index.ts), and their replies are fixed sentences.

export type StarterId = (typeof COPILOT_STARTERS)[number];
export type Starter = { id: StarterId; label: string; intent: StoredIntent };

const intent = (rest: Partial<StoredIntent> & Pick<StoredIntent, "view" | "reply">): StoredIntent => ({
  filter: null,
  company: null,
  minutes: null,
  guideTopics: [],
  actions: [],
  ...rest,
});

export const STARTERS: readonly Starter[] = [
  {
    id: "overdue",
    label: "Who's overdue?",
    intent: intent({ view: "companies", reply: "These are the companies whose follow-up date has arrived.", filter: { ...DEFAULT_FILTER, due: "overdue" } }),
  },
  {
    id: "plan",
    label: "Plan my 30 minutes",
    intent: intent({ view: "plan", reply: "Here is a plan for your time.", minutes: PLAN_MINUTES.fallback }),
  },
  {
    id: "claims",
    label: "My claims",
    intent: intent({ view: "companies", reply: "These are the companies you hold.", filter: { ...DEFAULT_FILTER, claim: "mine" } }),
  },
  {
    id: "how-claims-work",
    label: "How do claims work?",
    intent: intent({ view: "guide", reply: "Here is how claims work.", guideTopics: ["claims", "release"] }),
  },
];

export const starterById = (id: string): Starter | undefined => STARTERS.find((s) => s.id === id);
