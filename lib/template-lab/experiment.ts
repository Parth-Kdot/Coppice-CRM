import { verdict, type Rated } from "@/lib/stats-math";

// The pure rules of a Template Lab experiment: which arm the pickers suggest, and what the stats
// page says about the arms. No database and no AI, so each is tested on its own with a table
// (tests/template-lab.test.ts). lib/template-lab/lab.ts reads the rows and hands them in.
//
// An experiment has one to three arms: "A" is the original template, "B" and "C" are one-change
// variants of it.

export const ARM_LABELS = ["A", "B", "C"] as const;
export type ArmLabel = (typeof ARM_LABELS)[number];

// The arm to suggest in the template picker: the one with the fewest sends, and on a tie the one
// earlier in the alphabet (A, then B, then C). Null when there are no arms.
export function suggestArm(arms: readonly { label: string; sends: number }[]): string | null {
  const sorted = [...arms].sort((a, b) => a.sends - b.sends || a.label.localeCompare(b.label));
  return sorted[0]?.label ?? null;
}

export type ExperimentVerdict =
  // Some arm does not have MIN_SENDS counted sends yet.
  | { status: "too_early"; leader: null; text: "Too early to tell" }
  // Every arm is rated, and one arm's range sits wholly above every other arm's.
  | { status: "ahead"; leader: string; text: string }
  // Every arm is rated and no arm's range clears the others'.
  | { status: "no_difference"; leader: null; text: "No clear difference yet" };

// The verdict, decided here and nowhere else (no model call): "Too early to tell" until every arm
// is rated, then "<label> is ahead" only when that arm's likely range lies entirely above every
// other arm's (the same rule the scorecard uses for best), otherwise "No clear difference yet".
export function experimentVerdict(arms: readonly { label: string; stat: Rated }[]): ExperimentVerdict {
  if (arms.length === 0 || arms.some((a) => a.stat.status !== "rated")) return { status: "too_early", leader: null, text: "Too early to tell" };
  const { best } = verdict(arms.map((a) => ({ key: a.label, stat: a.stat })));
  return best ? { status: "ahead", leader: best, text: `${best} is ahead` } : { status: "no_difference", leader: null, text: "No clear difference yet" };
}

// What the stats page's Lab panel shows for one arm.
export type ArmView = {
  templateId: string;
  name: string;
  label: string;
  // "original", or what the variant changes: opening, ask, closing or shorter.
  kind: string;
  summary: string;
  archived: boolean;
  // The arm the owner kept when the experiment ended.
  kept: boolean;
  // Sends logged with this template while the experiment ran, counted by the scorecard's own rules.
  stat: Rated;
};

export type ExperimentView = {
  id: string;
  status: "RUNNING" | "ENDED";
  startedAt: Date;
  endedAt: Date | null;
  baseTemplateId: string;
  keptTemplateId: string | null;
  arms: ArmView[];
  verdict: ExperimentVerdict;
  // For a running experiment: the label the pickers suggest right now.
  suggested: string | null;
};
