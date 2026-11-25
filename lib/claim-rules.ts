import { numbersIn } from "@/lib/ai/text";
import type { ClaimSupport } from "@/lib/claim-support";
import { dayString } from "@/lib/dates";
import { domainKey } from "@/lib/duplicates";
import { yearLabel } from "@/lib/smart-import/dates";

// The Claim Checker's rules: plain code, no AI, so the draft panel runs them in the browser on
// every keystroke. They flag the three kinds of claim most likely to embarrass an org in front of
// a sponsor: a number nobody verified, a link nobody checked, and "you sponsored us before".
// What counts as proof: the verified facts, the company's website, and, when the caller passes
// `support`, the research brief items a person accepted for this company and its logged history
// (lib/claim-support.ts, turned into plain values by ruleSupport below).
// The AI check (lib/claim-check.ts) adds sentences these rules can't judge.

export type FindingKind = "number" | "link" | "history" | "unsupported";
export type Finding = { kind: FindingKind; quote: string; reason: string };

// What this company's own record proves, as plain values the browser can hold.
// - brief: each number in an accepted brief item, with the item's words; the number passes only in
//   a sentence that uses one of those words.
// - historyYears: the calendar years of lasting moves to Committed; a year passes only in a
//   sentence that also claims the history.
// - sites: the domains of accepted items' pages; links there pass.
// - history: the board year label proving "sponsored us" (a lasting move to Committed) and the one
//   proving "worked with you before" (a reply in an earlier board year, with no decline since).
export type RuleSupport = {
  brief: { number: string; words: string[] }[];
  historyYears: string[];
  sites: string[];
  history: { sponsored: string | null; replied: string | null };
};

// What a draft may rely on: every number in a verified fact, and the company's own website. No
// `support` means none, as for Template Lab, which checks templates for no company in particular.
export type RuleContext = { factNumbers: string[]; website: string | null; support?: RuleSupport };

export const HISTORY_REASON = "Check this company really has a history with you.";
export const repliedReason = (label: string) => `They replied in ${label}, but no move to Committed is logged for this company.`;

const NUMBER = /\$?\d[\d,]*(?:\.\d+)?%?/g;
// "a 10-minute call" is an ask, not a claim about the org.
const CALL_LENGTH = /^\s*-?\s*min(?:ute)?s?\b/i;
// "Oct 26" or "October 3rd" is a date, usually the earlier email's, not a claim. Only a day of the
// month counts: "March 2030" still has a year to check.
const AFTER_MONTH = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+$/i;
const isDayOfMonth = (number: string, before: string) => /^\d{1,2}$/.test(number) && Number(number) <= 31 && AFTER_MONTH.test(before);
const LINK = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|edu|net|io|co|us|ai|dev)\b\S*/gi;
// Also an invented past sponsorship told as a story ("Last year Ferncliff Foods sponsored our Gold
// tier"): "sponsored our ..." in the past tense, or "sponsored" within a
// sentence that starts its clause with "last year", "previously" or "in the past". The present
// "sponsoring our hackathon" is the ask, so it isn't flagged.
const HISTORY =
  /\b(?:(?:sponsor(?:ed|ing)?|support(?:ed|ing)|back(?:ed|ing)) us (?:before|again|last \w+|in the past)|(?:past|previous|prior|continued) (?:support|sponsorship|partnership)|returning sponsor|(?:once|last year) again|as (?:a|our) (?:past|previous|former) sponsor|work(?:ing|ed) with you (?:before|again|last \w+)|sponsored (?:our|us)|(?:last (?:year|semester|spring|fall|season)|previously|in the past)\b[^.!?\n]{0,60}?\bsponsor(?:ed|ing)\b)\b/gi;

// Sponsorship wording claims money or backing; anything else HISTORY matches ("worked with you
// before", "once again") only claims having been in touch.
const SPONSORSHIP = /sponsor|support|back|partner/i;
// A sentence ends at . ! or ? before a space (so "3.5" and "acme.com" don't end one), or at a line break.
const BOUNDARY = /[.!?](?=\s)|\n/g;
const STOP_WORDS = new Set(["with", "from", "your", "their", "this", "that", "have", "will", "about"]);

// The sentence around text[start, end).
function sentenceAt(text: string, start: number, end: number): string {
  let from = 0;
  for (const b of text.slice(0, start).matchAll(BOUNDARY)) from = b.index + b[0].length;
  const rest = text.slice(end);
  const stop = rest.search(/[.!?](?=\s|$)|\n/);
  return text.slice(from, stop === -1 ? text.length : end + stop);
}

const wordsIn = (text: string) => text.toLowerCase().match(/[a-z]+/g) ?? [];

export function checkRules(text: string, context: RuleContext): Finding[] {
  const findings: Finding[] = [];
  const supported = new Set(context.factNumbers);
  const ownSite = domainKey(context.website);
  const support = context.support;
  const sites = new Set(support?.sites ?? []);
  const claimsHistory = (sentence: string) => new RegExp(HISTORY.source, "i").test(sentence);

  for (const m of text.matchAll(NUMBER)) {
    const value = numbersIn(m[0])[0];
    if (supported.has(value) || CALL_LENGTH.test(text.slice(m.index + m[0].length)) || isDayOfMonth(m[0], text.slice(0, m.index))) continue;
    if (support) {
      const sentence = sentenceAt(text, m.index, m.index + m[0].length);
      if (support.historyYears.includes(value) && claimsHistory(sentence)) continue;
      const words = new Set(wordsIn(sentence));
      if (support.brief.some((entry) => entry.number === value && entry.words.some((w) => words.has(w)))) continue;
    }
    findings.push({ kind: "number", quote: m[0], reason: "No verified fact has this number." });
  }
  for (const m of text.matchAll(LINK)) {
    const link = m[0].replace(/[).,;:!?]+$/, "");
    const key = domainKey(link);
    if (ownSite && key === ownSite) continue;
    if (key && sites.has(key)) continue;
    findings.push({ kind: "link", quote: link, reason: "Links aren't checked. Make sure it goes where you mean." });
  }
  for (const m of text.matchAll(HISTORY)) {
    const history = support?.history;
    let reason = HISTORY_REASON;
    if (history) {
      if (SPONSORSHIP.test(m[0])) {
        if (history.sponsored) continue;
        if (history.replied) reason = repliedReason(history.replied);
      } else if (history.sponsored || history.replied) continue;
    }
    findings.push({ kind: "history", quote: m[0], reason });
  }

  // Once per distinct quote: a number repeated three times is one thing to fix.
  const seen = new Set<string>();
  return findings.filter((f) => !seen.has(`${f.kind}:${f.quote}`) && seen.add(`${f.kind}:${f.quote}`));
}

// The numbers a draft may use, from the verified facts' text.
export const factNumbers = (facts: { text: string }[]) => [...new Set(facts.flatMap((f) => numbersIn(f.text)))];

// Which board years prove what, from the company's logged history (pure, so tests can run it):
// - sponsored: the newest board year with a lasting move to Committed, this one included. A company
//   reopened in spring after committing in the fall really did sponsor.
// - replied: the newest EARLIER board year with a reply, unless the company's latest outcome is a
//   decline. A reply this year is the conversation the draft is part of, not a past relationship.
export function historyProof(s: Pick<ClaimSupport, "years" | "currentYear" | "lastOutcome">): RuleSupport["history"] {
  const newest = [...s.years].sort((a, b) => b.start - a.start);
  const sponsored = newest.find((y) => y.committed.length > 0);
  const replied = s.lastOutcome === "DECLINED" ? undefined : newest.find((y) => y.start < s.currentYear && y.replies > 0);
  return { sponsored: sponsored ? yearLabel(sponsored.start) : null, replied: replied ? yearLabel(replied.start) : null };
}

// The plain values checkRules needs, from what claimSupport read. Called on the server; the result
// is safe to send to the browser (no names, notes or quotes, only numbers, words and domains).
export function ruleSupport(s: ClaimSupport): RuleSupport {
  const brief = s.items.flatMap((item) => {
    const words = [...new Set(wordsIn(`${item.title} ${item.label}`).filter((w) => w.length >= 4 && !STOP_WORDS.has(w)))];
    const numbers = new Set([...numbersIn(item.quote), ...numbersIn(item.deadline ?? "")]);
    return [...numbers].map((number) => ({ number, words }));
  });
  const historyYears = [...new Set(s.years.flatMap((y) => y.committed.map((d) => String(Number(dayString(d).slice(0, 4))))))];
  const sites = [...new Set(s.items.flatMap((item) => domainKey(item.url) ?? []))];
  return { brief, historyYears, sites, history: historyProof(s) };
}
