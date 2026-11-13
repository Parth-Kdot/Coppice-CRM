import { z } from "zod";
import { matchKey, maskContactDetails } from "@/lib/ai/text";
import { maskPhones } from "@/lib/ai/phones";
import { plantedInstruction } from "@/lib/smart-import/check";
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
import { inventedName, monthsFound, monthsIn, negationFound, numbersFound, quoteSpan, unsupportedTiming, wordsSupported } from "./support";
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

// Text the model wrote, in the one form every check and the page see: NFKC (so a fullwidth "＠" or
// "．" is the plain character), spacing collapsed, and format or control characters (a zero-width
// space, a soft hyphen, a direction mark) taken out, so nothing a reader can't see or tell apart can
// hide an address or a link from the checks that follow. This is also the text that is stored.
export const cleanText = (text: string) =>
  text
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .replace(/[\p{Cf}\p{Cc}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();

// Why text a person will read can't be shown, or null. No email address, phone number (in any
// format Coppice masks), link, placeholder ("[email]", "{{name}}") or instruction to an AI. The
// text is cleaned first (cleanText), so the checks read what a person would.
export function textProblem(raw: string): TextProblem | null {
  const text = cleanText(raw);
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
  | "month"
  | "name"
  | "timing"
  | "negation"
  | "unsupported"
  | TextProblem
  | "repeat";

export type BulletCheck = { ok: true; bullet: CardBullet } | { ok: false; reason: DropReason };

// One bullet for one company. `notes` is every note sent in the call, by id, so a note id that was
// never sent and one that belongs to another company are both caught.
export function checkBullet(bullet: BulletReadOutput, companyId: string, notes: ReadonlyMap<string, SentNote>): BulletCheck {
  const text = cleanText(bullet.text);
  if (!text) return { ok: false, reason: "empty" };
  if (text.length > BULLET_TEXT_MAX) return { ok: false, reason: "too_long" };
  const problem = textProblem(text);
  if (problem) return { ok: false, reason: problem };
  const note = notes.get(bullet.noteId.trim());
  if (!note) return { ok: false, reason: "unknown_note" };
  if (note.companyId !== companyId) return { ok: false, reason: "other_company_note" };
  const badQuote = quoteProblem(bullet.quote, note.text);
  if (badQuote) return { ok: false, reason: badQuote };
  const collapsed = bullet.quote.replace(/\s+/g, " ").trim();
  // The quote kept is the note's own words: the stretch of the note the model's quote matches.
  const quote = quoteSpan(collapsed, note.text) ?? collapsed;
  // The text may say only what the quote says: its figures, months, names, seasons and deadlines
  // are in the quote, a "never" needs one there, and most of its words are in the quote or note.
  const unproven = unprovenProblem(text, quote, [note.text, note.companyName ?? ""], note.companyName ? [note.companyName] : []);
  if (unproven) return { ok: false, reason: unproven };
  // A month is kept only on a "next" bullet, and only if code finds that month, or a date in it,
  // in the quote.
  const month = bullet.section === "next" && bullet.month !== null && monthsIn(quote, { written: false }).includes(bullet.month) ? bullet.month : null;
  const source = note.kind === "company" ? ({ kind: "company" } as const) : ({ kind: "outreach", outreachId: note.outreachId ?? "", sentAt: note.sentAt ?? "" } as const);
  return { ok: true, bullet: { section: bullet.section, text, quote, source, month } };
}

// What the text may not add to its proof (`proof` is the quote for a bullet, the cited notes for a
// sentence; `context` is what else it may draw its plain words from; `names` are the company names
// it may use). The reason, or null.
function unprovenProblem(text: string, proof: string, context: readonly string[], names: readonly string[]): "number" | "month" | "name" | "timing" | "negation" | "unsupported" | null {
  if (!numbersFound(text, proof)) return "number";
  if (!monthsFound(text, proof)) return "month";
  if (inventedName(text, proof, names)) return "name";
  if (unsupportedTiming(text, proof)) return "timing";
  if (!negationFound(text, proof)) return "negation";
  if (!wordsSupported(text, [proof, ...context, ...names])) return "unsupported";
  return null;
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

export type SentenceDrop =
  | "malformed"
  | "empty"
  | "too_long"
  | "no_note"
  | "unknown_note"
  | "quote_short"
  | "quote_long"
  | "quote_missing"
  | "number"
  | "month"
  | "name"
  | "timing"
  | "negation"
  | "unsupported"
  | TextProblem;

export type SentenceCheck =
  | { ok: true; sentence: { text: string; noteIds: string[]; quote: string; quoteNoteId: string } }
  | { ok: false; reason: SentenceDrop };

// One sentence of an answer. `notes` is every note sent, by id. Every cited id must have been sent
// (and at least one must be cited); the quote must be in one of the cited notes; every number in
// the text must be in a cited note.
export function checkSentence(item: { text: string; noteIds: string[]; quote: string }, notes: ReadonlyMap<string, SentNote>): SentenceCheck {
  const text = cleanText(item.text);
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
  const collapsed = item.quote.replace(/\s+/g, " ").trim();
  let problem: ReturnType<typeof quoteProblem> = "quote_missing";
  let quoteNote: SentNote | undefined;
  for (const note of cited) {
    const p = quoteProblem(collapsed, note.text);
    if (p === null) {
      quoteNote = note;
      problem = null;
      break;
    }
    if (p !== "quote_missing") problem = p;
  }
  if (problem || !quoteNote) return { ok: false, reason: problem ?? "quote_missing" };
  const quote = quoteSpan(collapsed, quoteNote.text) ?? collapsed;
  // A sentence may draw on every note it cites, and name the companies they belong to.
  const citedText = cited.map((n) => n.text).join("\n");
  const names = [...new Set(cited.flatMap((n) => (n.companyName ? [n.companyName] : [])))];
  const unproven = unprovenProblem(text, citedText, [], names);
  if (unproven) return { ok: false, reason: unproven };
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
