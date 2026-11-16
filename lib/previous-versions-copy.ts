import type { VersionField } from "@/generated/prisma/enums";

// What the company page and the restore refusals say about previous versions. Pure text and
// numbers, so the client list (components/ledger/company/previous-versions.tsx) can import it.

// How long a replaced value is kept: one hour by the database clock. Keep equal to interval '1 hour'
// in the previous_versions migration (its policy and its purge function).
export const PREVIOUS_VERSION_MS = 60 * 60 * 1000;

export const VERSION_LABELS: Record<VersionField, string> = {
  NAME: "Name",
  INDUSTRY: "Industry",
  WEBSITE: "Website",
  NOTES: "Notes",
  EMAIL: "Email",
  TITLE: "Title",
};

// One row of the list, built on the server (previousItems in lib/previous-versions.ts).
export type PreviousItem = {
  versionId: string;
  // Which field and whose (null for a company field), posted with Restore so a slot that was
  // overwritten since the page loaded is told apart from one whose hour ran out.
  field: VersionField;
  contactId: string | null;
  label: string;
  // Null when the field was empty before the change.
  value: string | null;
  // Notes longer than 140 characters or with a line break: shown in a disclosure.
  long: boolean;
  // How long ago it was replaced, by the database clock when the page was drawn.
  ageMs: number;
  // The exact time, for the line's tooltip ("Nov 16, 2026, 3:42 PM").
  exactTime: string;
  byName: string;
  byAssistant: boolean;
  // The person looking replaced it (or their assistant did).
  mine: boolean;
  // valueDigest of the field's current value, so a change since the page loaded is caught.
  expected: string;
  // The Restore button's accessible name.
  restoreLabel: string;
  // Where focus goes after a restore.
  focusAfter: string;
};

// "Previous version, replaced 12 min ago by Sam". Under a minute is "just now". The person looking
// reads "you" or "your assistant".
export function replacedLine(by: { byName: string; byAssistant: boolean; mine: boolean }, ageMs: number): string {
  const minutes = Math.floor(ageMs / 60_000);
  const when = minutes < 1 ? "just now" : `${minutes} min ago`;
  const who = by.mine ? (by.byAssistant ? "your assistant" : "you") : by.byAssistant ? `${by.byName}'s assistant` : by.byName;
  return `Previous version, replaced ${when} by ${who}`;
}

export const VERSION_GONE = "That previous version is no longer kept. Its hour is up, or the field was changed again after the page loaded. Nothing was changed.";
// The same answer for an assistant, which reads a company with get_company instead of loading a page.
export const VERSION_GONE_ASSISTANT = "That previous version is no longer kept. Its hour is up, or the field was changed again after you read it. Nothing was changed.";
export const VERSION_CHANGED = "This was changed again after the page loaded, so nothing was restored. The page now shows the latest version.";
export const VERSION_SAME = "That previous version is the same as the value now, so nothing was changed.";
export const RESTORED = "Restored. The value it replaced can be put back for an hour.";
