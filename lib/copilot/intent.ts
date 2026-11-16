import { isCalendarDate } from "@/lib/claims";
import { addDays } from "@/lib/dates";
import { STAGE_LABELS } from "@/lib/stages";
import { COPILOT_QUESTION_MAX, type CopilotFilter, type CopilotIntent } from "@/lib/validation";

// Checking what the model said. The model's reply to a question is one JSON intent; it passed the
// Zod schema (lib/validation.ts copilotIntentSchema) to get here, and nothing in it is trusted yet.
// Pure: the question, the ids of the companies just shown, the workspace's industries, the database's
// today and the guide's ids go in; a cleaned intent and a list of plain notes come out.
//
// Each check drops only the part that fails, never the whole answer:
// - the reply sentence is the model's only for the guide and none views, where nothing on screen says
//   it for them; the other views show a fixed sentence, because their rows and summary line already
//   say everything and a model must not state a number, a date or a name there. A model sentence
//   that stays is replaced by the fixed one if it holds a digit or number word, a date or a
//   weekday, a link or an email address, or a capitalised name, that isn't in the person's own
//   question (or a name Coppice itself listed);
// - a company id, and every id in an action, must be one that was in the "shown" list sent in this
//   very request, so an id the model made up (or one from another workspace) goes nowhere;
// - an industry must be one the workspace uses, a follow-up date must be a real day from the
//   database's today to a year out, and guide topics must exist;
// - at most 10 companies across all actions.
// Only when the view itself has nothing left (a company view with no company, a guide view with no
// topic) is the answer unusable, and the call is logged as one whose answer broke the rules.

export const DEFAULT_FILTER: CopilotFilter = {
  stages: [],
  industry: null,
  due: "any",
  claim: "any",
  neverContacted: false,
  nameOrSite: null,
  notesMention: null,
  sort: "most_overdue",
};
export const MAX_ACTION_COMPANIES = 10;
export const PLAN_MINUTES = { min: 10, max: 120, fallback: 30 } as const;
export const GUIDE_TOPICS_MAX = 3;
export const FILTER_TEXT_MAX = 100;

// The same shape the model sends. What is stored and shown has been through checkIntent.
export type StoredIntent = CopilotIntent;

export type CheckContext = {
  // The person's own question, whose numbers a reply may repeat.
  question: string;
  // The company ids that were in the "shown" list this request sent the model.
  shownIds: ReadonlySet<string>;
  industries: readonly string[];
  // The database's today in West Lafayette, "2026-11-13".
  today: string;
  guideIds: readonly string[];
  // Names a model sentence may use besides the question's own words: the companies just shown and the
  // guide's titles. Industries and stage names are always allowed.
  names?: readonly string[];
};

export type Checked = { intent: StoredIntent; notes: string[]; usable: boolean };

export const NONE_INTENT: StoredIntent = { view: "none", reply: "", filter: null, company: null, minutes: null, guideTopics: [], actions: [] };

// What stands in for a reply that broke a rule, or came back empty. No digits, so it passes its own
// check when the intent is checked again from the database.
export const CODE_REPLIES: Record<StoredIntent["view"], string> = {
  companies: "Here are the companies that match.",
  company: "Here is that company.",
  plan: "Here is a plan.",
  stats: "Here are your template stats.",
  guide: "Here is what the Coppice guide says.",
  none: "I can't help with that here. Try a starter instead.",
};

const NOTE_INDUSTRY = "Coppice couldn't match that industry, so the list isn't filtered by it.";
const NOTE_ACTIONS = "Some suggested actions were left out because they didn't pass Coppice's checks.";

// ----- The reply sentence -----

const NUMBERS = /\p{Nd}+/gu;
const EMAIL = /[^\s@]+@[^\s@]+/;
const LINK = /(?:https?|ftp):\/\/|\bwww\.|\b[\w-]+(?:\.[\w-]+)*\.(?:com|org|edu|net|io|co|us|ai|dev|app|gov|info|me|biz|ly|to|uk|ca|de)\b|\b[\w-]+\.[a-z]{2,}\//i;
// An address spelled out to get past a check: "acme dot com".
const SPELLED_LINK = /(?:\bdot|[(\[]dot[)\]])\s*(?:com|org|edu|net|io|co|us|ai|dev|app|gov|info|me|biz)\b/i;
// A number in words, which is as much a number as a digit is. "May" and "March" are left to the
// capital-letter check, because in lower case they are ordinary words.
const NUMBER_WORDS = /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundreds?|thousands?|millions?|billions?|dozens?)\b/giu;
const DATE_WORDS = new RegExp(
  [
    "\\b(?:january|february|april|june|july|august|september|october|november|december|jan|feb|apr|jun|jul|aug|sept?|oct|nov|dec)\\b",
    "\\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\\b",
    "\\b(?:today|tomorrow|yesterday|tonight|weekends?)\\b",
    "\\b(?:next|last|this|every|each)\\s+(?:week|month|year|quarter|day|weekend|semester)\\b",
  ].join("|"),
  "giu",
);
const WORD = /\p{L}[\p{L}\p{M}'\u2019-]*/gu;
const ALWAYS_ALLOWED = ["coppice", "groq", "gemini", "ai", "csv", "ok", "id"];

export const cleanText = (text: string) => text.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();

const wordsOf = (text: string) => text.toLowerCase().split(/[^\p{L}\p{M}]+/u).filter(Boolean);

// Whether a model sentence breaks a rule: a number (in digits or words) or a date the person's own
// question didn't use, a link or an email address, or a capitalised word that is not the start of a
// sentence, not in the question, not a stage or industry name, not "Coppice", and not one of the
// `names` Coppice listed. A model can't state a number, a date or a name that is not Coppice's own.
export function replyProblem(reply: string, question: string, names: readonly string[] = [], industries: readonly string[] = []): boolean {
  const asked = new Set(question.match(NUMBERS) ?? []);
  if ((reply.match(NUMBERS) ?? []).some((n) => !asked.has(n))) return true;
  if (EMAIL.test(reply) || LINK.test(reply) || SPELLED_LINK.test(reply)) return true;

  const askedText = ` ${wordsOf(question).join(" ")} `;
  const inQuestion = (phrase: string) => askedText.includes(` ${wordsOf(phrase).join(" ")} `);
  const unasked = (pattern: RegExp) => (reply.match(pattern) ?? []).some((found) => !inQuestion(found));
  if (unasked(NUMBER_WORDS) || unasked(DATE_WORDS)) return true;

  const allowed = new Set([
    ...ALWAYS_ALLOWED,
    ...wordsOf(question),
    ...names.flatMap(wordsOf),
    ...industries.flatMap(wordsOf),
    ...Object.values(STAGE_LABELS).flatMap(wordsOf),
  ]);
  for (const match of reply.matchAll(WORD)) {
    const token = match[0];
    if (!/^\p{Lu}/u.test(token) || /^I(?:['\u2019][a-z]+)?$/.test(token)) continue;
    // The start of a sentence: nothing before it, or a full stop, question mark or exclamation mark.
    const before = reply.slice(0, match.index).replace(/[\s"'\u201c\u2018(\[]+$/u, "");
    if (before === "" || /[.!?]$/.test(before)) continue;
    const parts = token.toLowerCase().replace(/['\u2019]s$/, "").split(/[-'\u2019]/).filter(Boolean);
    if (parts.every((part) => allowed.has(part))) continue;
    return true;
  }
  return false;
}

// ----- Filters -----

const squash = (text: string) => cleanText(text).toLowerCase();

// The workspace's industry the model meant, or null. Matches without regard to case or extra
// spaces. The model sees long industry names cut short (lib/copilot/prompt.ts), so it may send the
// start of one: that counts when exactly one industry begins with it.
export function matchIndustry(value: string | null, industries: readonly string[]): string | null {
  // The cut-short names the model saw end in "…"; it may send that back.
  const wanted = value ? squash(value).replace(/[…]+$/, "").trim() : "";
  if (!wanted) return null;
  const exact = industries.find((i) => squash(i) === wanted);
  if (exact) return exact;
  const starts = wanted.length >= 3 ? industries.filter((i) => squash(i).startsWith(wanted)) : [];
  return starts.length === 1 ? starts[0] : null;
}

const searchText = (text: string | null) => {
  const cleaned = text ? cleanText(text).slice(0, FILTER_TEXT_MAX).trim() : "";
  return cleaned === "" ? null : cleaned;
};

// A filter the model wrote, or a person's chip edit, cut down to what the workspace can run.
export function checkFilter(filter: CopilotFilter, ctx: Pick<CheckContext, "industries">): { filter: CopilotFilter; notes: string[] } {
  const notes: string[] = [];
  const industry = matchIndustry(filter.industry, ctx.industries);
  if (filter.industry && cleanText(filter.industry) !== "" && industry === null) notes.push(NOTE_INDUSTRY);
  return {
    filter: {
      stages: [...new Set(filter.stages)],
      industry,
      due: filter.due,
      claim: filter.claim,
      neverContacted: filter.neverContacted,
      nameOrSite: searchText(filter.nameOrSite),
      notesMention: searchText(filter.notesMention),
      sort: filter.sort,
    },
    notes,
  };
}

// ----- Actions -----

// Whether the text is a real calendar day from `today` to a year out, the rule logOutreach and
// setFollowUp keep (lib/claims.ts).
export const followUpOk = (ymd: string | null, today: string): ymd is string => ymd !== null && isCalendarDate(ymd) && ymd >= today && ymd <= addDays(today, 365);

function checkActions(actions: StoredIntent["actions"], ctx: CheckContext): { actions: StoredIntent["actions"]; dropped: boolean } {
  const kept: StoredIntent["actions"] = [];
  let used = 0;
  let dropped = false;
  for (const action of actions) {
    const ids = [...new Set(action.companyIds)];
    const known = ids.filter((id) => ctx.shownIds.has(id));
    if (known.length < ids.length) dropped = true;
    // MOVE_STAGE needs a stage and SET_FOLLOW_UP a good date; the other types carry neither.
    const stage = action.type === "MOVE_STAGE" ? action.stage : null;
    const followUpOn = action.type === "SET_FOLLOW_UP" && followUpOk(action.followUpOn, ctx.today) ? action.followUpOn : null;
    const needsMore = (action.type === "MOVE_STAGE" && stage === null) || (action.type === "SET_FOLLOW_UP" && followUpOn === null);
    if (known.length === 0 || needsMore) {
      dropped = true;
      continue;
    }
    const room = MAX_ACTION_COMPANIES - used;
    if (room <= 0) {
      dropped = true;
      continue;
    }
    const companyIds = known.slice(0, room);
    if (companyIds.length < known.length) dropped = true;
    used += companyIds.length;
    kept.push({ type: action.type, companyIds, stage, followUpOn });
  }
  return { actions: kept, dropped };
}

// ----- The intent -----

export function checkIntent(raw: CopilotIntent, ctx: CheckContext): Checked {
  const notes: string[] = [];
  let view = raw.view;
  let filter: StoredIntent["filter"] = null;
  let company: StoredIntent["company"] = null;
  let minutes: number | null = null;
  let guideTopics: string[] = [];
  let usable = true;

  if (view === "companies") {
    const checked = checkFilter(raw.filter ?? DEFAULT_FILTER, ctx);
    filter = checked.filter;
    notes.push(...checked.notes);
  } else if (view === "company") {
    // An id counts only from the shown list; a name is looked up by code afterwards.
    const id = raw.company?.id && ctx.shownIds.has(raw.company.id) ? raw.company.id : null;
    const name = raw.company?.name ? searchText(raw.company.name) : null;
    if (id) company = { id, name: null };
    else if (name) company = { id: null, name };
    else {
      usable = false;
      view = "none";
    }
  } else if (view === "plan") {
    const asked = raw.minutes === null || !Number.isFinite(raw.minutes) ? PLAN_MINUTES.fallback : Math.round(raw.minutes);
    minutes = Math.min(PLAN_MINUTES.max, Math.max(PLAN_MINUTES.min, asked));
  } else if (view === "guide") {
    guideTopics = [...new Set(raw.guideTopics.map((t) => t.trim()))].filter((t) => ctx.guideIds.includes(t)).slice(0, GUIDE_TOPICS_MAX);
    if (guideTopics.length === 0) {
      usable = false;
      view = "none";
    }
  }

  const checkedActions = usable ? checkActions(raw.actions, ctx) : { actions: [], dropped: false };
  if (checkedActions.dropped) notes.push(NOTE_ACTIONS);

  // The model's sentence stands only where nothing else on screen says it (see the top of this file).
  const said = cleanText(raw.reply);
  const modelSpeaks = view === "guide" || view === "none";
  const reply = modelSpeaks && said !== "" && !replyProblem(said, ctx.question, ctx.names, ctx.industries) ? said : CODE_REPLIES[view];

  return {
    intent: { view, reply, filter, company, minutes, guideTopics, actions: checkedActions.actions },
    notes,
    usable,
  };
}

// A stored intent read back from the database, checked again: the filter against today's industries
// and the actions against today's date. The companies in its actions were checked when it was made,
// so they stand as the "shown" list here.
export function recheckStored(stored: StoredIntent, ctx: Omit<CheckContext, "shownIds">): Checked {
  const shownIds = new Set(stored.actions.flatMap((a) => a.companyIds));
  const company = stored.company?.id ? { id: stored.company.id, name: stored.company.name } : stored.company;
  if (company?.id) shownIds.add(company.id);
  const checked = checkIntent({ ...stored, company }, { ...ctx, shownIds });
  // The reply was written or checked when the turn was made (or is a starter's fixed sentence), and the
  // names it was allowed then are not known now, so it is kept as it was unless the view changed.
  if (checked.intent.view === stored.view && stored.reply.trim() !== "") return { ...checked, intent: { ...checked.intent, reply: stored.reply } };
  return checked;
}

// ----- The question -----

export function questionProblem(question: string): string | null {
  const text = question.trim();
  if (text === "") return "Ask a question.";
  if (text.length > COPILOT_QUESTION_MAX) return `A question can be at most ${COPILOT_QUESTION_MAX} characters.`;
  if (text.includes("\0")) return "This text has a character Coppice can't save.";
  return null;
}
