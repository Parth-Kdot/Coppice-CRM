import type { Membership } from "@/lib/authz";
import { cardContext, cardsFor, companyCard, type ActionCard, type ActionSpec, type CompanyCard } from "@/lib/copilot/cards";
import { filterChips, type FilterChip } from "@/lib/copilot/chips";
import { guideSections } from "@/lib/copilot/guide";
import { DEFAULT_FILTER, type StoredIntent } from "@/lib/copilot/intent";
import { buildPlan } from "@/lib/copilot/plan";
import { lookupCompany, runFilter, type CopilotRow } from "@/lib/copilot/query";
import { statsSummary, type StatsSummary } from "@/lib/copilot/stats-summary";
import type { CopilotFilter } from "@/lib/validation";

// Turning a checked intent into everything the person sees. All of it is read from the workspace by
// code, inside withTenant: the model's only contribution is the intent (and the one reply sentence
// that passed its checks). One function, used for a fresh answer, a starter chip, a chip edit and
// "Show again", so they can't differ.

export type CopilotView = StoredIntent["view"];

// Everything a screen shows for one turn.
export type ViewParts = {
  reply: string;
  view: CopilotView;
  // Plain sentences about parts that were left out, built by code.
  notes: string[];
  filter: CopilotFilter | null;
  chips: FilterChip[];
  // "7 companies match. Most overdue: ..." for a list, the plan's line for a plan, else null.
  summary: string | null;
  total: number;
  rows: CopilotRow[];
  company: CompanyCard | null;
  stats: StatsSummary | null;
  // Guide sections shown word for word.
  guide: { id: string; title: string; body: string[] }[];
  cards: ActionCard[];
  // "Apply all" is offered only when every card sets a follow-up date.
  applyAll: boolean;
  // The view is "none": show the reply and the starter chips.
  showStarters: boolean;
};

export type BuiltView = {
  // The intent as it ended up, which can differ from the one that came in: a company name that
  // matched several companies became a list, one that matched none became a plain reply.
  intent: StoredIntent;
  // Ids of the companies shown, at most 25, which is what a thread remembers.
  shown: string[];
  parts: ViewParts;
};

const MANY_REPLY = "Several companies match that name.";
const NOT_FOUND_REPLY = "I couldn't find a company with that name here.";

export async function buildView(member: Membership, input: StoredIntent, notes: string[], now: Date): Promise<BuiltView> {
  let intent = input;
  let company: CompanyCard | null = null;

  // A company named rather than picked from the shown list is looked up by code.
  if (intent.view === "company" && intent.company) {
    let id = intent.company.id;
    if (!id && intent.company.name) {
      const found = await lookupCompany(member, intent.company.name);
      if (found.kind === "one") {
        id = found.id;
        intent = { ...intent, company: { id, name: null } };
      } else if (found.kind === "many") {
        intent = { ...intent, view: "companies", reply: MANY_REPLY, company: null, filter: { ...DEFAULT_FILTER, nameOrSite: intent.company.name } };
      } else {
        intent = { ...intent, view: "none", reply: NOT_FOUND_REPLY, company: null };
      }
    }
    if (intent.view === "company" && id) {
      company = await companyCard(member, id, now);
      if (!company) intent = { ...intent, view: "none", reply: NOT_FOUND_REPLY, company: null };
    }
  }

  let filter: CopilotFilter | null = null;
  let summary: string | null = null;
  let total = 0;
  let rows: CopilotRow[] = [];
  let stats: StatsSummary | null = null;
  let guide: ViewParts["guide"] = [];

  if (intent.view === "companies") {
    filter = intent.filter ?? DEFAULT_FILTER;
    const result = await runFilter(member, filter, now);
    rows = result.rows;
    total = result.total;
    summary = result.summary;
  } else if (intent.view === "plan") {
    const plan = await buildPlan(member, intent.minutes ?? 30, now);
    rows = plan.rows;
    total = plan.rows.length;
    summary = plan.summary;
  } else if (intent.view === "stats") {
    stats = await statsSummary(member);
  } else if (intent.view === "guide") {
    guide = guideSections(intent.guideTopics).map(({ id, title, body }) => ({ id, title, body }));
  }

  const specs: ActionSpec[] = intent.actions.flatMap((a) => a.companyIds.map((companyId) => ({ type: a.type, companyId, stage: a.stage, followUpOn: a.followUpOn })));
  const cards = specs.length === 0 ? [] : await cardsFor(specs, await cardContext(member, now));

  return {
    intent,
    shown: company ? [company.id] : rows.map((r) => r.id),
    parts: {
      reply: intent.reply,
      view: intent.view,
      notes,
      filter,
      chips: filter ? filterChips(filter) : [],
      summary,
      total,
      rows,
      company,
      stats,
      guide,
      cards,
      applyAll: cards.length >= 2 && cards.every((c) => c.type === "SET_FOLLOW_UP"),
      showStarters: intent.view === "none",
    },
  };
}
