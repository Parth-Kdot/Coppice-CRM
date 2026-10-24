import { z } from "zod";
import { Stage } from "@/generated/prisma/enums";
import { domainKey } from "@/lib/duplicates";

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

export const moveStageSchema = companyRefSchema.extend({ stage: z.enum(Stage) });

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
