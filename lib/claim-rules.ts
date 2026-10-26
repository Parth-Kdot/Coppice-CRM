import { numbersIn } from "@/lib/ai/text";
import { domainKey } from "@/lib/duplicates";

// The Claim Checker's rules: plain code, no AI, so the draft panel runs them in the browser on
// every keystroke. They flag the three kinds of claim most likely to embarrass an org in front of
// a sponsor: a number nobody verified, a link nobody checked, and "you sponsored us before".
// The AI check (lib/claim-check.ts) adds sentences these rules can't judge.

export type FindingKind = "number" | "link" | "history" | "unsupported";
export type Finding = { kind: FindingKind; quote: string; reason: string };

// What a draft may rely on: every number in a verified fact, and the company's own website.
export type RuleContext = { factNumbers: string[]; website: string | null };

const NUMBER = /\$?\d[\d,]*(?:\.\d+)?%?/g;
// "a 10-minute call" is an ask, not a claim about the org.
const CALL_LENGTH = /^\s*-?\s*min(?:ute)?s?\b/i;
// "Oct 26" or "October 3rd" is a date, usually the earlier email's, not a claim. Only a day of the
// month counts: "March 2030" still has a year to check.
const AFTER_MONTH = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+$/i;
const isDayOfMonth = (number: string, before: string) => /^\d{1,2}$/.test(number) && Number(number) <= 31 && AFTER_MONTH.test(before);
const LINK = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|edu|net|io|co|us|ai|dev)\b\S*/gi;
const HISTORY =
  /\b(?:sponsor(?:ed|ing)? us (?:before|again|last \w+|in the past)|(?:past|previous|prior|continued) (?:support|sponsorship|partnership)|returning sponsor|(?:once|last year) again|as (?:a|our) (?:past|previous|former) sponsor|work(?:ing|ed) with you (?:before|again|last \w+))\b/gi;

export function checkRules(text: string, context: RuleContext): Finding[] {
  const findings: Finding[] = [];
  const supported = new Set(context.factNumbers);
  const ownSite = domainKey(context.website);

  for (const m of text.matchAll(NUMBER)) {
    const value = numbersIn(m[0])[0];
    if (supported.has(value) || CALL_LENGTH.test(text.slice(m.index + m[0].length)) || isDayOfMonth(m[0], text.slice(0, m.index))) continue;
    findings.push({ kind: "number", quote: m[0], reason: "No verified fact has this number." });
  }
  for (const m of text.matchAll(LINK)) {
    const link = m[0].replace(/[).,;:!?]+$/, "");
    if (ownSite && domainKey(link) === ownSite) continue;
    findings.push({ kind: "link", quote: link, reason: "Links aren't checked. Make sure it goes where you mean." });
  }
  for (const m of text.matchAll(HISTORY)) {
    findings.push({ kind: "history", quote: m[0], reason: "Check this company really has a history with you." });
  }

  // Once per distinct quote: a number repeated three times is one thing to fix.
  const seen = new Set<string>();
  return findings.filter((f) => !seen.has(`${f.kind}:${f.quote}`) && seen.add(`${f.kind}:${f.quote}`));
}

// The numbers a draft may use, from the verified facts' text.
export const factNumbers = (facts: { text: string }[]) => [...new Set(facts.flatMap((f) => numbersIn(f.text)))];
