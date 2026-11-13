import { dayString } from "@/lib/dates";
import { maskPhones } from "@/lib/ai/phones";
import { promptSafe } from "@/lib/ai/text";
import { plantedInstruction } from "@/lib/smart-import/check";
import { COMPANY_NOTE_PROMPT_MAX, OUTREACH_NOTE_PROMPT_MAX, OUTREACH_NOTES_PER_COMPANY } from "./limits";

// The notes the model is shown, and exactly as it is shown them (the Time Capsule's prompt side).
// Notes are text people typed: data, never instructions. Each is masked (emails and phone numbers,
// in US and international formats), has its angle brackets swapped so it can't close the tags
// around it, is cut to size, and gets a short id the model cites. A note that reads as an
// instruction to an AI (plantedInstruction) is left out of the prompt, so it has no id and can
// never be quoted. Quotes are checked against the text as it was sent, which is what is kept here.

export type SentNote = {
  // "n1", "n2" ...: unique within one call, so a bullet citing another company's note is caught.
  id: string;
  companyId: string;
  kind: "company" | "outreach";
  outreachId: string | null;
  // The outreach entry's time, ISO; null for the company's notes field.
  sentAt: string | null;
  channel: string | null;
  text: string;
};

// Masked, bracket-safe and cut to `max`. Masking comes first, so a cut can never split an email
// address into something that no longer looks like one.
export const maskedNote = (raw: string) => maskPhones(promptSafe(raw.trim()));
export const promptText = (raw: string, max: number) => maskedNote(raw).slice(0, max).trim();

// A note worth sending has letters in it ("3/2" or "-" can't support a bullet).
const usable = (text: string) => /\p{L}/u.test(text);

export type CompanyNotes = {
  id: string;
  name: string;
  notes: string | null;
  // Outreach entries with a note, any order.
  outreach: { id: string; note: string | null; sentAt: Date; channel: string }[];
};

export type PromptCompany = { key: string; companyId: string; name: string; notes: SentNote[] };

// The prompt's companies ("c1" ...) and their notes. A company's notes field, then its latest 12
// outreach notes, oldest first so the story reads in order. A company with nothing usable is left
// out (it becomes a code-only card without being sent). `planted` counts the notes left out for
// reading as instructions.
export function promptCompanies(companies: readonly CompanyNotes[]): { companies: PromptCompany[]; planted: number } {
  let n = 0;
  let planted = 0;
  const out: PromptCompany[] = [];
  for (const company of companies) {
    const notes: SentNote[] = [];
    const add = (raw: string | null, max: number, rest: Omit<SentNote, "id" | "text" | "companyId">) => {
      if (!raw?.trim()) return;
      if (plantedInstruction(raw)) {
        planted += 1;
        return;
      }
      const text = promptText(raw, max);
      if (!usable(text)) return;
      n += 1;
      notes.push({ id: `n${n}`, companyId: company.id, text, ...rest });
    };
    add(company.notes, COMPANY_NOTE_PROMPT_MAX, { kind: "company", outreachId: null, sentAt: null, channel: null });
    const latest = company.outreach
      .filter((o) => o.note?.trim())
      .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime() || b.id.localeCompare(a.id))
      .slice(0, OUTREACH_NOTES_PER_COMPANY)
      .reverse();
    for (const o of latest) add(o.note, OUTREACH_NOTE_PROMPT_MAX, { kind: "outreach", outreachId: o.id, sentAt: o.sentAt.toISOString(), channel: o.channel });
    if (notes.length > 0) out.push({ key: `c${out.length + 1}`, companyId: company.id, name: company.name, notes });
  }
  return { companies: out, planted };
}

const attr = (text: string) => promptSafe(text).replace(/"/g, "'").slice(0, 120);

// The notes as the prompt shows them.
export function companiesXml(companies: readonly PromptCompany[]): string {
  return companies
    .map((c) => {
      const notes = c.notes
        .map((note) =>
          note.kind === "company"
            ? `<note id="${note.id}" source="company notes">${note.text}</note>`
            : `<note id="${note.id}" source="outreach" date="${note.sentAt ? dayString(new Date(note.sentAt)) : ""}" channel="${note.channel}">${note.text}</note>`,
        )
        .join("\n");
      return `<company id="${c.key}" name="${attr(c.name)}">\n${notes}\n</company>`;
    })
    .join("\n");
}
