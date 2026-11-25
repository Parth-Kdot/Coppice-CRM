import { z } from "zod";
import { Channel, DraftKind, Stage } from "@/generated/prisma/enums";
import { clamped, keptItems } from "@/lib/ai/schema";
import { domainKey } from "@/lib/duplicates";
import { placeholderProblem } from "@/lib/placeholders";
import { parseSourceUrl, SKIP_MESSAGES, SOURCE_URL_MAX } from "@/lib/research/urls";
import { MCP_SCOPES } from "@/lib/mcp/config";
import { ARCHIVE_QUESTION_MAX, ARCHIVE_QUESTION_MIN, BULLETS_PER_CARD, CARD_MAX_CALLS } from "@/lib/capsule/limits";
import {
  AI_LIMIT_MAX,
  BOARD_QUERY_MAX,
  CLAIM_WINDOW_MAX_DAYS,
  CLAIM_WINDOW_MIN_DAYS,
  COMPANY_LIMITS,
  CONTACT_LIMITS,
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
  CONTACT_LIMITS,
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
// For text an assistant sends. JSON can carry a lone UTF-16 surrogate (\ud800), which Postgres
// quietly stores as U+FFFD, so that text is refused too instead of being saved changed.
const hasStorableText = (v: string | null) => hasNoNul(v) && (v === null || v.isWellFormed());

// Every server action parses its input with one of these before touching the database.

const workspaceName = z
  .string()
  .trim()
  .min(2, "Name must be at least 2 characters.")
  .max(WORKSPACE_NAME_MAX, `Keep the name to ${WORKSPACE_NAME_MAX} characters or fewer.`)
  .refine(hasNoNul, NUL_MESSAGE);

export const createWorkspaceSchema = z.object({ name: workspaceName });

// Our ids are 25 to 36 characters. The cap stops anyone sending megabytes into a lookup.
const id = z.string().min(1).max(64).refine(hasStorableText, NUL_MESSAGE);
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

// Plain LF line breaks. Browsers send form text with CRLF, while "Add to notes" and the assistant
// tools write LF, so text is compared and stored with LF only.
export const lf = (v: string) => v.replace(/\r\n?/g, "\n");

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
  notes: optionalText(COMPANY_LIMITS.notes, "Notes").transform((v) => (v === null ? null : lf(v))),
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
  .transform((v) => (v ? lf(v) : null));

export const updateCompanySchema = z.object({
  workspaceId: id,
  companyId: id,
  separateFrom,
  changes: companyFieldsSchema,
  original: z.object({ name: z.string().max(COMPANY_LIMITS.notes), industry: originalText, website: originalText, notes: originalText }),
});

export const companyRefSchema = z.object({ workspaceId: id, companyId: id });

// "Restore" under a previous version on the company page: which one, and a digest of the value the
// page showed as current (lib/previous-versions.ts valueDigest), so a change since it loaded is caught.
// field and contactId (empty for a company field) name the field the row was for, so a refusal can
// say the field was changed again when the row's own id is gone.
export const restoreVersionSchema = companyRefSchema.extend({
  versionId: id,
  expected: z.string().regex(/^[0-9a-f]{64}$/),
  field: z.enum(["NAME", "INDUSTRY", "WEBSITE", "NOTES", "EMAIL", "TITLE"]),
  contactId: optionalId,
});

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
  name: z.string().trim().min(1, "Enter the contact's name.").max(CONTACT_LIMITS.name, `Name can be at most ${CONTACT_LIMITS.name} characters.`).refine(hasNoNul, NUL_MESSAGE),
  email: emailText
    .nullable()
    .transform((v) => v || null)
    .pipe(z.email(EMAIL_MESSAGE).nullable()),
  title: optionalText(CONTACT_LIMITS.title, "Title"),
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
// Each column fills at most one field. Shared with the MCP import tools, whose schema describes each field.
const eachColumnOnce = (m: Record<string, number | null>) => {
  const used = Object.values(m).filter((c) => c !== null);
  return new Set(used).size === used.length;
};
const EACH_COLUMN_ONCE = "Each column can only fill one field.";
export const importMappingSchema = z
  .object({
    name: column,
    industry: column.nullable(),
    website: column.nullable(),
    notes: column.nullable(),
    contactName: column.nullable(),
    contactEmail: column.nullable(),
  })
  .refine(eachColumnOnce, EACH_COLUMN_ONCE);
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
// why they hold no transforms: the published schema has to describe the input as sent. Trimming
// and the app's own form rules happen inside the tool, through the same schemas the app's forms use.
//
// Rules for every schema here: each string has a cap, each field a .describe(), free text goes
// through mcpText (the NUL check is a refine, which the published schema ignores), enums come from
// the Prisma enums, dates are z.iso.date() and flags are strict booleans.
const mcpWorkspace = id.describe("The workspace's id, from list_workspaces.");
const mcpCompany = id.describe("The company's id, from list_companies or get_follow_up_queue.");

// Free text from an assistant: capped, and without the NUL character Postgres can't store.
export const mcpText = (max: number, description: string) => z.string().max(max).refine(hasStorableText, NUL_MESSAGE).describe(description);
// An id from another tool's answer, with the name of the tool it comes from.
export const mcpId = (description: string) => id.describe(description);
// Asked for as true after the person agrees, for anything that deletes or can't be undone.
export const mcpConfirm = (description: string) => z.boolean().optional().describe(description);
// The "more" cursor a list answer gives back. Opaque to the assistant; the tool decodes it.
export const MCP_CURSOR_MAX = 200;
export const mcpCursor = z.string().max(MCP_CURSOR_MAX).optional().describe("The cursor from the previous answer's more field, to get the next page. Leave out for the first page.");

export const mcpWorkspaceSchema = z.object({ workspaceId: mcpWorkspace });

export const MCP_LIST_LIMIT = 50;
export const MCP_COMPANY_STATUS = ["active", "archived", "all"] as const;
export const MCP_COMPANY_CLAIMS = ["mine", "free", "others"] as const;
export const MCP_COMPANY_FOLLOW_UPS = ["overdue", "due_this_week", "none"] as const;
export const MCP_COMPANY_SORTS = ["name", "follow_up", "last_contact", "created"] as const;
export const mcpListCompaniesSchema = z.object({
  workspaceId: mcpWorkspace,
  query: z
    .string()
    .trim()
    .max(100)
    .refine(hasStorableText, NUL_MESSAGE)
    .optional()
    .describe("Text to find in the company's name, website or industry. Leave out to list companies by name."),
  stage: z.enum(Stage).optional().describe("Only companies at this stage."),
  stages: z.array(z.enum(Stage)).max(Object.keys(Stage).length).optional().describe("Only companies at any of these stages. Combined with stage when both are given."),
  status: z.enum(MCP_COMPANY_STATUS).optional().describe("active (the default), archived or all."),
  claim: z.enum(MCP_COMPANY_CLAIMS).optional().describe("mine: you hold it. free: nobody holds it. others: someone else holds it."),
  followUp: z.enum(MCP_COMPANY_FOLLOW_UPS).optional().describe("overdue (due today or earlier), due_this_week (the next 7 days) or none (no follow-up date)."),
  neverContacted: z.boolean().optional().describe("Only companies nobody has logged outreach for."),
  notesMention: mcpText(100, "Only companies whose notes or outreach notes mention this text.").optional(),
  industry: mcpText(80, "Only companies in this industry (exact match, any case).").optional(),
  sort: z.enum(MCP_COMPANY_SORTS).optional().describe("name (the default), follow_up (soonest first), last_contact (latest first) or created (newest first)."),
  cursor: mcpCursor,
});

export const mcpCompanySchema = z.object({ workspaceId: mcpWorkspace, companyId: mcpCompany });

export const mcpQueueSchema = z.object({
  workspaceId: mcpWorkspace,
  onlyMine: z.boolean().optional().describe("Only companies you hold."),
  includeNeverContacted: z.boolean().optional().describe("Also list fresh leads nobody has contacted yet."),
  cursor: mcpCursor,
});

export const mcpListMyClaimsSchema = z.object({ workspaceId: mcpWorkspace, cursor: mcpCursor });
export const mcpListMembersSchema = z.object({ workspaceId: mcpWorkspace, cursor: mcpCursor });

export const mcpLogOutreachSchema = z.object({
  workspaceId: mcpWorkspace,
  companyId: mcpCompany,
  channel: z.enum(Channel).describe("How you reached out."),
  note: z.string().trim().max(NOTE_MAX).refine(hasStorableText, NUL_MESSAGE).optional().describe("A short note on what was said."),
  followUpOn: z.iso.date().describe("When to follow up, as YYYY-MM-DD: from today to a year out."),
  clientKey: z
    .uuid()
    .optional()
    .describe("A new random UUID for this entry. Send the same one when you retry, so a retry after a timeout logs once."),
  templateId: id.optional().describe("The template the message was based on, from list_templates. It must be active."),
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

// ----- Group C, the rest: duplicates, creating and editing companies, archive, claims, replies -----

export const mcpListDuplicatePairsSchema = z.object({ workspaceId: mcpWorkspace, cursor: mcpCursor });

const mcpSeparateFrom = z
  .array(mcpId("A look-alike's id, from the answer of this tool's last call."))
  .max(20)
  .optional()
  .describe("Look-alikes the person said are different companies, by id from the last answer. Send only after the person agrees.");

export const mcpCreateCompanySchema = z.object({
  workspaceId: mcpWorkspace,
  name: mcpText(COMPANY_LIMITS.name, "The company's name."),
  industry: mcpText(COMPANY_LIMITS.industry, "Its industry. Leave out if unknown.").optional(),
  website: mcpText(COMPANY_LIMITS.website, "Its website, like acme.com or https://acme.com. Leave out if unknown.").optional(),
  notes: mcpText(COMPANY_LIMITS.notes, "Notes about the company. Leave out if there are none.").optional(),
  separateFrom: mcpSeparateFrom,
});

// A text field of an edit: a string, or null to clear industry, website or notes.
const mcpClearable = (max: number, description: string) => z.string().max(max).refine(hasStorableText, NUL_MESSAGE).nullable().optional().describe(description);
export const mcpUpdateCompanySchema = z.object({
  workspaceId: mcpWorkspace,
  companyId: mcpCompany,
  changes: z
    .object({
      name: mcpText(COMPANY_LIMITS.name, "The new name.").optional(),
      industry: mcpClearable(COMPANY_LIMITS.industry, "The new industry, or null to clear it."),
      website: mcpClearable(COMPANY_LIMITS.website, "The new website, or null to clear it."),
      notes: mcpClearable(COMPANY_LIMITS.notes, "The new notes in full, or null to clear them. This replaces the old notes."),
    })
    .describe("Only the fields the person asked to change."),
  original: z
    .object({
      name: mcpClearable(COMPANY_LIMITS.notes, "The name as get_company returned it, unchanged."),
      industry: mcpClearable(COMPANY_LIMITS.notes, "The industry as get_company returned it, null if it had none."),
      website: mcpClearable(COMPANY_LIMITS.notes, "The website as get_company returned it, null if it had none."),
      notes: mcpClearable(COMPANY_LIMITS.notes, "The notes as get_company returned them, null if there were none."),
    })
    .describe("The current value of every field in changes, exactly as get_company returned it. If someone changed it since, nothing is saved."),
  separateFrom: mcpSeparateFrom,
});

export const mcpRestorePreviousVersionSchema = z.object({
  workspaceId: mcpWorkspace,
  companyId: mcpCompany,
  versionId: mcpId("The previous version's id, from previousVersions in get_company."),
  field: z
    .enum(["name", "industry", "website", "notes", "email", "title"])
    .optional()
    .describe("The version's field, from previousVersions in get_company. Send it with contactId, so a field that was changed again is reported as changed."),
  contactId: z.string().max(64).nullable().optional().describe("The version's contactId from previousVersions in get_company, null for a company field."),
  current: z
    .string()
    .max(COMPANY_LIMITS.notes)
    .refine(hasStorableText, NUL_MESSAGE)
    .nullable()
    .describe("The field's value now, exactly as get_company returned it, or null if it is empty. If it changed since, nothing is restored."),
  separateFrom: mcpSeparateFrom,
});

export const mcpSetCompanyArchivedSchema = z.object({
  workspaceId: mcpWorkspace,
  companyId: mcpCompany,
  archived: z.boolean().describe("true to archive the company, false to bring it back."),
});

export const MCP_DUPLICATE_DECISIONS = ["same", "separate"] as const;
export const mcpResolveDuplicateSchema = z.object({
  workspaceId: mcpWorkspace,
  decision: z.enum(MCP_DUPLICATE_DECISIONS).describe("same: they are one company, so one is archived. separate: they are different companies."),
  companyId: mcpCompany,
  otherId: mcpId("The other company of the pair, from list_duplicate_pairs."),
  keepId: mcpId("For same: the company to keep, companyId or otherId. The other one is archived.").optional(),
});

export const mcpReleaseClaimSchema = z.object({
  workspaceId: mcpWorkspace,
  companyId: mcpCompany,
  force: z.boolean().optional().describe("Owners only: release someone else's claim. Needs confirm."),
  confirm: mcpConfirm("Required as true with force, after the person agrees."),
});

export const mcpMarkReplySchema = z.object({
  workspaceId: mcpWorkspace,
  companyId: mcpCompany,
  outreachId: mcpId("The outreach entry that got the reply, from get_company."),
});

export const mcpSetFollowUpSchema = z.object({
  workspaceId: mcpWorkspace,
  companyId: mcpCompany,
  followUpOn: z.iso.date().describe("The next follow-up date as YYYY-MM-DD: from today to a year out."),
});

// ----- Group P, contacts -----

export const mcpSaveContactSchema = z.object({
  workspaceId: mcpWorkspace,
  companyId: mcpCompany,
  contactId: mcpId("The contact to change, from get_company. Leave out to add a new contact.").optional(),
  name: mcpText(CONTACT_LIMITS.name, "The contact's name. Required for a new contact; left out on a change it stays as it is.").optional(),
  email: mcpText(254, "Their email address. On a change, leave out to keep it or send an empty string to clear it.").optional(),
  title: mcpText(CONTACT_LIMITS.title, "Their job title. On a change, leave out to keep it or send an empty string to clear it.").optional(),
});

export const MCP_DELETE_KINDS = ["contact", "fact", "fact_sheet"] as const;
export const mcpDeletePermanentlySchema = z.object({
  workspaceId: mcpWorkspace,
  what: z.enum(MCP_DELETE_KINDS).describe("contact (any member), fact or fact_sheet (an uploaded packet with its facts; owners only)."),
  id: mcpId("The contact's id from get_company, the fact's id or the file's id from list_facts."),
  confirm: mcpConfirm("Required as true, after the person agrees. This cannot be undone."),
});

// ----- Group K, knowledge: facts, templates, emails, research sources, brief items -----

export const mcpListFactsSchema = z.object({ workspaceId: mcpWorkspace, cursor: mcpCursor });

export const mcpSaveFactSchema = z.object({
  workspaceId: mcpWorkspace,
  factId: mcpId("The fact to change, from list_facts. Leave out to add a new fact.").optional(),
  text: mcpText(FACT_MAX, "The fact as one short sentence about the organization. No email addresses or phone numbers."),
});

export const mcpSetFactVerifiedSchema = z.object({
  workspaceId: mcpWorkspace,
  factId: mcpId("The fact's id, from list_facts."),
  verified: z.boolean().describe("true to verify the fact, false to take the verified mark off."),
  confirm: mcpConfirm("Required as true to verify, after the person agrees. Verified facts can reach sponsors."),
});

export const mcpListTemplatesSchema = z.object({ workspaceId: mcpWorkspace, cursor: mcpCursor });

export const mcpSaveTemplateSchema = z.object({
  workspaceId: mcpWorkspace,
  templateId: mcpId("The template to change, from list_templates. Leave out to add a new template.").optional(),
  name: mcpText(TEMPLATE_LIMITS.name, "The template's name. It must be unique in the workspace."),
  body: mcpText(TEMPLATE_LIMITS.body, "The email text. It may only use the placeholders {{firstName}}, {{senderName}} and {{orgName}}."),
});

export const mcpSetTemplateArchivedSchema = z.object({
  workspaceId: mcpWorkspace,
  templateId: mcpId("The template's id, from list_templates."),
  archived: z.boolean().describe("true to archive the template, false to bring it back."),
});

export const mcpPrepareEmailSchema = z.object({
  workspaceId: mcpWorkspace,
  companyId: mcpCompany,
  templateId: mcpId("An active template to fill in, from list_templates. Send this or text, not both.").optional(),
  contactId: mcpId("The contact to greet, from get_company. Must belong to this company.").optional(),
  text: mcpText(TEMPLATE_LIMITS.body, "Your own email text to check instead of a template. It may use {{firstName}}, {{senderName}} and {{orgName}}.").optional(),
});

export const mcpSaveResearchSourceSchema = z.object({
  workspaceId: mcpWorkspace,
  sourceId: mcpId("The source to rename, from list_research_sources. Leave out to add a new source.").optional(),
  url: mcpText(SOURCE_URL_MAX, "The page's address for a new source, like https://acme.com/careers. A source's address cannot be changed.").optional(),
  label: mcpText(SOURCE_LABEL_MAX, "The source's label. Required to rename; optional for a new source.").optional(),
});

export const mcpSetResearchSourceArchivedSchema = z.object({
  workspaceId: mcpWorkspace,
  sourceId: mcpId("The source's id, from list_research_sources."),
  archived: z.literal(true).describe("Always true. A source cannot be brought back; add its address again instead."),
});

export const mcpAcceptBriefItemSchema = z.object({
  workspaceId: mcpWorkspace,
  companyId: mcpCompany,
  briefId: mcpId("The brief's id, from get_company."),
  itemId: mcpText(40, "The brief item's id, or a team inbox's id, from get_company."),
});

// Settings > AI assistants: Disconnect one of your own assistants (lib/mcp/connections.ts). The
// client id comes from the row's hidden field; who it belongs to comes from the session, never the form.
// A client id from a Client ID Metadata Document is a URL (up to 512 characters, the same cap the
// fetch policy puts on it), not a short generated id, so it gets its own cap.
const oauthClientId = z.string().min(1).max(512);
export const disconnectAssistantSchema = z.object({ workspaceId: id, clientId: oauthClientId });

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
// retryOf: the failed turn this question asks again, which the new answer replaces.
export const askCopilotSchema = z.object({ workspaceId: id, threadId: id.nullable(), question: copilotQuestion, retryOf: id.nullable() });
export const copilotStarterSchema = z.object({ workspaceId: id, threadId: id.nullable(), starter: z.enum(COPILOT_STARTERS) });
// "Show again", and a chip edit when `filter` is sent.
export const rerunTurnSchema = z.object({ workspaceId: id, turnId: id, filter: copilotFilterSchema.nullable() });
export const openThreadSchema = z.object({ workspaceId: id, threadId: id.nullable() });
// Taking one chip off a list: the filter as the screen shows it and the field to put back to its default.
export const COPILOT_FILTER_KEYS = ["stages", "industry", "due", "claim", "neverContacted", "nameOrSite", "notesMention", "sort"] as const;
export const copilotChipSchema = z.object({ workspaceId: id, turnId: id, filter: copilotFilterSchema, remove: z.enum(COPILOT_FILTER_KEYS) });
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
// The Monday brief's reply (lib/weekly-brief): the same shape, checked by the same code.
export const weeklyBriefReplySchema = scorecardReplySchema;

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

// ----- MCP tools, continued: stats, the handoff and import -----
// These come after the Template Lab and Time Capsule schemas above, whose limits they reuse.

// ----- Group S, stats and the Template Lab -----

export const MCP_STATS_SPLITS = ["industry", "touch"] as const;
export const mcpGetStatsSchema = z.object({
  workspaceId: mcpWorkspace,
  by: z.enum(MCP_STATS_SPLITS).optional().describe("Also split each template's numbers by industry or by touch number. Leave out for the plain table."),
});

const mcpVariantSchema = z.object({
  kind: z.enum(VARIANT_KINDS).describe("What the variant changes: opening, ask, closing or shorter."),
  summary: mcpText(LAB_SUMMARY_MAX, `What changed and why it might help, at most ${LAB_SUMMARY_MAX} characters.`),
  body: mcpText(TEMPLATE_LIMITS.body, "The whole template text with exactly one change. Plain text, no email addresses or phone numbers."),
});
export const mcpStartExperimentSchema = z.object({
  workspaceId: mcpWorkspace,
  templateId: mcpId("The active template to test, from list_templates. It becomes version A."),
  variants: z.array(mcpVariantSchema).min(1).max(2).describe("One or two variants you wrote, each the template with one change."),
  confirm: mcpConfirm("Required as true, after the person agrees. The variants become templates the whole team sees."),
});
export const mcpEndExperimentSchema = z.object({
  workspaceId: mcpWorkspace,
  experimentId: mcpId("The running experiment's id, from get_stats."),
  keepTemplateId: mcpId("The template to keep, one of the experiment's templates from get_stats. The others are archived."),
  confirm: mcpConfirm("Required as true, after the person agrees. An experiment cannot be restarted."),
});

// ----- Group H, the year-end handoff -----

const mcpReport = mcpId("The handoff's id, from get_handoff or start_handoff.");
const mcpBoardYear = z.number().int().min(2000).max(2100);
const mcpBoardYearField = mcpBoardYear.optional().describe("The year a board year starts in, such as 2026 for 2026-27. Leave out for the current board year.");
export const MCP_RECONTACT_DATES_MAX = 200;
export const MCP_CARD_BULLET_MAX = BULLETS_PER_CARD - 1;

export const mcpGetHandoffSchema = z.object({ workspaceId: mcpWorkspace, boardYearStart: mcpBoardYearField, cursor: mcpCursor });
export const mcpSetDepartingSchema = z.object({
  workspaceId: mcpWorkspace,
  userId: mcpId("The member's user id, from list_members (owners get it)."),
  departing: z.boolean().describe("true to mark the member as leaving next year's board, false to clear the mark. Nobody loses access."),
});
export const mcpReleaseDepartingClaimsSchema = z.object({
  workspaceId: mcpWorkspace,
  confirm: mcpConfirm("Required as true, after the person agrees. It gives back every claim held by members marked as leaving."),
});
export const mcpStartHandoffSchema = z.object({ workspaceId: mcpWorkspace, boardYearStart: mcpBoardYearField });
export const mcpBuildHandoffCardsSchema = z.object({
  workspaceId: mcpWorkspace,
  reportId: mcpReport,
  confirm: mcpConfirm("Required as true while AI is on for the workspace, after the person agrees."),
});
export const mcpReviewHandoffCardSchema = z.object({
  workspaceId: mcpWorkspace,
  cardId: mcpId("The card's id, from get_handoff."),
  bulletIndex: z.number().int().min(0).max(MCP_CARD_BULLET_MAX).optional().describe("Which bullet of the card (its index from get_handoff). Leave out for the whole card."),
  hidden: z.boolean().optional().describe("true to hide it from officers, false to show it again. Applied before approve."),
  approve: z.literal(true).optional().describe("true to approve the card so officers see it once the handoff is published. A hidden card cannot be approved."),
});
export const mcpApproveRemainingCardsSchema = z.object({
  workspaceId: mcpWorkspace,
  reportId: mcpReport,
  confirm: mcpConfirm("Required as true, after the person agrees. It approves every card that is not hidden without a card-by-card review."),
});
export const mcpSaveRecontactDatesSchema = z.object({
  workspaceId: mcpWorkspace,
  reportId: mcpReport,
  dates: z
    .array(
      z.object({
        companyId: mcpCompany,
        date: z.iso.date().nullable().describe("The re-contact date as YYYY-MM-DD, from today to a year out, or null to blank it."),
      }),
    )
    .min(1)
    .max(MCP_RECONTACT_DATES_MAX)
    .describe(`Dates for companies with an approved card, at most ${MCP_RECONTACT_DATES_MAX}.`),
});
export const mcpFillBlankDatesSchema = z.object({
  workspaceId: mcpWorkspace,
  reportId: mcpReport,
  date: z.iso.date().describe("The date to give every approved card that has none, as YYYY-MM-DD: from today to a year out."),
});
export const mcpApplyHandoffCalendarSchema = z.object({
  workspaceId: mcpWorkspace,
  reportId: mcpReport,
  confirm: mcpConfirm("Required as true, after the person agrees. It overwrites the follow-up dates of many companies and the old dates are not kept."),
});
export const mcpReopenForNextYearSchema = z.object({
  workspaceId: mcpWorkspace,
  cardId: mcpId("The approved card of a Committed company, from get_handoff."),
  confirm: mcpConfirm("Required as true, after the person agrees. It moves a closed deal back to Contacted."),
});
export const mcpSetHandoffPublishedSchema = z.object({
  workspaceId: mcpWorkspace,
  reportId: mcpReport,
  published: z.boolean().describe("true to publish the handoff to every member, false to take it back to a draft."),
  confirm: mcpConfirm("Required as true to publish, after the person agrees."),
});

// ----- Group I, CSV import -----

// The request body limit (64 KB of bytes, lib/mcp/handler.ts) counts what is sent, so the CSV is
// capped by its size once written as JSON text: accents take two or three bytes and line breaks
// and quotes take two. The seen list gets its own byte cap, and with at most IMPORT_MAX_ROWS skip
// numbers (7 bytes each at most) the three always fit under the limit.
export const MCP_IMPORT_CSV_MAX = 36_000;
export const MCP_IMPORT_SEEN_MAX_BYTES = 12_000;
const jsonBytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v));
const SPLIT_MESSAGE = "This is too much to send in one call. Split a bigger file and import each part.";
const mcpImportColumn = (what: string) => column.describe(`The column (0 is the first) holding ${what}.`);
const mcpImportOptionalColumn = (what: string) => column.nullable().describe(`The column (0 is the first) holding ${what}, or null for none.`);
export const mcpImportMappingSchema = z
  .object({
    name: mcpImportColumn("the company name"),
    industry: mcpImportOptionalColumn("the industry"),
    website: mcpImportOptionalColumn("the website"),
    notes: mcpImportOptionalColumn("the notes"),
    contactName: mcpImportOptionalColumn("the contact's name"),
    contactEmail: mcpImportOptionalColumn("the contact's email"),
  })
  .refine(eachColumnOnce, EACH_COLUMN_ONCE)
  .describe("Which column fills which field. Each column can fill one field.");
const mcpImportCsv = z
  .string()
  .min(1)
  .max(MCP_IMPORT_CSV_MAX)
  .refine(hasStorableText, NUL_MESSAGE)
  .refine((v) => jsonBytes(v) <= MCP_IMPORT_CSV_MAX, SPLIT_MESSAGE)
  .describe("The CSV text with a header row. At most about 35,000 characters, fewer with accents, quotes or many short lines. Split a bigger file and import each part.");
export const mcpPreviewImportSchema = z.object({
  workspaceId: mcpWorkspace,
  csv: mcpImportCsv,
  mapping: mcpImportMappingSchema.optional().describe("Which column fills which field. Leave out to let Coppice guess from the header row."),
});
export const mcpRunImportSchema = z.object({
  workspaceId: mcpWorkspace,
  csv: mcpImportCsv,
  mapping: mcpImportMappingSchema,
  skip: z.array(z.number().int().min(2).max(100_000)).max(IMPORT_MAX_ROWS).describe("Row numbers to leave out (row 1 is the header), from the preview's defaultSkips or the person's choices."),
  seen: z
    .array(mcpId("A company id from the preview's seen list."))
    .max(IMPORT_MAX_ROWS)
    .refine((v) => jsonBytes(v) <= MCP_IMPORT_SEEN_MAX_BYTES, SPLIT_MESSAGE)
    .describe("The preview's seen list, sent back unchanged."),
  confirm: mcpConfirm("Required as true, after the person agrees. Companies are added to the shared board and there is no bulk undo."),
});
