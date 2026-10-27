import { domainKey } from "@/lib/duplicates";
import type { ActionResult, Channel } from "./types";
import { CHANNELS } from "./types";

// The input rules from lib/validation.ts, with the same limits and the same messages, but without
// the generated Prisma enums or the Zod bundle so they are safe to ship to the browser. If a rule
// changes in lib/validation.ts, change it here too.

export const COMPANY_LIMITS = { name: 120, industry: 80, website: 300, notes: 5000 } as const;
export const CONTACT_LIMITS = { name: 120, email: 254, title: 120 } as const;
export const NOTE_MAX = 2000;
export const DRAFT_NOTE_MAX = 300;
export const FACT_MAX = 300;
export const WORKSPACE_NAME_MIN = 2;
export const WORKSPACE_NAME_MAX = 80;

export const CLAIM_WINDOW_MIN_DAYS = 1;
export const CLAIM_WINDOW_MAX_DAYS = 60;
export const AI_LIMIT_MAX = 5000;
export const AI_WINDOW_DAYS = 30;
// One person may ask for this many drafts in 24 hours.
export const DAILY_DRAFTS_PER_PERSON = 40;

export const IMPORT_MAX_ROWS = 2000;
export const IMPORT_MAX_BYTES = 3 * 1024 * 1024;
export const IMPORT_MAX_COLUMNS = 200;
export const PDF_MAX_BYTES = 3.5 * 1024 * 1024;
export const PDF_MAX_PAGES = 40;

// How many cards, rows and pairs a screen shows before "Show all".
export const COLUMN_SIZE = 50;
export const QUEUE_SIZE = 50;
export const SHOW_ALL_LIMIT = 2000;
export const DUPLICATE_PAIR_LIMIT = 50;

// The fields a CSV column can fill, in the order the mapper shows them.
export const IMPORT_FIELDS = ["name", "industry", "website", "notes", "contactName", "contactEmail"] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export const IMPORT_FIELD_LABELS: Record<ImportField, string> = {
  name: "Company name (required)",
  industry: "Industry",
  website: "Website",
  notes: "Notes",
  contactName: "Contact name",
  contactEmail: "Contact email",
};
// Which column (by position) fills each field; null leaves it empty.
export type ImportMapping = Record<ImportField, number | null>;

// Zod's default email rule, so the same addresses pass and fail as in the real app.
const EMAIL = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/;
export const isEmail = (value: string): boolean => EMAIL.test(value);

// A website is a bare domain ("acme.com") or an http(s) address. Any other scheme is refused, so a
// stored website can never become a dangerous link.
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

// ----- Checked fields -----

export type CompanyInput = { name: string; industry?: string | null; website?: string | null; notes?: string | null };
export type CheckedCompany = { name: string; industry: string | null; website: string | null; notes: string | null };
export type CheckedContact = { name: string; email: string | null; title: string | null };

type Checked<T> = { ok: true; data: T } | { ok: false; errors: string[] };

const trimmedOrNull = (value: string | null | undefined) => (value ?? "").trim() || null;

// The Add company and Edit company rules. Errors come in the order the boxes appear.
export function checkCompanyFields(input: CompanyInput): Checked<CheckedCompany> {
  const errors: string[] = [];
  const name = (input.name ?? "").trim();
  if (name.length < 1) errors.push("Enter a company name.");
  else if (name.length > COMPANY_LIMITS.name) errors.push(`Name can be at most ${COMPANY_LIMITS.name} characters.`);

  const industry = trimmedOrNull(input.industry);
  if (industry && industry.length > COMPANY_LIMITS.industry) errors.push(`Industry can be at most ${COMPANY_LIMITS.industry} characters.`);

  const website = trimmedOrNull(input.website);
  if (website && website.length > COMPANY_LIMITS.website) errors.push(`Website can be at most ${COMPANY_LIMITS.website} characters.`);
  else if (website && !isWebAddress(website)) errors.push("Enter a website like acme.com or https://acme.com.");

  const notes = trimmedOrNull(input.notes);
  if (notes && notes.length > COMPANY_LIMITS.notes) errors.push(`Notes can be at most ${COMPANY_LIMITS.notes} characters.`);

  return errors.length > 0 ? { ok: false, errors } : { ok: true, data: { name, industry, website, notes } };
}

export function checkContactFields(input: { name: string; email?: string | null; title?: string | null }): Checked<CheckedContact> {
  const errors: string[] = [];
  const name = (input.name ?? "").trim();
  if (name.length < 1) errors.push("Enter the contact's name.");
  else if (name.length > CONTACT_LIMITS.name) errors.push(`Name can be at most ${CONTACT_LIMITS.name} characters.`);

  const email = (input.email ?? "").trim().toLowerCase() || null;
  if (email && (email.length > CONTACT_LIMITS.email || !isEmail(email))) errors.push("Enter a valid email address.");

  const title = trimmedOrNull(input.title);
  if (title && title.length > CONTACT_LIMITS.title) errors.push(`Title can be at most ${CONTACT_LIMITS.title} characters.`);

  return errors.length > 0 ? { ok: false, errors } : { ok: true, data: { name, email, title } };
}

export function checkWorkspaceName(value: string): ActionResult<string> {
  const name = value.trim();
  if (name.length < WORKSPACE_NAME_MIN) return { ok: false, error: `Name must be at least ${WORKSPACE_NAME_MIN} characters.` };
  if (name.length > WORKSPACE_NAME_MAX) return { ok: false, error: `Name can be at most ${WORKSPACE_NAME_MAX} characters.` };
  return { ok: true, data: name };
}

export function checkInviteEmail(value: string): ActionResult<string> {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !isEmail(email)) return { ok: false, error: "Enter a valid email address." };
  return { ok: true, data: email };
}

export function checkClaimWindow(days: number): ActionResult<number> {
  if (!Number.isInteger(days)) return { ok: false, error: "Use whole days." };
  if (days < CLAIM_WINDOW_MIN_DAYS || days > CLAIM_WINDOW_MAX_DAYS) {
    return { ok: false, error: `Use ${CLAIM_WINDOW_MIN_DAYS} to ${CLAIM_WINDOW_MAX_DAYS} days.` };
  }
  return { ok: true, data: days };
}

export function checkAiLimit(limit: number): ActionResult<number> {
  if (!Number.isInteger(limit)) return { ok: false, error: "Use a whole number." };
  if (limit < 0 || limit > AI_LIMIT_MAX) return { ok: false, error: `Use 0 to ${AI_LIMIT_MAX}.` };
  return { ok: true, data: limit };
}

export function checkFactText(value: string): ActionResult<string> {
  const text = value.trim();
  if (text.length < 1) return { ok: false, error: "Write the fact." };
  if (text.length > FACT_MAX) return { ok: false, error: `A fact can be at most ${FACT_MAX} characters.` };
  return { ok: true, data: text };
}

export function checkChannel(value: string): ActionResult<Channel> {
  return (CHANNELS as readonly string[]).includes(value) ? { ok: true, data: value as Channel } : { ok: false, error: "Pick how you reached out." };
}

export function checkNote(value: string | null | undefined, max: number): ActionResult<string | null> {
  const note = trimmedOrNull(value);
  if (note && note.length > max) return { ok: false, error: `Note can be at most ${max} characters.` };
  return { ok: true, data: note };
}

// A real calendar date like "2026-11-04" (not "2026-02-30").
export function isYmd(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}
