// Plain limits and URL helpers that client components need. This file imports nothing: no zod, no
// generated Prisma enums, no lib/duplicates. A "use client" file that imported these from
// lib/validation pulled all of zod (and its run-time code probe, which a strict CSP reports) into
// the browser bundle, about 95 kB gzipped for two numbers. lib/validation re-exports every name
// here, so server code can keep importing from there.

// ----- Workspaces and settings -----

export const WORKSPACE_NAME_MAX = 80;
// How many of a person's workspaces a list shows (the header's switcher, the assistant consent page
// and the assistants' list_workspaces), oldest membership first. The switcher always adds the
// workspace being viewed if it is past the cap.
export const WORKSPACES_SHOWN = 20;
export const CLAIM_WINDOW_MIN_DAYS = 1;
export const CLAIM_WINDOW_MAX_DAYS = 60;
// AI calls allowed per 30 days across a workspace. 0 pauses AI without switching it off.
export const AI_LIMIT_MAX = 5000;

// ----- Companies, outreach and drafts -----

export const COMPANY_LIMITS = { name: 120, industry: 80, website: 300, notes: 5000 } as const;
export const NOTE_MAX = 2000;
export const DRAFT_NOTE_MAX = 300;

// The pipeline's stages, in order. The same strings as the Stage enum in prisma/schema.prisma;
// lib/validation checks at compile time that the two lists match.
export const STAGES = ["NOT_CONTACTED", "CONTACTED", "REPLIED", "IN_CONVERSATION", "COMMITTED", "DECLINED"] as const;
export type StageName = (typeof STAGES)[number];

// ----- Board filters (the URL) -----

// What the board's URL holds once lib/validation has read it (boardFiltersSchema).
export type BoardFilters = {
  q: string;
  industry: string;
  // Committed and Declined start collapsed; these are the ones opened.
  show: StageName[];
  // One column showing every card instead of the first 50.
  all: StageName | null;
  archived: boolean;
  // The "Possible duplicates" section is open.
  dupes: boolean;
};

// Board search text is cut to this length rather than dropped.
export const BOARD_QUERY_MAX = 100;

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

// ----- CSV import -----

export const IMPORT_MAX_ROWS = 2000;
export const IMPORT_MAX_BYTES = 3 * 1024 * 1024;
// No real sponsor sheet has more columns than this; the cap keeps a mapping small.
export const IMPORT_MAX_COLUMNS = 200;

// Coppice fields a CSV column can fill, in the order the mapper shows them.
export const IMPORT_FIELDS = ["name", "industry", "website", "notes", "contactName", "contactEmail"] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

// ----- Fact sheet, templates, Smart import, research -----

export const FACT_MAX = 300;
export const TEMPLATE_LIMITS = { name: 80, body: 5000 } as const;

// At most this many rows with free text are read per Smart import (owner decision); the rest of
// the sheet imports the normal way.
export const SMART_MAX_ROWS = 300;
export const SMART_NOTE_MAX = 600;
// What a Smart import may set a row's stage to: only the stages before an outcome.
export const SMART_STAGES = ["CONTACTED", "REPLIED", "IN_CONVERSATION"] as const;

export const SOURCE_LABEL_MAX = 80;
export const BRIEF_SOURCES_MAX = 6;
