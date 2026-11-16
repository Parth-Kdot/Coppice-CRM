// What assistants changed: the fixed vocabulary behind the AssistantActivity table and the list in
// Settings. No free text is ever stored. A row holds the tool's name and one action key from the
// list below (the table's CHECK constraint has the same list, and a test keeps the two equal), and
// the line people read is built from the pair (tool, action) by ACTIVITY_LINES, with the company's
// or target's name looked up when the list is drawn.
//
// Pure data: nothing here touches the database, so the Settings page and the tools both import it.

export const ACTIVITY_ACTIONS = [
  "added",
  "updated",
  "archived",
  "unarchived",
  "claimed",
  "released",
  "force_released",
  "logged",
  "replied",
  "follow_up_set",
  "stage_changed",
  "kept_separate",
  "archived_duplicate",
  "deleted_contact",
  "deleted_fact",
  "deleted_fact_sheet",
  "verified",
  "unverified",
  "started",
  "ended",
  "departing_set",
  "departing_cleared",
  "claims_released",
  "cards_built",
  "card_reviewed",
  "cards_approved",
  "dates_saved",
  "dates_filled",
  "calendar_applied",
  "reopened",
  "published",
  "unpublished",
  "imported",
  "done",
] as const;
export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

// What a row's target is, so the list knows how to label it for the person looking. A company is its
// name with a link and a contact, template or research source is its name; the rest are fixed
// phrases that never show typed text (see ACTIVITY_PHRASES). A member is the person's name, shown to
// owners only (see OWNER_ONLY_TOOLS). "none" means the line stands alone.
export type ActivityTarget = "company" | "contact" | "template" | "source" | "member" | "fact" | "fact_sheet" | "card" | "report" | "import" | "experiment" | "none";

export const ACTIVITY_PHRASES: Record<"fact" | "fact_sheet" | "card" | "report" | "import" | "experiment", string> = {
  fact: "a fact",
  fact_sheet: "the fact sheet",
  card: "a handoff card",
  report: "the handoff",
  import: "an import",
  experiment: "an experiment",
};

// The noun in front of a name that is not a company's, so a line reads "added the template Alumni
// angle" while one whose target is gone reads "added a template" (ACTIVITY_GONE_PHRASES).
export const ACTIVITY_NAME_PREFIX: Record<"contact" | "template" | "source" | "member", string> = {
  member: "",
  contact: "the contact ",
  template: "the template ",
  source: "the research source ",
};

// What a line says when the company, contact, template, research source or member it was about is gone, or
// when the person looking may not see its name. Never a name, so nothing typed is shown.
export const ACTIVITY_GONE_PHRASES: Record<"company" | "contact" | "template" | "source" | "member", string> = {
  company: "a company",
  contact: "a contact",
  template: "a template",
  source: "a research source",
  member: "a member who is no longer here",
};
// A member line that never recorded who it was about (rows written before the target was stored).
export const ACTIVITY_UNKNOWN_MEMBER = "a member";

// The tools whose rows only owners are shown. Who is leaving is an owner's to see in the app, so the
// list leaves these rows out for everyone else (lib/mcp/activity-list.ts).
export const OWNER_ONLY_TOOLS = ["set_departing", "release_departing_claims"] as const;

// `after` is the words that follow the label ("marked Sam Lee as leaving").
type Line = { verb: string; target: ActivityTarget; after?: string };
const line = (verb: string, target: ActivityTarget, after?: string): Line => ({ verb, target, ...(after ? { after } : {}) });

// "<person>'s assistant <verb> <label>". One entry for every action tool, keyed by the tool's name
// and then the action key it records. A tool that records an action not listed here, or a row from
// an older version of Coppice, reads as "changed" (activityLine).
export const ACTIVITY_LINES: Record<string, Partial<Record<ActivityAction, Line>>> = {
  claim_company: { claimed: line("claimed", "company") },
  log_outreach: { logged: line("logged outreach for", "company") },
  change_stage: { stage_changed: line("moved the stage of", "company") },
  create_company: { added: line("added", "company") },
  update_company: { updated: line("edited", "company") },
  restore_previous_version: { updated: line("restored a previous version on", "company") },
  set_company_archived: { archived: line("archived", "company"), unarchived: line("unarchived", "company") },
  resolve_duplicate: { kept_separate: line("kept apart look-alikes of", "company"), archived_duplicate: line("archived as a duplicate", "company") },
  release_claim: { released: line("released the claim on", "company"), force_released: line("released someone else's claim on", "company") },
  mark_reply: { replied: line("marked a reply from", "company") },
  set_follow_up: { follow_up_set: line("set a follow-up date for", "company") },
  save_contact: { added: line("added", "contact"), updated: line("edited", "contact") },
  delete_permanently: {
    deleted_contact: line("deleted", "contact"),
    deleted_fact: line("deleted", "fact"),
    deleted_fact_sheet: line("deleted", "fact_sheet"),
  },
  save_fact: { added: line("added", "fact"), updated: line("edited", "fact") },
  set_fact_verified: { verified: line("verified", "fact"), unverified: line("took the verified mark off", "fact") },
  save_template: { added: line("added", "template"), updated: line("edited", "template") },
  set_template_archived: { archived: line("archived", "template"), unarchived: line("unarchived", "template") },
  save_research_source: { added: line("added", "source"), updated: line("renamed", "source") },
  set_research_source_archived: { archived: line("archived", "source") },
  accept_brief_item: { updated: line("added a research item to the notes of", "company") },
  start_experiment: { started: line("started", "experiment") },
  end_experiment: { ended: line("ended", "experiment") },
  set_departing: { departing_set: line("marked", "member", " as leaving"), departing_cleared: line("cleared the leaving mark for", "member") },
  release_departing_claims: { claims_released: line("released the claims of members who are leaving", "none") },
  start_handoff: { started: line("started", "report") },
  build_handoff_cards: { cards_built: line("built the cards for", "report") },
  review_handoff_card: { card_reviewed: line("reviewed", "card") },
  approve_remaining_cards: { cards_approved: line("approved the remaining cards of", "report") },
  save_recontact_dates: { dates_saved: line("saved re-contact dates in", "report") },
  fill_blank_dates: { dates_filled: line("filled the blank re-contact dates in", "report") },
  apply_handoff_calendar: { calendar_applied: line("applied the re-contact dates of", "report") },
  reopen_for_next_year: { reopened: line("reopened for next year:", "company") },
  set_handoff_published: { published: line("published", "report"), unpublished: line("unpublished", "report") },
  run_import: { imported: line("ran", "import") },
};

// The words for an unknown pair. The list shows the company's name after it when the row has one.
export const ACTIVITY_FALLBACK: Line = { verb: "changed", target: "company" };

export function activityLine(tool: string, action: string): Line {
  const known = Object.hasOwn(ACTIVITY_LINES, tool) ? ACTIVITY_LINES[tool] : undefined;
  const found = known && Object.hasOwn(known, action) ? known[action as ActivityAction] : undefined;
  return found ?? ACTIVITY_FALLBACK;
}
