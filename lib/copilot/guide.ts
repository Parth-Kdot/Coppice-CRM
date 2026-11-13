import { AI_WINDOW_DAYS, DAILY_BRIEFS_PER_PERSON, DAILY_COPILOT_PER_PERSON, DAILY_DRAFTS_PER_PERSON } from "@/lib/ai/run";
import { PDF_MAX_BYTES, PDF_MAX_PAGES } from "@/lib/ai/pdf-limits";
import { AI_LIMIT_MAX, BRIEF_SOURCES_MAX, CLAIM_WINDOW_MAX_DAYS, CLAIM_WINDOW_MIN_DAYS, IMPORT_MAX_BYTES, IMPORT_MAX_ROWS, NOTE_MAX, SMART_MAX_ROWS } from "@/lib/limits";
import { MCP_LIMITS } from "@/lib/mcp/rate-limit";
import { basicsSteps } from "@/lib/onboarding-steps";
import { FRESH_CAP, FRESH_PAGE, QUEUE_CAP, QUEUE_SIZE, QUEUE_STEP } from "@/lib/queue";
import { MATURITY_DAYS, MIN_SENDS } from "@/lib/stats-math";

// Coppice's own product guide, which Ask Coppice answers "how do claims work?" from. The sections
// are shown to the person word for word: the model only picks which ones (by id), so it can't state
// anything about the product that isn't written here. Every number is read from the constant the
// code itself uses, so the guide can't drift from the product; the two numbers that live only in the
// database schema (a new workspace's claim window and AI limit) are checked against it by
// tests/copilot-guide.test.ts. Each statement was written from the code that does it. Plain, short
// words, as everywhere in Coppice.

export type GuideTopic = {
  id: string;
  title: string;
  // One line, which is all the model sees of it.
  summary: string;
  // Two to five short paragraphs.
  body: string[];
};

// A new workspace's claim window and AI limit (prisma/schema.prisma Workspace).
export const DEFAULT_CLAIM_WINDOW_DAYS = 14;
export const DEFAULT_AI_LIMIT = 300;

const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;
const megabytes = (bytes: number) => `${Number((bytes / (1024 * 1024)).toFixed(1))} MB`;
// Officers see the basics tour's cards; owners see one more (the invite card).
const officerCards = basicsSteps({ role: "member", empty: false, basicsRole: null }).length;
const ownerCards = basicsSteps({ role: "owner", empty: false, basicsRole: null }).length;

export const GUIDE: GuideTopic[] = [
  {
    id: "claims",
    title: "Claims and the claim window",
    summary: "Marks a company you are pitching.",
    body: [
      "A claim says you are pitching a company. While it is live, nobody else can claim it, log outreach on it or change its follow-up date, and only you or an owner can move its stage or archive it.",
      `A claim lasts ${days(DEFAULT_CLAIM_WINDOW_DAYS)} in a new workspace. An owner can set the window anywhere from ${days(CLAIM_WINDOW_MIN_DAYS)} to ${days(CLAIM_WINDOW_MAX_DAYS)} in Settings. When it ends, the company is free again and anyone can claim it.`,
      "Logging outreach renews your claim for a full window, and so does claiming a company you already hold. You can claim a company nobody holds, one whose claim has ended, or one you hold. A Committed or Declined company can't be claimed.",
      "Drafting an email with AI claims the company for you first, so two officers can't draft to the same company.",
    ],
  },
  {
    id: "release",
    title: "Release and force release",
    summary: "Give a claim up early. Owners clear any.",
    body: [
      "Release gives up your own claim before it ends, so the company is free for others. It changes nothing else: the stage and the follow-up date stay as they are.",
      "Only the person holding a claim can release it. An owner can force-release anyone's claim, which helps when an officer goes quiet.",
      "A claim also ends when its company moves to Committed or Declined, or is archived. When a member is removed or leaves, their claims are released.",
    ],
  },
  {
    id: "logging",
    title: "Logging outreach and follow-up dates",
    summary: "Log what you sent, pick a follow-up.",
    body: [
      `After you reach out, log it on the company: how you did it (email, LinkedIn, in person or other), an optional note of up to ${NOTE_MAX} characters, and a follow-up date. You need to hold the claim to log.`,
      "Logging sets last contacted to now, renews your claim and moves a Not contacted company to Contacted. The company comes back to your queue on its follow-up date.",
      "A follow-up date can be today or any day up to a year ahead, counted in West Lafayette time.",
      "Ask Coppice can also set only the follow-up date, without logging anything. That changes the date alone: it doesn't claim the company, renew a claim or add an outreach entry. It works on any open company that nobody else holds.",
    ],
  },
  {
    id: "queue",
    title: "How the queue is ordered",
    summary: "Due companies, longest overdue first.",
    body: [
      "The queue is the home screen. It lists open companies (not Committed, Declined or archived) whose follow-up date has arrived. The longest overdue come first, then companies by name.",
      `They sit in three groups: Yours (you hold the claim), Up for grabs (nobody holds it, or its claim ended) and Held by others. Yours and Up for grabs show the first ${QUEUE_SIZE} and load ${QUEUE_STEP} more at a time, up to ${QUEUE_CAP}.`,
      `Fresh leads are companies nobody has contacted, with no follow-up date, that nobody else holds. They wait in a list at the bottom, newest first, ${FRESH_PAGE} at a time, up to ${FRESH_CAP}.`,
    ],
  },
  {
    id: "stages",
    title: "Stages, Committed and Declined",
    summary: "Six stages, two of them outcomes.",
    body: [
      "Every company is in one of six stages: Not contacted, Contacted, Replied, In conversation, Committed or Declined. Logging outreach moves Not contacted to Contacted. You move the others yourself, on the board or the company page.",
      "Committed and Declined are the outcomes. Moving a company there asks first, ends the pitch and releases any claim. A closed company can't be claimed, logged on or given a follow-up date until someone reopens it.",
      "Moving a company backwards, or reopening a closed one, asks first too. Moving into Replied, In conversation or Committed asks which outreach got the reply, so template stats know what worked.",
      "A live claim held by someone else blocks a stage move, unless you are an owner. Every move is kept in the company's history.",
    ],
  },
  {
    id: "duplicates",
    title: "Duplicates",
    summary: "Look-alikes are flagged, never merged.",
    body: [
      "Coppice flags two companies as possible duplicates when their names match after ignoring case, punctuation, a leading The and endings like Inc or LLC, or when they share a website. Pages on shared sites such as LinkedIn are told apart by the page address.",
      "Nothing is merged or blocked for you. When you add or import a company you see its look-alikes, and you choose: mark them as separate, or archive the one you don't want.",
      "Archived companies count too, so adding a company you archived last year offers to bring it back with its history. Smart import also flags names that look alike without matching, such as Lilly and Eli Lilly, and says why.",
    ],
  },
  {
    id: "import",
    title: "Importing and Smart import",
    summary: "CSV import, and the optional AI reading.",
    body: [
      `Import takes a CSV file of up to ${IMPORT_MAX_ROWS} rows and ${megabytes(IMPORT_MAX_BYTES)}. You pick which column fills each field and preview the result. Coppice checks every row and looks for duplicates before anything is saved. Rows with problems are listed by row number.`,
      `Smart import is an option when AI is on. It reads the free-text cells of up to ${SMART_MAX_ROWS} rows (status, notes, history) and proposes a stage, a last contacted date, a follow-up date and a contact for each row, with the words each came from.`,
      "You accept, edit or drop every proposal before anything is written. Smart import never sets Committed or Declined, and a row that says not to contact the company is flagged so you can decide.",
    ],
  },
  {
    id: "templates-stats",
    title: "Templates and the stats rules",
    summary: "Which emails get replies, with care.",
    body: [
      "Owners write templates in Settings, and every officer can pick one when logging outreach or drafting. A template can use only the {{firstName}}, {{senderName}} and {{orgName}} placeholders. A template that was used is archived, never deleted, so its history stays in the stats.",
      `A send counts toward a template's reply rate only once it is ${days(MATURITY_DAYS)} old, so a recent email with no answer yet isn't held against it.`,
      `A template is rated only after ${MIN_SENDS} counted sends. Each rate comes with a 95 percent range. Coppice names a best or worst template only when its whole range sits above or below every other rated template's range.`,
      "A reply counts only when someone marks which outreach got it. The stats page points out companies that replied with nothing marked.",
    ],
  },
  {
    id: "drafts",
    title: "Fact sheet, drafts and Claim Checker",
    summary: "Drafts from verified facts. Nothing is sent.",
    body: [
      `An owner uploads the sponsorship packet as a PDF, up to ${megabytes(PDF_MAX_BYTES)} and ${PDF_MAX_PAGES} pages. The AI lists the facts in it, each with the sentence and page it came from, and code checks that the sentence really is on that page. No fact is used until an owner verifies it. Owners can also add, edit and delete facts by hand.`,
      `Draft email writes two variants of a first email or a follow-up, from verified facts only, and claims the company for you first. Coppice fills in names after the AI answers. Each person can make ${DAILY_DRAFTS_PER_PERSON} drafts in 24 hours.`,
      "Coppice never sends email. You open a draft in Gmail, Outlook on the web or your mail app, send it from there, and press I sent it to log the outreach.",
      "The Claim Checker flags what a draft says that the facts don't back up: numbers with no verified fact, links, and claims of a past sponsorship. Rules run as you type and an AI check adds more. It only advises. You decide what to change.",
    ],
  },
  {
    id: "research",
    title: "Research briefs",
    summary: "Who to contact, from approved pages.",
    body: [
      "A brief suggests which door to knock on at a company, such as campus recruiting, university relations, a giving portal or an employee resource group. Ask for one with Who to contact on a company's page.",
      `Owners approve the source pages first, in Settings. Coppice reads only those pages, up to ${BRIEF_SOURCES_MAX} for a brief, and follows each site's robots.txt.`,
      "Every item in a brief cites a quote from a page that was read, and code checks the quote. Nothing changes on the company until you add a specific item to its notes.",
      `Each person can ask for ${DAILY_BRIEFS_PER_PERSON} briefs in 24 hours.`,
    ],
  },
  {
    id: "assistants",
    title: "AI assistants",
    summary: "Outside assistants, if an owner allows.",
    body: [
      "An owner can allow outside AI assistants for the workspace in Settings. They are off by default.",
      "Each person connects their own assistant and chooses whether it can only read, or can also claim companies, log outreach and move stages as them. What an assistant changes is marked in the company's history.",
      `An assistant follows the same rules you do: a live claim held by someone else blocks it, and Committed or Declined need an explicit yes. Each person is limited to ${MCP_LIMITS.read} reads and ${MCP_LIMITS.action} changes a minute.`,
      "Whatever an assistant reads, including contact names and notes, goes to the company behind that assistant. That is separate from Coppice's own AI.",
    ],
  },
  {
    id: "roles",
    title: "Owner and officer roles",
    summary: "What owners do that officers cannot.",
    body: [
      "Everyone in a workspace is an owner or an officer. Officers do the daily work: add and edit companies, claim, log outreach, move stages, import, draft emails and ask for research briefs.",
      "Owners can do all of that, and they alone can invite and remove members, change roles, set the claim window, turn AI and assistants on or off, set the AI limit, manage templates, the fact sheet and research sources, force-release claims and delete the workspace.",
      "An owner can move a company's stage even while an officer holds it, but can't log outreach on a company they don't hold.",
      "A workspace always keeps at least one owner. To hand over, make someone else an owner first, then become an officer.",
    ],
  },
  {
    id: "ai-limits",
    title: "AI limits and what providers receive",
    summary: "Limits, and what Google and Groq get.",
    body: [
      `AI is off until an owner turns it on in Settings. A new workspace may make ${DEFAULT_AI_LIMIT} AI calls in ${AI_WINDOW_DAYS} days, and an owner can change that from 0 to ${AI_LIMIT_MAX}. Failed calls still count.`,
      `Each person also has limits for 24 hours: ${DAILY_DRAFTS_PER_PERSON} drafts, ${DAILY_BRIEFS_PER_PERSON} research briefs and ${DAILY_COPILOT_PER_PERSON} questions to Ask Coppice. A failure on the AI service's side doesn't count against the person.`,
      "Google's free Gemini tier, which may use what it receives to improve Google's products, reads fact sheet pages, writes drafts with placeholders in place of names, reads research pages an owner approved and sees only the shape of most Smart import cells. Groq reads Smart import's free-text cells and answers Ask Coppice.",
      "Ask Coppice sends Groq your question, your last few questions in that conversation, the names of companies it just showed you and the industry names your workspace uses. Notes, contacts and outreach history are not sent: the rows you see are read from your workspace by code. Email addresses and phone numbers are masked in everything sent.",
      "Groq says it doesn't keep what it is sent by default, apart from logs it may hold for up to 30 days to look into errors or abuse.",
    ],
  },
  {
    id: "tours",
    title: "The tours",
    summary: "The first tour and the AI tour.",
    body: [
      `The first time you open a workspace, a short tour shows the queue, claiming, logging, the board, adding companies and search. Officers get ${officerCards} cards and owners get ${ownerCards}, because owners also learn how to invite people.`,
      "You can hide the tour and pick it up again from the Resume pill. A longer, optional tour covers the AI features. It is offered once the first tour is done, and it stays in your account menu.",
    ],
  },
];

export const GUIDE_IDS: readonly string[] = GUIDE.map((t) => t.id);

// What the model sees of the guide: one line a topic.
export const guideIndex = (): { id: string; title: string; summary: string }[] => GUIDE.map(({ id, title, summary }) => ({ id, title, summary }));

// The topics for these ids, in the order given, each once. Unknown ids are skipped.
export function guideSections(ids: readonly string[]): GuideTopic[] {
  const seen = new Set<string>();
  const out: GuideTopic[] = [];
  for (const id of ids) {
    const topic = GUIDE.find((t) => t.id === id);
    if (topic && !seen.has(id)) {
      seen.add(id);
      out.push(topic);
    }
  }
  return out;
}
