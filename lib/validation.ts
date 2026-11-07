import { z } from "zod";
import { Channel, DraftKind, Stage } from "@/generated/prisma/enums";
import { domainKey } from "@/lib/duplicates";
import { placeholderProblem } from "@/lib/placeholders";
import { parseSourceUrl, SKIP_MESSAGES } from "@/lib/research/urls";
import { MCP_SCOPES } from "@/lib/mcp/config";

// Every server action parses its input with one of these before touching the database.

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters.").max(80),
});

// Our ids are 25 to 36 characters. The cap stops anyone sending megabytes into a lookup.
const id = z.string().min(1).max(64);
const role = z.enum(["member", "owner"]);

export const CLAIM_WINDOW_MIN_DAYS = 1;
export const CLAIM_WINDOW_MAX_DAYS = 60;

export const inviteMemberSchema = z.object({
  workspaceId: id,
  // Trim and lowercase first, then check the format, so " Sam@Purdue.edu " is accepted.
  // 254 characters is the longest a real email address can be.
  email: z.string().trim().toLowerCase().max(254, "Enter a valid email address.").pipe(z.email("Enter a valid email address.")),
  role,
});

export const invitationIdSchema = id;

export const workspaceIdSchema = id;

export const cancelInvitationSchema = z.object({ workspaceId: id, invitationId: id });

export const memberSchema = z.object({ workspaceId: id, memberId: id });

export const changeRoleSchema = memberSchema.extend({ role });

export const claimWindowSchema = z.object({
  workspaceId: id,
  days: z.coerce
    .number()
    .int("Use whole days.")
    .min(CLAIM_WINDOW_MIN_DAYS, `Use ${CLAIM_WINDOW_MIN_DAYS} to ${CLAIM_WINDOW_MAX_DAYS} days.`)
    .max(CLAIM_WINDOW_MAX_DAYS, `Use ${CLAIM_WINDOW_MIN_DAYS} to ${CLAIM_WINDOW_MAX_DAYS} days.`),
});

// AI settings (owner): the switch is a checkbox ("on" when ticked, missing when not), and the
// limit counts AI calls per 30 days across the workspace. 0 pauses AI without switching it off.
export const AI_LIMIT_MAX = 5000;
export const aiSettingsSchema = z.object({
  workspaceId: id,
  enabled: z
    .string()
    .nullable()
    .transform((v) => v === "on"),
  limit: z.coerce
    .number()
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

// ----- Companies and contacts (Milestone 2) -----

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
    .nullable()
    .transform((v) => v || null);

export const COMPANY_LIMITS = { name: 120, industry: 80, website: 300, notes: 5000 } as const;

export const companyFieldsSchema = z.object({
  name: z.string().trim().min(1, "Enter a company name.").max(COMPANY_LIMITS.name, `Name can be at most ${COMPANY_LIMITS.name} characters.`),
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
  .pipe(z.array(id).max(20));

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

// Logging outreach (Milestone 3). The follow-up is a calendar date ("2026-11-01"); lib/claims.ts
// checks it is from today to a year out, using the database's idea of "today".
export const NOTE_MAX = 2000;
export const logOutreachSchema = companyRefSchema.extend({
  channel: z.enum(Channel, "Pick how you reached out."),
  note: optionalText(NOTE_MAX, "Note"),
  followUpOn: z.iso.date("Pick a follow-up date."),
  // Set by "I sent it" under an AI draft; missing for a hand-logged outreach.
  aiDraftId: id.nullish(),
  // The template the email was based on, if one was picked ("" is "No template").
  templateId: z.string().max(64).nullish().transform((v) => v || null),
  // P2: the log form's key for this entry, so the same submit twice logs once (lib/claims.ts).
  clientKey: z.string().uuid().optional(),
});

export const DRAFT_NOTE_MAX = 300;
// "Draft an email": what kind, to whom (optional), and an optional note on what to emphasize.
export const draftEmailSchema = companyRefSchema.extend({
  kind: z.enum(DraftKind, "Pick first email or follow-up."),
  contactId: z
    .string()
    .max(64)
    .nullish()
    .transform((v) => v || null),
  note: optionalText(DRAFT_NOTE_MAX, "Note"),
  // An optional template to base both drafts on.
  templateId: z.string().max(64).nullish().transform((v) => v || null),
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
export const duplicatePairSchema = z.object({ workspaceId: id, companyId: id, otherId: id });
export const archiveDuplicateSchema = z.object({ workspaceId: id, keepId: id, archiveId: id });

// "Same company" while editing: archive this company (companyId) and keep the other one.
export const sameCompanySchema = companyRefSchema.extend({ keepId: id });

export const contactFieldsSchema = z.object({
  name: z.string().trim().min(1, "Enter the contact's name.").max(120, "Name can be at most 120 characters."),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254, "Enter a valid email address.")
    .nullable()
    .transform((v) => v || null)
    .pipe(z.email("Enter a valid email address.").nullable()),
  title: optionalText(120, "Title"),
});

export const addContactSchema = contactFieldsSchema.extend({ workspaceId: id, companyId: id });
export const updateContactSchema = addContactSchema.extend({ contactId: id });
export const contactRefSchema = companyRefSchema.extend({ contactId: id });

// ----- Board filters (from the URL) -----

// The board's URL: ?q=acme&industry=Tech&show=COMMITTED&all=CONTACTED&archived=1. A URL can be
// typed or edited by hand, so anything malformed is dropped (`catch`) instead of failing the page.
const stageList = z
  .string()
  .transform((v) => v.split(","))
  .pipe(z.array(z.enum(Stage)));

export const boardFiltersSchema = z.object({
  q: z.string().trim().max(100).catch(""),
  industry: z.string().trim().max(COMPANY_LIMITS.industry).catch(""),
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

export type BoardFilters = z.infer<typeof boardFiltersSchema>;

// The query string for a board view: the inverse of boardFiltersSchema. Empty values are left out.
export function boardQuery(filters: BoardFilters): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.industry) params.set("industry", filters.industry);
  if (filters.show.length > 0) params.set("show", filters.show.join(","));
  if (filters.all) params.set("all", filters.all);
  if (filters.archived) params.set("archived", "1");
  if (filters.dupes) params.set("dupes", "1");
  const query = params.toString();
  return query ? `?${query}` : "";
}

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
  // (P1) How many rows each queue group loads: 50, 100, 150 or 200 ("Show 50 more"). Anything
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

// (P1) The queue's Fresh leads list, loaded 20 at a time when it is opened, up to 100.
export const freshLeadsSchema = z.object({
  workspaceId: workspaceIdSchema,
  offset: z.number().int().min(0).max(80),
});

// ----- CSV import (Milestone 4) -----

export const IMPORT_MAX_ROWS = 2000;
export const IMPORT_MAX_BYTES = 3 * 1024 * 1024;
// No real sponsor sheet has more columns than this; the cap keeps a mapping small.
export const IMPORT_MAX_COLUMNS = 200;

// Coppice fields a CSV column can fill, in the order the mapper shows them.
export const IMPORT_FIELDS = ["name", "industry", "website", "notes", "contactName", "contactEmail"] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

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

// ----- Fact sheet (AI feature 1) -----

export const FACT_MAX = 300;
export const factTextSchema = z.string().trim().min(1, "Write the fact.").max(FACT_MAX, `A fact can be at most ${FACT_MAX} characters.`);
export const addFactSchema = z.object({ workspaceId: id, text: factTextSchema });
export const factRefSchema = z.object({ workspaceId: id, factId: id });
export const updateFactSchema = factRefSchema.extend({ text: factTextSchema });
export const verifyFactSchema = factRefSchema.extend({ verified: z.enum(["1", "0"]).transform((v) => v === "1") });
export const factSheetRefSchema = z.object({ workspaceId: id, factSheetId: id });

// ----- Templates and stats (Milestone 5) -----

export const TEMPLATE_LIMITS = { name: 80, body: 5000 } as const;

// A template's name and body. Line breaks are normalized like a checked draft's, and the body may
// only use the three placeholders (lib/placeholders.ts).
export const templateFieldsSchema = z.object({
  name: z.string().trim().min(1, "Name the template.").max(TEMPLATE_LIMITS.name, `A name can be at most ${TEMPLATE_LIMITS.name} characters.`),
  body: z
    .string()
    .transform(lf)
    .pipe(z.string().trim().min(1, "Write the template.").max(TEMPLATE_LIMITS.body, `A template can be at most ${TEMPLATE_LIMITS.body} characters.`))
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

// ----- Smart import (AI feature 3) -----

// At most this many rows with free text are read per Smart import (owner decision); the rest of
// the sheet imports the normal way.
export const SMART_MAX_ROWS = 300;
export const SMART_NOTE_MAX = 600;
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
export const SMART_STAGES = ["CONTACTED", "REPLIED", "IN_CONVERSATION"] as const;
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
// ----- Research Agent (AI feature 2) -----

// An approved source: an http(s) page with no user:password, no IP address, no non-standard port,
// and not LinkedIn or a people-search site (lib/research/urls.ts). Stored as the parsed URL.
export const SOURCE_LABEL_MAX = 80;
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
  label: z.string().trim().min(1, "Write a label.").max(SOURCE_LABEL_MAX, `A label can be at most ${SOURCE_LABEL_MAX} characters.`),
});

// "Research who to contact": which approved sources to read for this company (checkboxes).
export const BRIEF_SOURCES_MAX = 6;
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

// Onboarding (the basics and AI tours, app/(app)/[workspaceId]/onboarding-actions.ts). Added by the
// onboarding round. `step` is the index of the next unseen card; `event` says what happened: a card
// was passed ("step"), the last card was reached ("done"), or the AI tour was put off ("later").
export const tourProgressSchema = z.object({
  workspaceId: id,
  tour: z.enum(["basics", "ai"]),
  step: z.number().int().min(0).max(20),
  event: z.enum(["step", "done", "later"]),
}).refine((v) => v.event !== "later" || v.tour === "ai", "Only the AI tour can be put off.");
