import { z } from "zod";
import { matchKey, maskContactDetails, numbersIn } from "@/lib/ai/text";
import { maskPhones } from "@/lib/research/scan";
import { plantedInstruction } from "@/lib/smart-import/check";
import { monthsMentioned } from "@/lib/smart-import/dates";
import {
  ARCHIVE_SENTENCES_MAX,
  ARCHIVE_SENTENCE_MAX,
  BULLETS_PER_CARD,
  BULLET_QUOTE_MAX,
  BULLET_QUOTE_MIN,
  BULLET_TEXT_MAX,
  CARD_COMPANIES_PER_CALL,
  SECTIONS,
} from "./limits";
import type { SentNote } from "./notes";
import type { CardBullet } from "./types";

// What the Time Capsule accepts from the model (pure; tests/capsule-check.test.ts). The model is
// never trusted: each bullet or sentence is kept only if code finds its quote in the note it cites,
// every number in it in that note, and nothing in it that could carry a contact detail, a link or a
// placeholder. One that fails any check is dropped, not repaired.

// ----- The shapes the model is asked for -----

// A bullet that doesn't fit becomes null (dropped) instead of failing the whole reply; length and
// count limits are not sent to Groq, so they are checked here by code.
const BulletRead = z.object({
  section: z.enum(SECTIONS),
  text: z.string(),
  noteId: z.string(),
  quote: z.string(),
  month: z.number().int().nullable(),
});
export type BulletReadOutput = z.output<typeof BulletRead>;

export const CardsRead = z.object({
  companies: z
    .array(
      z
        .object({ company: z.string().describe('The company id, like "c1"'), bullets: z.array(BulletRead.nullable().catch(null)) })
        .nullable()
        .catch(null),
    )
    .max(CARD_COMPANIES_PER_CALL * 2),
});
export type CardsReadOutput = z.output<typeof CardsRead>;

const SentenceRead = z.object({ text: z.string(), noteIds: z.array(z.string()), quote: z.string() });
export const ArchiveRead = z.object({
  found: z.boolean().describe("Whether the notes answer the question"),
  sentences: z.array(SentenceRead.nullable().catch(null)),
});
export type ArchiveReadOutput = z.output<typeof ArchiveRead>;

// ----- Checks both features share -----

export type TextProblem = "contact" | "link" | "placeholder" | "instruction";

const LINK = /https?:\/\/|\bwww\.|\b[a-z0-9][a-z0-9-]*\.(?:com|org|net|edu|gov|io|co|us|ai|app|dev|info|biz|ly)\b/i;
const PLACEHOLDER = /\{\{|\}\}|\[[^\]\n]{1,30}\]|<[^>\n]{1,30}>/;

// Why text a person will read can't be shown, or null. No email address, phone number (in any
// format Coppice masks), link, placeholder ("[email]", "{{name}}") or instruction to an AI.
export function textProblem(text: string): TextProblem | null {
  if (maskContactDetails(text) !== text || maskPhones(text) !== text || /\[(?:email|phone)\]/.test(text)) return "contact";
  if (LINK.test(text)) return "link";
  if (PLACEHOLDER.test(text)) return "placeholder";
  if (plantedInstruction(text)) return "instruction";
  return null;
}

// Whether the quote is at least BULLET_QUOTE_MIN characters and really is in the note: spacing,
// case and smart quotes aside (lib/ai/text.ts matchKey). Returns why not, or null.
export function quoteProblem(quote: string, noteText: string): "quote_short" | "quote_long" | "quote_missing" | null {
  const trimmed = quote.trim();
  const key = matchKey(trimmed);
  if (key.length < BULLET_QUOTE_MIN) return "quote_short";
  if (trimmed.length > BULLET_QUOTE_MAX) return "quote_long";
  return matchKey(noteText).includes(key) ? null : "quote_missing";
}

// Every number in the text is in `source` (numbers compare as lib/ai/text.ts numbersIn reads them,
// so "$2,500" and "2500" are the same number). A text with no numbers passes.
export const numbersFound = (text: string, source: string) => {
  const known = numbersIn(source);
  return numbersIn(text).every((n) => known.includes(n));
};

// ----- Relationship cards -----

export type DropReason =
  | "malformed"
  | "empty"
  | "too_long"
  | "unknown_note"
  | "other_company_note"
  | "quote_short"
  | "quote_long"
  | "quote_missing"
  | "number"
  | TextProblem
  | "repeat";

export type BulletCheck = { ok: true; bullet: CardBullet } | { ok: false; reason: DropReason };

// One bullet for one company. `notes` is every note sent in the call, by id, so a note id that was
// never sent and one that belongs to another company are both caught.
export function checkBullet(bullet: BulletReadOutput, companyId: string, notes: ReadonlyMap<string, SentNote>): BulletCheck {
  const text = bullet.text.replace(/\s+/g, " ").trim();
  if (!text) return { ok: false, reason: "empty" };
  if (text.length > BULLET_TEXT_MAX) return { ok: false, reason: "too_long" };
  const problem = textProblem(text);
  if (problem) return { ok: false, reason: problem };
  const note = notes.get(bullet.noteId.trim());
  if (!note) return { ok: false, reason: "unknown_note" };
  if (note.companyId !== companyId) return { ok: false, reason: "other_company_note" };
  const badQuote = quoteProblem(bullet.quote, note.text);
  if (badQuote) return { ok: false, reason: badQuote };
  const quote = bullet.quote.replace(/\s+/g, " ").trim();
  if (!numbersFound(text, quote)) return { ok: false, reason: "number" };
  // A month is kept only on a "next" bullet, and only if code finds that month, or a date in it,
  // in the quote.
  const month = bullet.section === "next" && bullet.month !== null && monthsMentioned(quote).includes(bullet.month) ? bullet.month : null;
  const source = note.kind === "company" ? ({ kind: "company" } as const) : ({ kind: "outreach", outreachId: note.outreachId ?? "", sentAt: note.sentAt ?? "" } as const);
  return { ok: true, bullet: { section: bullet.section, text, quote, source, month } };
}

export type CardCheck = { bullets: CardBullet[]; dropped: Partial<Record<DropReason, number>> };

// A company's bullets from the reply: the ones that pass, in the model's order, at most eight, with
// a count of the ones dropped and why. A null entry is a bullet that didn't fit the schema.
export function checkBullets(read: readonly (BulletReadOutput | null)[], companyId: string, notes: ReadonlyMap<string, SentNote>): CardCheck {
  const kept: CardBullet[] = [];
  const dropped: CardCheck["dropped"] = {};
  const drop = (reason: DropReason) => (dropped[reason] = (dropped[reason] ?? 0) + 1);
  const seen = new Set<string>();
  for (const item of read) {
    if (!item) {
      drop("malformed");
      continue;
    }
    const checked = checkBullet(item, companyId, notes);
    if (!checked.ok) {
      drop(checked.reason);
      continue;
    }
    const key = `${checked.bullet.section}|${matchKey(checked.bullet.text)}`;
    if (seen.has(key)) {
      drop("repeat");
      continue;
    }
    if (kept.length >= BULLETS_PER_CARD) continue;
    seen.add(key);
    kept.push(checked.bullet);
  }
  return { bullets: kept, dropped };
}

// ----- Ask the Archive -----

export type SentenceDrop = "malformed" | "empty" | "too_long" | "no_note" | "unknown_note" | "quote_short" | "quote_long" | "quote_missing" | "number" | TextProblem;

export type SentenceCheck =
  | { ok: true; sentence: { text: string; noteIds: string[]; quote: string; quoteNoteId: string } }
  | { ok: false; reason: SentenceDrop };

// One sentence of an answer. `notes` is every note sent, by id. Every cited id must have been sent
// (and at least one must be cited); the quote must be in one of the cited notes; every number in
// the text must be in a cited note.
export function checkSentence(item: { text: string; noteIds: string[]; quote: string }, notes: ReadonlyMap<string, SentNote>): SentenceCheck {
  const text = item.text.replace(/\s+/g, " ").trim();
  if (!text) return { ok: false, reason: "empty" };
  if (text.length > ARCHIVE_SENTENCE_MAX) return { ok: false, reason: "too_long" };
  const bad = textProblem(text);
  if (bad) return { ok: false, reason: bad };
  const ids = [...new Set(item.noteIds.map((id) => id.trim()))];
  if (ids.length === 0) return { ok: false, reason: "no_note" };
  const cited: SentNote[] = [];
  for (const id of ids) {
    const note = notes.get(id);
    if (!note) return { ok: false, reason: "unknown_note" };
    cited.push(note);
  }
  const quote = item.quote.replace(/\s+/g, " ").trim();
  let problem: ReturnType<typeof quoteProblem> = "quote_missing";
  let quoteNote: SentNote | undefined;
  for (const note of cited) {
    const p = quoteProblem(quote, note.text);
    if (p === null) {
      quoteNote = note;
      problem = null;
      break;
    }
    if (p !== "quote_missing") problem = p;
  }
  if (problem || !quoteNote) return { ok: false, reason: problem ?? "quote_missing" };
  if (!numbersFound(text, cited.map((n) => n.text).join("\n"))) return { ok: false, reason: "number" };
  return { ok: true, sentence: { text, noteIds: ids, quote, quoteNoteId: quoteNote.id } };
}

export type AnswerCheck = { sentences: Extract<SentenceCheck, { ok: true }>["sentence"][]; dropped: Partial<Record<SentenceDrop, number>> };

// The sentences of a reply that pass, in order, at most five.
export function checkSentences(read: ArchiveReadOutput, notes: ReadonlyMap<string, SentNote>): AnswerCheck {
  const sentences: AnswerCheck["sentences"] = [];
  const dropped: AnswerCheck["dropped"] = {};
  if (!read.found) return { sentences, dropped };
  for (const item of read.sentences) {
    const checked = item ? checkSentence(item, notes) : ({ ok: false, reason: "malformed" } as const);
    if (!checked.ok) {
      dropped[checked.reason] = (dropped[checked.reason] ?? 0) + 1;
      continue;
    }
    if (sentences.length < ARCHIVE_SENTENCES_MAX) sentences.push(checked.sentence);
  }
  return { sentences, dropped };
}
