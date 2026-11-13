import { z } from "zod";
import { Channel, DraftKind, Stage } from "@/generated/prisma/enums";
import { clamped, keptItems } from "@/lib/ai/schema";
import { domainKey } from "@/lib/duplicates";
import { placeholderProblem } from "@/lib/placeholders";
import { parseSourceUrl, SKIP_MESSAGES } from "@/lib/research/urls";
import { MCP_SCOPES } from "@/lib/mcp/config";
import { ARCHIVE_QUESTION_MAX, ARCHIVE_QUESTION_MIN, CARD_MAX_CALLS } from "@/lib/capsule/limits";
import {
  AI_LIMIT_MAX,
  BOARD_QUERY_MAX,
  CLAIM_WINDOW_MAX_DAYS,
  CLAIM_WINDOW_MIN_DAYS,
  COMPANY_LIMITS,
  FACT_MAX,
  IMPORT_MAX_COLUMNS,
  IMPORT_MAX_ROWS,
  NOTE_MAX,
  SMART_MAX_ROWS,
  SMART_NOTE_MAX,
  SMART_STAGES,
  SOURCE_LABEL_MAX,
  BRIEF_SOURCES_MAX,
  TEMPLATE_LIMITS,
  DRAFT_NOTE_MAX,
  WORKSPACE_NAME_MAX,
  type BoardFilters,
  type StageName,
} from "@/lib/limits";

// The plain limits live in lib/limits.ts so client components can read them without loading zod.
// Re-exported here so server code keeps one place to import from.
export {
  AI_LIMIT_MAX,
  BOARD_QUERY_MAX,
  BRIEF_SOURCES_MAX,
  CLAIM_WINDOW_MAX_DAYS,
  CLAIM_WINDOW_MIN_DAYS,
  COMPANY_LIMITS,
  DRAFT_NOTE_MAX,
  FACT_MAX,
  IMPORT_FIELDS,
  IMPORT_MAX_BYTES,
  IMPORT_MAX_COLUMNS,
  IMPORT_MAX_ROWS,
  NOTE_MAX,
  SMART_MAX_ROWS,
  SMART_NOTE_MAX,
  SMART_STAGES,
  SOURCE_LABEL_MAX,
  STAGES,
  TEMPLATE_LIMITS,
  WORKSPACE_NAME_MAX,
  WORKSPACES_SHOWN,
  boardQuery,
} from "@/lib/limits";
export type { BoardFilters, ImportField, StageName } from "@/lib/limits";

// Postgres can't store a NUL character (U+0000) in text: the insert fails with an error page
// instead of a message. Every free-text field refuses it up front.
const NUL_MESSAGE = "This text has a character Coppice can't save.";
const hasNoNul = (v: string | null) => v === null || !v.includes("\0");

// Every server action parses its input with one of these before touching the database.

const workspaceName = z
  .string()
  .trim()
  .min(2, "Name must be at least 2 characters.")
  .max(WORKSPACE_NAME_MAX, `Keep the name to ${WORKSPACE_NAME_MAX} characters or fewer.`)
  .refine(hasNoNul, NUL_MESSAGE);

export const createWorkspaceSchema = z.object({ name: workspaceName });

// Our ids are 25 to 36 characters. The cap stops anyone sending megabytes into a lookup.
const id = z.string().min(1).max(64);
// An id a form may leave empty: "" or missing means none.
const optionalId = z.string().max(64).nullish().transform((v) => v || null);
const EMAIL_MESSAGE = "Enter a valid email address.";
// Trimmed and lowercased first, then checked for length, so " Sam@Purdue.edu " is accepted. 254
// characters is the longest a real email address can be. The format is checked by each user.
const emailText = z.string().trim().toLowerCase().max(254, EMAIL_MESSAGE);
const role = z.enum(["member", "owner"]);

export const inviteMemberSchema = z.object({
  workspaceId: id,
  email: emailText.pipe(z.email(EMAIL_MESSAGE)),
  role,
});

export const invitationIdSchema = id;

export const workspaceIdSchema = id;

// Settings > Workspace (owner): rename, and delete confirmed by typing the workspace's name.
export const renameWorkspaceSchema = z.object({ workspaceId: id, name: workspaceName });
export const deleteWorkspaceSchema = z.object({
  workspaceId: id,
  // Compared with the stored name in the action; capped so a huge paste is refused cheaply.
  confirmName: z.string().trim().max(200, "Type the workspace's name exactly.").min(1, "Type the workspace's name to delete it."),
});

// Where to go after signing in (?next=), from a link someone opened while signed out. Only a path
// on this site: it must start with one "/" (not "//", which is another site), have no backslash
// (browsers read "/\\evil.com" as "//evil.com"), no control characters, and not loop back to sign-in.
export const NEXT_PATH_MAX = 512;
export function safeNextPath(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > NEXT_PATH_MAX) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value, "http://coppice.invalid");
  } catch {
    return null;
  }
  if (url.origin !== "http://coppice.invalid") return null;
  if (url.pathname === "/signin" || url.pathname.startsWith("/api/") || url.pathname.startsWith("/oauth/")) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

export const cancelInvitationSchema = z.object({ workspaceId: id, invitationId: id });

export const memberSchema = z.object({ workspaceId: id, memberId: id });

export const changeRoleSchema = memberSchema.extend({ role });

export const claimWindowSchema = z.object({
  workspaceId: id,
  days: z.coerce
    .number({ error: "Enter a number of days." })
    .int("Use whole days.")
    .min(CLAIM_WINDOW_MIN_DAYS, `Use ${CLAIM_WINDOW_MIN_DAYS} to ${CLAIM_WINDOW_MAX_DAYS} days.`)
    .max(CLAIM_WINDOW_MAX_DAYS, `Use ${CLAIM_WINDOW_MIN_DAYS} to ${CLAIM_WINDOW_MAX_DAYS} days.`),
});

// AI settings (owner): the switch is a checkbox ("on" when ticked, missing when not), and the
// limit counts AI calls per 30 days across the workspace (AI_LIMIT_MAX in lib/limits).
export const aiSettingsSchema = z.object({
  workspaceId: id,
  enabled: z
    .string()
    .nullable()
    .transform((v) => v === "on"),
  limit: z.coerce
    .number({ error: "Enter a number." })
    .int("Use a whole number.")
    .min(0, `Use 0 to ${AI_LIMIT_MAX}.`)
    .max(AI_LIMIT_MAX, `Use 0 to ${AI_LIMIT_MAX}.`),
});

// The switch for outside AI assistants (MCP), owner only: a checkbox, "on" when ticked.
export const mcpSettingsSchema = z.object({
  workspaceId: id,
  enabled: z
    .string()
    .nullable()
    .transform((v) => v === "on"),
});

// Shape every server action returns (project convention).
export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

// ----- Companies and contacts -----

// A website is a bare domain ("acme.com") or an http(s) address. Anything with another scheme
// (javascript:, data:, mailto:, ftp://) is refused, so a stored website can never become a
// dangerous link. A port after a bare domain ("acme.com:8080") isn't mistaken for a scheme.
export function isWebAddress(value: string): boolean {
  if (/\s/.test(value)) return false;
  const scheme = /^([a-z][a-z0-9+.-]*):(?!\d)/i.exec(value)?.[1].toLowerCase();
  if (scheme && scheme !== "http" && scheme !== "https") return false;
  return domainKey(value) !== null;
}

// The link to render for a stored website, or null to show it as plain text.
export function websiteHref(website: string | null): string | null {
  if (!website || !isWebAddress(website)) return null;
  return /^https?:\/\//i.test(website) ? website : `https://${website}`;
}

// Optional text: trimmed, and an empty box is stored as null rather than "".
const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} can be at most ${max} characters.`)
    .refine(hasNoNul, NUL_MESSAGE)
    .nullable()
    .transform((v) => v || null);

export const companyFieldsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter a company name.")
    .max(COMPANY_LIMITS.name, `Name can be at most ${COMPANY_LIMITS.name} characters.`)
    .refine(hasNoNul, NUL_MESSAGE),
  industry: optionalText(COMPANY_LIMITS.industry, "Industry"),
  website: optionalText(COMPANY_LIMITS.website, "Website").refine((v) => v === null || isWebAddress(v), {
    message: "Enter a website like acme.com or https://acme.com.",
  }),
  notes: optionalText(COMPANY_LIMITS.notes, "Notes"),
});

// The ids of look-alikes the person said are separate, sent as one comma-separated value.
// More than 20 at once is never a real form.
const separateFrom = z
  .string()
  .nullable()
  .transform((v) => (v ? v.split(",") : []))
  .pipe(z.array(id).max(20, "Too many look-alikes to keep apart at once; save again."));

export const createCompanySchema = companyFieldsSchema.extend({ workspaceId: id, separateFrom });

// What the edit form showed when it loaded, compared exactly against the database, so it isn't
// trimmed. Only capped, since these are values we stored ourselves.
const originalText = z
  .string()
  .max(COMPANY_LIMITS.notes)
  .nullable()
  .transform((v) => v || null);

export const updateCompanySchema = z.object({
  workspaceId: id,
  companyId: id,
  separateFrom,
  changes: companyFieldsSchema,
  original: z.object({ name: z.string().max(COMPANY_LIMITS.notes), industry: originalText, website: originalText, notes: originalText }),
});

export const companyRefSchema = z.object({ workspaceId: id, companyId: id });

// stay=board keeps the person on the board after unarchiving; otherwise their page opens.
export const unarchiveSchema = companyRefSchema.extend({ stay: z.enum(["board"]).nullable() });

export const moveStageSchema = companyRefSchema.extend({ stage: z.enum(Stage) });

// Logging outreach. The follow-up is a calendar date ("2026-11-01"); lib/claims.ts
// checks it is from today to a year out, using the database's idea of "today".
export const logOutreachSchema = companyRefSchema.extend({
  channel: z.enum(Channel, "Pick how you reached out."),
  note: optionalText(NOTE_MAX, "Note"),
  followUpOn: z.iso.date("Pick a follow-up date."),
  // Set by "I sent it" under an AI draft; missing for a hand-logged outreach.
  aiDraftId: id.nullish(),
  // The template the email was based on, if one was picked ("" is "No template").
  templateId: optionalId,
  // The log form's key for this entry, so the same submit twice logs once (lib/claims.ts).
  clientKey: z.string().uuid().optional(),
});

// "Draft an email": what kind, to whom (optional), and an optional note on what to emphasize.
export const draftEmailSchema = companyRefSchema.extend({
  kind: z.enum(DraftKind, "Pick first email or follow-up."),
  contactId: optionalId,
  note: optionalText(DRAFT_NOTE_MAX, "Note"),
  // An optional template to base both drafts on.
  templateId: optionalId,
});

// "Check again" on an edited draft: the text as it is in the boxes now. Browsers send form text with
// CRLF line breaks while the page holds plain LF, so line breaks are normalized first; otherwise the
// stored check would never match the text on screen.
const lf = (v: string) => v.replace(/\r\n?/g, "\n");
export const checkDraftSchema = z.object({
  workspaceId: id,
  draftId: id,
  subject: z.string().transform(lf).pipe(z.string().max(300, "The subject is too long to check.")),
  // Not trimmed: the saved check must hold exactly the text on screen.
  body: z
    .string()
    .transform(lf)
    .pipe(z.string().max(6000, "The email is too long to check."))
    .refine((v) => v.trim() !== "", "Write the email first."),
});

// The board's "Possible duplicates" box: two companies, kept as separate or one archived.
export const duplicatePairSchema = companyRefSchema.extend({ otherId: id });
export const archiveDuplicateSchema = z.object({ workspaceId: id, keepId: id, archiveId: id });

// "Same company" while editing: archive this company (companyId) and keep the other one.
export const sameCompanySchema = companyRefSchema.extend({ keepId: id });

export const contactFieldsSchema = z.object({
  name: z.string().trim().min(1, "Enter the contact's name.").max(120, "Name can be at most 120 characters.").refine(hasNoNul, NUL_MESSAGE),
  email: emailText
    .nullable()
    .transform((v) => v || null)
    .pipe(z.email(EMAIL_MESSAGE).nullable()),
  title: optionalText(120, "Title"),
});

export const addContactSchema = contactFieldsSchema.extend(companyRefSchema.shape);
export const updateContactSchema = addContactSchema.extend({ contactId: id });
export const contactRefSchema = companyRefSchema.extend({ contactId: id });

// ----- Board filters (from the URL) -----

// The board's URL: ?q=acme&industry=Tech&show=COMMITTED&all=CONTACTED&archived=1. A URL can be
// typed or edited by hand, so anything malformed is dropped (`catch`) instead of failing the page.
// Search text that is too long (a pasted or shared link) is cut, not dropped: dropping it would show
// every company with an empty search box and no hint the search was lost.
const stageList = z
  .string()
  .transform((v) => v.split(","))
  .pipe(z.array(z.enum(Stage)));

export const boardFiltersSchema = z.object({
  q: z
    .string()
    .transform((v) => v.trim().slice(0, BOARD_QUERY_MAX).trim())
    .catch(""),
  industry: z
    .string()
    .transform((v) => v.trim().slice(0, COMPANY_LIMITS.industry).trim())
    .catch(""),
  // Committed and Declined start collapsed; these are the ones opened.
  show: stageList.catch([]),
  // One column showing every card instead of the first 50.
  all: z.enum(Stage).nullable().catch(null),
  archived: z
    .string()
    .nullable()
    .transform((v) => v === "1")
    .catch(false),
  // The "Possible duplicates" section is open.
  dupes: z
    .string()
    .nullable()
    .transform((v) => v === "1")
    .catch(false),
});

// BoardFilters and boardQuery live in lib/limits (the board's search box is a client component).
// These fail to compile if the schema, the Stage enum and lib/limits ever drift apart.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const STAGES_MATCH: Same<StageName, Stage> = true;
const BOARD_FILTERS_MATCH: Same<BoardFilters, z.infer<typeof boardFiltersSchema>> = true;
void STAGES_MATCH;
void BOARD_FILTERS_MATCH;

// ----- Queue filters (from the URL) -----

// The queue's URL: ?mine=1&never=1&all=due. Like the board, anything malformed is dropped.
const flag = z
  .string()
  .nullable()
  .transform((v) => v === "1")
  .catch(false);

export const queueFiltersSchema = z.object({
  // Only companies I hold with a live claim.
  mine: flag,
  // The "Never contacted" section is open.
  never: flag,
  // One section showing everything instead of the first 50.
  all: z.enum(["due", "never"]).nullable().catch(null),
  // How many rows each queue group loads: 50, 100, 150 or 200 ("Show 50 more"). Anything
  // else is dropped, so the page falls back to the first 50.
  upto: z
    .string()
    .nullish()
    .transform((v) => {
      const n = v && /^\d{2,3}$/.test(v) ? Number(v) : NaN;
      return n >= 50 && n <= 200 && n % 50 === 0 ? n : undefined;
    })
    .optional(),
});

export type QueueFilters = z.infer<typeof queueFiltersSchema>;

// The query string for a queue view: the inverse of queueFiltersSchema.
export function queueQuery(filters: QueueFilters): string {
  const params = new URLSearchParams();
  if (filters.mine) params.set("mine", "1");
  if (filters.never) params.set("never", "1");
  if (filters.all) params.set("all", filters.all);
  if (filters.upto) params.set("upto", String(filters.upto));
  const query = params.toString();
  return query ? `?${query}` : "";
}

// The queue's Fresh leads list, loaded 20 at a time when it is opened, up to 100.
export const freshLeadsSchema = z.object({
  workspaceId: workspaceIdSchema,
  offset: z.number().int().min(0).max(80),
});

// ----- CSV import -----

// IMPORT_MAX_ROWS, IMPORT_MAX_BYTES, IMPORT_MAX_COLUMNS and IMPORT_FIELDS: lib/limits.

// Which column (by position) fills each field; null leaves it empty. Name is required, and a
// column can only fill one field.
const column = z.number().int().min(0).max(IMPORT_MAX_COLUMNS - 1);
export const importMappingSchema = z
  .object({
    name: column,
    industry: column.nullable(),
    website: column.nullable(),
    notes: column.nullable(),
    contactName: column.nullable(),
    contactEmail: column.nullable(),
  })
  .refine((m) => {
    const used = Object.values(m).filter((c) => c !== null);
    return new Set(used).size === used.length;
  }, "Each column can only fill one field.");
export type ImportMapping = z.infer<typeof importMappingSchema>;

// A form field holding JSON, parsed and then checked against `schema`.
const json = <T extends z.ZodType>(schema: T, message: string) =>
  z
    .string()
    .transform((text, ctx) => {
      try {
        return JSON.parse(text) as unknown;
      } catch {
        ctx.addIssue({ code: "custom", message });
        return z.NEVER;
      }
    })
    .pipe(schema);

export const previewImportSchema = z.object({
  workspaceId: id,
  // Optional: on the first preview the server guesses the mapping from the headers.
  mapping: json(importMappingSchema, "Choose a column for each field.").nullable(),
});

// The import choices come from the preview page, never typed by hand, so anything wrong with them
// means a stale or tampered page: one message for all of it.
const REVIEW_AGAIN = "Review the duplicates again.";
export const runImportSchema = z.object({
  workspaceId: id,
  mapping: json(importMappingSchema, "Choose a column for each field."),
  // Spreadsheet row numbers the person chose to skip (row 1 is the header). Blank rows in a sheet
  // still count, so a row number can go a little past the row limit; lib/csv.ts checks each one
  // is a real row of this file.
  skip: json(
    z.array(z.number(REVIEW_AGAIN).int(REVIEW_AGAIN).min(2, REVIEW_AGAIN).max(100_000, REVIEW_AGAIN), REVIEW_AGAIN).max(IMPORT_MAX_ROWS, REVIEW_AGAIN),
    REVIEW_AGAIN,
  ),
  // Existing companies the preview showed as possible duplicates.
  seen: json(z.array(z.string(REVIEW_AGAIN).min(1, REVIEW_AGAIN).max(64, REVIEW_AGAIN), REVIEW_AGAIN).max(IMPORT_MAX_ROWS, REVIEW_AGAIN), REVIEW_AGAIN),
});

// ----- Fact sheet -----

export const factTextSchema = z
  .string()
  .trim()
  .min(1, "Write the fact.")
  .max(FACT_MAX, `A fact can be at most ${FACT_MAX} characters.`)
  .refine(hasNoNul, NUL_MESSAGE);
export const addFactSchema = z.object({ workspaceId: id, text: factTextSchema });
export const factRefSchema = z.object({ workspaceId: id, factId: id });
export const updateFactSchema = factRefSchema.extend({ text: factTextSchema });
export const verifyFactSchema = factRefSchema.extend({ verified: z.enum(["1", "0"]).transform((v) => v === "1") });
export const factSheetRefSchema = z.object({ workspaceId: id, factSheetId: id });

// ----- Templates and stats -----

// A template's name and body. Line breaks are normalized like a checked draft's, and the body may
// only use the three placeholders (lib/placeholders.ts).
export const templateFieldsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name the template.")
    .max(TEMPLATE_LIMITS.name, `A name can be at most ${TEMPLATE_LIMITS.name} characters.`)
    .refine(hasNoNul, NUL_MESSAGE),
  body: z
    .string()
    .transform(lf)
    .pipe(
      z
        .string()
        .trim()
        .min(1, "Write the template.")
        .max(TEMPLATE_LIMITS.body, `A template can be at most ${TEMPLATE_LIMITS.body} characters.`)
        .refine(hasNoNul, NUL_MESSAGE),
    )
    .superRefine((body, ctx) => {
      const problem = placeholderProblem(body);
      if (problem) ctx.addIssue({ code: "custom", message: problem });
    }),
});

export const createTemplateSchema = templateFieldsSchema.extend({ workspaceId: id });
export const templateRefSchema = z.object({ workspaceId: id, templateId: id });
export const updateTemplateSchema = templateFieldsSchema.extend({ workspaceId: id, templateId: id });

// "Which outreach got the reply?" after a stage move.
export const markReplySchema = companyRefSchema.extend({ outreachId: id });

// The stats page's URL: ?by=industry or ?by=touch splits each template's row. Anything else is dropped.
export const statsFiltersSchema = z.object({
  by: z.enum(["industry", "touch"]).nullable().catch(null),
});

// ----- Smart import -----

// SMART_MAX_ROWS, SMART_NOTE_MAX and SMART_STAGES: lib/limits.
const STALE = "This Smart import is out of date. Start it again.";

export const smartSuggestSchema = z.object({ workspaceId: id });

export const smartStartSchema = z.object({
  workspaceId: id,
  mapping: json(importMappingSchema, "Choose a column for each field."),
  // The columns whose cells hold free text (status, notes, history) for the AI to read.
  freeText: json(
    z
      .array(column)
      .min(1, "Choose at least one column for Smart import to read.")
      .max(20, "Choose at most 20 columns for Smart import to read.")
      .refine((c) => new Set(c).size === c.length, "Choose each column once."),
    "Choose the columns for Smart import to read.",
  ),
  // The board year the sheet is from, by the year it starts in (2025 is 2025-26).
  cycleStart: z.coerce.number("Choose the year the sheet is from.").int().min(2000).max(2100),
});

export const smartChunkSchema = z.object({
  workspaceId: id,
  sessionId: id,
  index: z.coerce.number(STALE).int(STALE).min(0, STALE).max(SMART_MAX_ROWS, STALE),
});

// What the person kept of the AI's reading for one row, after editing. Only the stages before an
// outcome: Smart import never sets Committed or Declined. lib/smart-import/commit.ts checks every field
// against what was actually proposed for that row.
const smartDecisionSchema = z.object({
  row: z.number(STALE).int(STALE).min(2, STALE).max(100_000, STALE),
  stage: z.enum(SMART_STAGES, STALE).nullable(),
  lastContactedOn: z.iso.date("Enter a last-contacted date like 2026-03-02.").nullable(),
  followUpOn: z.iso.date("Enter a follow-up date like 2026-08-01.").nullable(),
  contact: z.object({ name: contactFieldsSchema.shape.name, title: contactFieldsSchema.shape.title }).nullable(),
  note: optionalText(SMART_NOTE_MAX, "A note from the sheet"),
  // The row says not to contact the company, and the person chose to import it anyway.
  dncAccepted: z.boolean(STALE),
});
export type SmartDecision = z.infer<typeof smartDecisionSchema>;

export const smartImportSchema = runImportSchema.extend({
  sessionId: id,
  decisions: json(z.array(smartDecisionSchema).max(IMPORT_MAX_ROWS, STALE), STALE),
});
// ----- Research briefs -----

// An approved source: an http(s) page with no user:password, no IP address, no non-standard port,
// and not LinkedIn or a people-search site (lib/research/urls.ts). Stored as the parsed URL.
const sourceUrl = z.string().transform((value, ctx) => {
  const checked = parseSourceUrl(value);
  if (!checked.ok) {
    ctx.addIssue({ code: "custom", message: SKIP_MESSAGES[checked.reason] });
    return z.NEVER;
  }
  return checked.url.href;
});
export const addResearchSourceSchema = z.object({
  workspaceId: id,
  url: sourceUrl,
  label: optionalText(SOURCE_LABEL_MAX, "Label"),
});
export const researchSourceRefSchema = z.object({ workspaceId: id, sourceId: id });
export const renameResearchSourceSchema = researchSourceRefSchema.extend({
  label: z
    .string()
    .trim()
    .min(1, "Write a label.")
    .max(SOURCE_LABEL_MAX, `A label can be at most ${SOURCE_LABEL_MAX} characters.`)
    .refine(hasNoNul, NUL_MESSAGE),
});

// "Research who to contact": which approved sources to read for this company (checkboxes).
export const requestBriefSchema = companyRefSchema.extend({
  sourceIds: z
    .array(id)
    .transform((ids) => [...new Set(ids)])
    .pipe(z.array(id).min(1, "Pick at least one source.").max(BRIEF_SOURCES_MAX, `Pick at most ${BRIEF_SOURCES_MAX} sources.`)),
});
// "Add to notes" on one item of a brief.
export const acceptBriefItemSchema = companyRefSchema.extend({ briefId: id, itemId: z.string().min(1).max(40) });
// ----- MCP tools (outside AI assistants, lib/mcp) -----

// The arguments an assistant sends to each tool. The MCP SDK checks them against these before a
// tool runs, and also publishes them (as JSON Schema) so the assistant knows what to send. That's
// why they hold no transforms: the published schema has to describe the input as sent.
const mcpWorkspace = id.describe("The workspace's id, from list_workspaces.");
const mcpCompany = id.describe("The company's id, from list_companies or get_follow_up_queue.");

export const mcpWorkspaceSchema = z.object({ workspaceId: mcpWorkspace });

export const MCP_LIST_LIMIT = 50;
export const mcpListCompaniesSchema = z.object({
  workspaceId: mcpWorkspace,
  query: z.string().trim().max(100).optional().describe("Text to find in the company's name, website or industry. Leave out to list companies by name."),
  stage: z.enum(Stage).optional().describe("Only companies at this stage."),
});

export const mcpCompanySchema = z.object({ workspaceId: mcpWorkspace, companyId: mcpCompany });

export const mcpQueueSchema = z.object({
  workspaceId: mcpWorkspace,
  onlyMine: z.boolean().optional().describe("Only companies you hold."),
  includeNeverContacted: z.boolean().optional().describe("Also list fresh leads nobody has contacted yet."),
});

export const mcpLogOutreachSchema = z.object({
  workspaceId: mcpWorkspace,
  companyId: mcpCompany,
  channel: z.enum(Channel).describe("How you reached out."),
  note: z.string().trim().max(NOTE_MAX).optional().describe("A short note on what was said."),
  followUpOn: z.iso.date().describe("When to follow up, as YYYY-MM-DD: from today to a year out."),
});

export const mcpChangeStageSchema = z.object({
  workspaceId: mcpWorkspace,
  companyId: mcpCompany,
  stage: z.enum(Stage).describe("The stage to move the company to."),
  confirm: z
    .boolean()
    .optional()
    .describe("Required as true for COMMITTED or DECLINED, which end the pitch and release the claim. Ask the person first."),
});

// Settings > AI assistants: Disconnect one of your own assistants (lib/mcp/connections.ts). The
// client id comes from the row's hidden field; who it belongs to comes from the session, never the form.
export const disconnectAssistantSchema = z.object({ workspaceId: id, clientId: id });

// A space-separated scope list sent to the OAuth endpoints (authorize, consent, token). The plugin
// checks that each name is one it allows, but not how often a name appears, and it copies the list
// into every consent, code and token row. So a name may appear only once, and the list can't be
// longer than the scopes Coppice defines.
export const oauthScopeListSchema = z
  .string()
  // Single spaces only, matching how the OAuth plugin splits the list (it keeps empty entries).
  .regex(/^[\x21\x23-\x5B\x5D-\x7E]+( [\x21\x23-\x5B\x5D-\x7E]+)*$/, "Scopes are separated by single spaces.")
  .refine((scope) => {
    const names = scope.split(" ").filter(Boolean);
    return names.length <= MCP_SCOPES.length && new Set(names).size === names.length;
  }, "Each scope can be asked for once.");

// Onboarding (the basics and AI tours, app/(app)/[workspaceId]/onboarding-actions.ts). `step` is the
// index of the next unseen card; `event` says what happened: a card was passed ("step"), the last
// card was reached ("done"), or the AI tour was put off ("later").
export const tourProgressSchema = z.object({
  workspaceId: id,
  tour: z.enum(["basics", "ai"]),
  step: z.number().int().min(0).max(20),
  // "hide" and "show": the basics' Hide, and Resume from the pill.
  event: z.enum(["step", "done", "later", "hide", "show"]),
})
  .refine((v) => v.event !== "later" || v.tour === "ai", "Only the AI tour can be put off.")
  .refine((v) => (v.event !== "hide" && v.event !== "show") || v.tour === "basics", "Only the basics can be hidden.");

// ----- Follow-up dates (lib/claims.ts setFollowUp) -----

// A calendar date ("2026-11-21"); lib/claims.ts checks it is from today to a year out, by the
// database's idea of "today".
export const setFollowUpSchema = companyRefSchema.extend({ followUpOn: z.iso.date("Pick a follow-up date.") });

// ----- Ask Coppice (AI feature 6, lib/copilot) -----

export const COPILOT_QUESTION_MAX = 500;
// The four starter chips (lib/copilot/starters.ts). Each is a fixed intent and makes no AI call.
export const COPILOT_STARTERS = ["overdue", "plan", "claims", "how-claims-work"] as const;
export const COPILOT_VIEWS = ["companies", "company", "plan", "stats", "guide", "none"] as const;
export const COPILOT_ACTION_TYPES = ["CLAIM", "RELEASE", "LOG", "MOVE_STAGE", "SET_FOLLOW_UP"] as const;
export const COPILOT_DUE = ["overdue", "due_this_week", "no_date", "any"] as const;
export const COPILOT_CLAIMS = ["mine", "free", "held_by_others", "any"] as const;
export const COPILOT_SORTS = ["most_overdue", "name", "recently_contacted"] as const;

// What the model's intent says to look for among the companies. Also what a person's chip edit
// sends back. Strict-JSON friendly (every key present, nullable not optional), and long text is cut
// rather than refused (lib/ai/schema.ts clamped), so a wordy reply never costs the call. No
// descriptions: the rules are in the prompt (lib/copilot/prompt.ts), and a schema's text is sent too.
export const copilotFilterSchema = z.object({
  stages: z.array(z.enum(Stage)),
  industry: clamped(80).nullable(),
  due: z.enum(COPILOT_DUE),
  claim: z.enum(COPILOT_CLAIMS),
  neverContacted: z.boolean(),
  nameOrSite: clamped(100).nullable(),
  notesMention: clamped(100).nullable(),
  sort: z.enum(COPILOT_SORTS),
});
export type CopilotFilter = z.infer<typeof copilotFilterSchema>;

export const copilotActionSchema = z.object({
  type: z.enum(COPILOT_ACTION_TYPES),
  companyIds: z.array(clamped(64)),
  stage: z.enum(Stage).nullable(),
  followUpOn: clamped(12).nullable(),
});

// The one JSON answer the model gives per question (sent to Groq as a strict schema). Code checks
// every part of it afterwards (lib/copilot/intent.ts); none of it is shown or run as it arrives.
export const copilotIntentSchema = z.object({
  view: z.enum(COPILOT_VIEWS),
  reply: clamped(240),
  filter: copilotFilterSchema.nullable(),
  company: z.object({ id: clamped(64).nullable(), name: clamped(120).nullable() }).nullable(),
  // An integer: Zod writes a nullable plain number as a type list, but a nullable integer as anyOf, the
  // form Smart import's strict schema was proven live with.
  minutes: z.number().int().nullable(),
  guideTopics: z.array(clamped(40)),
  actions: z.array(copilotActionSchema),
});
export type CopilotIntent = z.infer<typeof copilotIntentSchema>;

const copilotQuestion = z
  .string()
  .trim()
  .min(1, "Ask a question.")
  .max(COPILOT_QUESTION_MAX, `A question can be at most ${COPILOT_QUESTION_MAX} characters.`)
  .refine(hasNoNul, NUL_MESSAGE);

// threadId null starts a new conversation.
export const askCopilotSchema = z.object({ workspaceId: id, threadId: id.nullable(), question: copilotQuestion });
export const copilotStarterSchema = z.object({ workspaceId: id, threadId: id.nullable(), starter: z.enum(COPILOT_STARTERS) });
// "Show again", and a chip edit when `filter` is sent.
export const rerunTurnSchema = z.object({ workspaceId: id, turnId: id, filter: copilotFilterSchema.nullable() });
export const openThreadSchema = z.object({ workspaceId: id, threadId: id.nullable() });
// A next-move chip: the card for one action on one company, checked against the company as it is now.
export const copilotMoveSchema = z.object({
  workspaceId: id,
  companyId: id,
  type: z.enum(COPILOT_ACTION_TYPES),
  stage: z.enum(Stage).nullable(),
  followUpOn: z.iso.date("Pick a follow-up date.").nullable(),
});
// ----- Scorecard explanation and the Template Lab (AI feature 7) -----

// What the model sends back for "Explain these numbers": up to three paragraphs, each a list of
// segments. A segment is either words (`text`) or one fact key (`fact`), never both and never
// neither; lib/scorecard/explain.ts checks that, and everything else, in code.
export const SCORECARD_MAX_PARAGRAPHS = 3;
export const SCORECARD_MAX_SEGMENTS = 14;
export const SCORECARD_TEXT_MAX = 900;
export const scorecardReplySchema = z.object({
  paragraphs: z
    .array(
      z.object({
        segments: z
          .array(
            z.object({
              text: z.string().nullable().describe("Plain words with no numbers in them, or null when this segment is a fact"),
              fact: z.string().nullable().describe("The key of one fact from the list, or null when this segment is words"),
            }),
          )
          .min(1)
          .max(SCORECARD_MAX_SEGMENTS),
      }),
    )
    .min(1)
    .max(SCORECARD_MAX_PARAGRAPHS),
});
export type ScorecardReply = z.output<typeof scorecardReplySchema>;

// The Template Lab's variants. A variant over its limits is dropped on its own (a summary is cut
// to fit) instead of losing the whole reply; code checks each one that is left (lib/template-lab/check.ts).
export const VARIANT_KINDS = ["opening", "ask", "closing", "shorter"] as const;
export type VariantKind = (typeof VARIANT_KINDS)[number];
export const LAB_SUMMARY_MAX = 140;
export const LAB_MAX_VARIANTS = 3;
export const labVariantSchema = z.object({
  kind: z.enum(VARIANT_KINDS).describe("What this variant changes: opening, ask, closing or shorter"),
  summary: clamped(LAB_SUMMARY_MAX).describe(`What changed and why it might help, at most ${LAB_SUMMARY_MAX} characters`),
  body: z.string().min(1).max(TEMPLATE_LIMITS.body).describe("The whole template text with exactly one change, plain text"),
});
export const labReplySchema = z.object({ variants: keptItems(labVariantSchema, LAB_MAX_VARIANTS).min(1).describe("2 or 3 variants") });
export type LabReply = z.output<typeof labReplySchema>;

// The stats page's server actions. A variant the owner picked comes back from the browser, so
// startExperiment checks it again against the template as it is now (lib/template-lab/lab.ts).
export const explainStatsSchema = z.object({ workspaceId: id });
export const proposeVariantsSchema = z.object({ workspaceId: id, templateId: id });
export const startExperimentSchema = z.object({
  workspaceId: id,
  templateId: id,
  variants: json(
    z
      .array(
        z.object({
          kind: z.enum(VARIANT_KINDS),
          summary: z.string().max(LAB_SUMMARY_MAX),
          body: z.string().min(1).max(TEMPLATE_LIMITS.body).refine(hasNoNul, NUL_MESSAGE),
        }),
      )
      .min(1)
      .max(2),
    "Pick one or two variants to try.",
  ),
});
export const endExperimentSchema = z.object({ workspaceId: id, experimentId: id, keepTemplateId: id });

// Kept down here, with the schemas that use it, so this round touches no line above (move it up when merging).
// ----- Time Capsule (lib/capsule/, app/(app)/[workspaceId]/capsule/actions.ts) -----

const CAPSULE_STALE = "This handoff is out of date. Reload the page.";
// The year a board year starts in (2026 is 2026-27). lib/capsule checks it is not in the future.
const capsuleYear = z.coerce.number("Choose a board year.").int("Choose a board year.").min(2000, "Choose a board year.").max(2100, "Choose a board year.");
const yesNo = z.enum(["1", "0"]).transform((v) => v === "1");

export const capsuleYearSchema = z.object({ workspaceId: id, boardYearStart: capsuleYear });
// Who is leaving: "1" marks the member, "0" clears the mark.
export const departingSchema = z.object({ workspaceId: id, userId: id, departing: yesNo });
export const startHandoffSchema = capsuleYearSchema;
export const handoffRefSchema = z.object({ workspaceId: id, reportId: id });
// One call of the browser-driven reading: at most 15 chunks in a report.
export const handoffChunkSchema = handoffRefSchema.extend({
  index: z.coerce.number(CAPSULE_STALE).int(CAPSULE_STALE).min(0, CAPSULE_STALE).max(CARD_MAX_CALLS - 1, CAPSULE_STALE),
});
export const cardRefSchema = z.object({ workspaceId: id, cardId: id });
// Hide or show a bullet (its index) or the whole card (no index).
export const hideCardSchema = cardRefSchema.extend({
  bulletIndex: z
    .string()
    .regex(/^(\d{1,2})?$/, CAPSULE_STALE)
    .nullable()
    .transform((v) => (v === null || v === "" ? null : Number(v))),
  hidden: yesNo,
});
// The owner's re-contact dates for approved cards: a date for each company, or null for blank.
export const recontactDatesSchema = handoffRefSchema.extend({
  dates: json(
    z
      .array(z.object({ companyId: id, date: z.iso.date("Enter a date like 2026-08-01.").nullable() }))
      .min(1, CAPSULE_STALE)
      .max(2000, CAPSULE_STALE),
    CAPSULE_STALE,
  ),
});
export const fillBlankDatesSchema = handoffRefSchema.extend({ date: z.iso.date("Enter a date like 2026-08-01.") });
// A question for Ask the Archive: text a person typed, so it is trimmed and bounded.
export const askArchiveSchema = z.object({
  workspaceId: id,
  question: z
    .string()
    .trim()
    .min(ARCHIVE_QUESTION_MIN, `Ask a question of at least ${ARCHIVE_QUESTION_MIN} letters.`)
    .max(ARCHIVE_QUESTION_MAX, `Keep the question to ${ARCHIVE_QUESTION_MAX} characters or fewer.`)
    .refine(hasNoNul, NUL_MESSAGE),
});

// The Time Capsule page's URL: ?year=2025 picks the board year that starts in July of that year.
// Anything else is dropped, and the page opens on a year it can show.
export const capsulePageSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2200).nullable().catch(null),
});
