// The Time Capsule's plain limits and wording (lib/capsule/). This file imports nothing, so a
// client component can read it without loading zod, and lib/validation.ts can take its numbers.

// Cards the model reads: the first 60 companies of the selection, four to a call, so a report never
// takes more than 15 calls. Every company after those gets a card made by code alone.
export const CARD_COMPANIES_PER_CALL = 4;
export const CARD_AI_COMPANIES = 60;
export const CARD_MAX_CALLS = CARD_AI_COMPANIES / CARD_COMPANIES_PER_CALL;

// What the model is shown of a company: its notes field, and its latest outreach notes.
export const COMPANY_NOTE_PROMPT_MAX = 600;
export const OUTREACH_NOTES_PER_COMPANY = 12;
export const OUTREACH_NOTE_PROMPT_MAX = 400;

// What it may send back.
export const BULLETS_PER_CARD = 8;
export const BULLET_TEXT_MAX = 160;
export const BULLET_QUOTE_MIN = 8;
export const BULLET_QUOTE_MAX = 300;
export const SECTIONS = ["champions", "worked", "timing", "avoid", "promises", "next"] as const;
export type Section = (typeof SECTIONS)[number];
export const SECTION_LABELS: Record<Section, string> = {
  champions: "Champions",
  worked: "What worked",
  timing: "Timing",
  avoid: "What to avoid",
  promises: "Promises made",
  next: "Next steps",
};

// Ask the Archive.
export const ARCHIVE_QUESTION_MIN = 3;
export const ARCHIVE_QUESTION_MAX = 300;
export const ARCHIVE_TERMS_MAX = 6;
export const ARCHIVE_CANDIDATES_MAX = 300;
export const ARCHIVE_NOTES_SENT = 10;
export const ARCHIVE_NOTE_PROMPT_MAX = 600;
export const ARCHIVE_SENTENCES_MAX = 5;
export const ARCHIVE_SENTENCE_MAX = 220;
export const ARCHIVE_NO_MATCH = "Nothing in the notes mentions that.";
export const ARCHIVE_UNCLEAR = "The notes don't answer that clearly.";

// A re-contact date may be set from today to a year out, the same range a follow-up takes
// (lib/claims.ts logOutreach).
export const RECONTACT_MAX_DAYS = 365;

// What Settings and the landing page say about what reaches Groq for this feature, to be used
// where the privacy wording lives (components/landing/copy.ts, the Settings page).
export const CAPSULE_PRIVACY =
  "The Time Capsule's relationship cards and Ask the Archive send Groq your companies' notes and outreach notes, which can include names, with email addresses and phone numbers masked. Groq says it doesn't keep what it's sent by default, apart from logs it may hold for up to 30 days to look into errors or abuse. The recap and the playbook use no AI.";
