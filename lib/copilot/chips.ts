import { DEFAULT_FILTER } from "@/lib/copilot/intent";
import { STAGE_LABELS } from "@/lib/stages";
import type { CopilotFilter } from "@/lib/validation";

// A filter as the chips shown above a list of companies. A chip edit sends a whole new filter back
// (lib/copilot/index.ts rerunTurn), so removing a chip is just the filter with that one field back at
// its default; these helpers make that one line for the screen. Plain text only.

export type FilterChip = {
  key: keyof CopilotFilter;
  label: string;
  // The chip can be taken off. The stage chip stays (it can be changed, and empty means every open
  // stage) and so does the sort.
  removable: boolean;
};

const SORT_LABELS: Record<CopilotFilter["sort"], string> = { most_overdue: "most overdue", name: "name", recently_contacted: "recently contacted" };
const DUE_LABELS: Record<Exclude<CopilotFilter["due"], "any">, string> = { overdue: "Overdue", due_this_week: "Due this week", no_date: "No follow-up date" };
const CLAIM_LABELS: Record<Exclude<CopilotFilter["claim"], "any">, string> = { mine: "Held by me", free: "Free to claim", held_by_others: "Held by others" };

export function filterChips(filter: CopilotFilter): FilterChip[] {
  const chips: FilterChip[] = [
    filter.stages.length > 0
      ? { key: "stages", label: `Stage: ${filter.stages.map((s) => STAGE_LABELS[s]).join(", ")}`, removable: true }
      : { key: "stages", label: "Open stages", removable: false },
  ];
  if (filter.due !== "any") chips.push({ key: "due", label: DUE_LABELS[filter.due], removable: true });
  if (filter.claim !== "any") chips.push({ key: "claim", label: CLAIM_LABELS[filter.claim], removable: true });
  if (filter.industry) chips.push({ key: "industry", label: `Industry: ${filter.industry}`, removable: true });
  if (filter.neverContacted) chips.push({ key: "neverContacted", label: "Never contacted", removable: true });
  if (filter.nameOrSite) chips.push({ key: "nameOrSite", label: `Name or website has "${filter.nameOrSite}"`, removable: true });
  if (filter.notesMention) chips.push({ key: "notesMention", label: `Notes mention "${filter.notesMention}"`, removable: true });
  chips.push({ key: "sort", label: `Sorted by ${SORT_LABELS[filter.sort]}`, removable: false });
  return chips;
}

// The filter with one chip taken off: that field back at its default.
export function withoutChip(filter: CopilotFilter, key: keyof CopilotFilter): CopilotFilter {
  return { ...filter, [key]: DEFAULT_FILTER[key] };
}
