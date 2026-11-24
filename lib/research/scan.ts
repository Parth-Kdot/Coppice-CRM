import { maskPhones } from "@/lib/ai/phones";
import { promptSafe } from "@/lib/ai/text";
import { isSameSite } from "@/lib/research/urls";

// Deterministic checks on fetched page text, run by code before anything reaches the AI.

// Phrases a page uses when it tries to give instructions to an AI that reads it. A page with any
// of these is flagged: the brief shows a warning, and the reading call is told the page is
// suspect. Flagging changes nothing else: every brief item still needs a quote found on its page,
// and links only ever come from the URLs fetched.
const INJECTION: RegExp[] = [
  /\b(ignore|disregard|forget|override|skip)\b[^.\n]{0,40}\b(previous|prior|above|earlier|preceding|all|any|your|the|these)\b[^.\n]{0,20}\b(instructions?|prompts?|rules|directions|guidelines|context)\b/i,
  /\byou are (now |no longer )?(an? |the )?(ai|a\.i\.|artificial intelligence|language model|llm|large language model|assistant|chatbot|bot|gemini|chatgpt|gpt)\b/i,
  /\bas an (ai|a\.i\.|language model)\b/i,
  /\bsystem (prompt|message|instructions?)\b/i,
  /\b(new|updated|real|hidden|secret|additional) instructions\b/i,
  /\b(do not|don't|never) (tell|inform|reveal|mention)\b[^.\n]{0,30}\b(user|reader|human)\b/i,
  /\bprompt injection\b|\bjailbreak\b/i,
  /\b(ai|llm|model|assistant)s?\b[^.\n]{0,30}\b(must|should) (now )?(say|write|output|respond|include|add|reply)\b/i,
  /<\s*\/?\s*(page|system|instructions?|prompt|passage|company)\b/i,
];

// The phrases found (each at most 80 characters), in page order, without repeats.
export function injectionFlags(text: string): string[] {
  const found: { at: number; phrase: string }[] = [];
  for (const pattern of INJECTION) {
    const global = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
    for (const match of text.matchAll(global)) found.push({ at: match.index ?? 0, phrase: match[0].replace(/\s+/g, " ").trim().slice(0, 80) });
  }
  const seen = new Set<string>();
  return found
    .sort((a, b) => a.at - b.at)
    .filter((f) => !seen.has(f.phrase.toLowerCase()) && seen.add(f.phrase.toLowerCase()))
    .slice(0, 10)
    .map((f) => f.phrase);
}

// Team inboxes on a page: an address whose every word is a role word (careers@,
// university.relations@, campus-recruiting@), never a personal one (jane.doe@), never at a
// personal mail provider, and only at the page's own site or the company's (`sites`), so an
// event agency's info@ on the page isn't offered as the company's door. Found by code in the page
// text before masking; the AI never sees them.
const ROLE_WORDS = new Set([
  "careers", "career", "jobs", "job", "recruiting", "recruitment", "recruiters", "recruiter", "campus", "university", "universities",
  "college", "colleges", "relations", "students", "student", "early", "talent", "internships", "internship", "interns", "intern",
  "programs", "program", "sponsorship", "sponsorships", "sponsor", "sponsors", "giving", "donations", "donate", "foundation",
  "community", "communities", "events", "event", "partnerships", "partnership", "partners", "partner", "outreach", "info", "contact",
  "contactus", "hello", "inquiries", "enquiries", "diversity", "inclusion", "dei", "erg", "ergs", "grants", "philanthropy",
  "csr", "impact", "engagement", "education", "edu", "stem", "team", "office", "hr", "us", "relationsteam", "universityrelations",
  "campusrecruiting", "earlycareers", "studentprograms", "corporate", "social", "responsibility", "citizenship", "volunteer",
  "volunteering", "local", "site", "requests", "request", "support", "general", "media", "press", "news",
]);
const PERSONAL_PROVIDERS = /(^|\.)(gmail|googlemail|yahoo|ymail|outlook|hotmail|live|msn|icloud|me|mac|aol|proton|protonmail|pm|gmx|mail|zoho|yandex|fastmail|hey|tutanota|qq|163)\.[a-z.]+$/i;
const EMAIL = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+/g;

export function teamInboxes(text: string, sites: string[]): string[] {
  const found = new Set<string>();
  for (const [address] of text.matchAll(EMAIL)) {
    const email = address.toLowerCase().replace(/\.+$/, "");
    const [local, domain] = email.split("@");
    if (!domain || PERSONAL_PROVIDERS.test(domain) || !isSameSite(domain, sites)) continue;
    const words = local.split(/[._+-]+/).filter(Boolean);
    if (words.length > 0 && words.every((w) => ROLE_WORDS.has(w))) found.add(email);
    if (found.size >= 10) break;
  }
  return [...found];
}

// The most text read from one page; what the AI is shown is exactly what is stored.
export const PAGE_TEXT_MAX = 30_000;

// The part of a page that is read: cut at a space a little past PAGE_TEXT_MAX, before any regex
// runs, so a 2 MB page costs no more than a 30 KB one. Cutting at a space means no email or phone
// number is split; masking then runs over the whole part, and only its result is cut to size.
// The cut walks back to the last space by hand: no regex, so a long word before the edge can't
// make it slow.
export function pageHead(raw: string): string {
  if (raw.length <= PAGE_TEXT_MAX) return raw;
  const part = raw.slice(0, PAGE_TEXT_MAX + 256);
  if (part.length === raw.length) return part;
  let end = part.length;
  while (end > 0 && !/\s/.test(part[end - 1])) end--;
  return part.slice(0, end);
}

// Page text as the AI sees it: emails and phone numbers (in the formats above) masked, and angle
// brackets swapped so the page can't close or fake the <page> tags around it.
export const maskPage = (head: string) => maskPhones(promptSafe(head)).slice(0, PAGE_TEXT_MAX);
