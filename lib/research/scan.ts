// Deterministic checks on fetched page text, run by code before anything reaches the AI.

// Phrases a page uses when it tries to give instructions to an AI that reads it. A page with any
// of these is flagged: the brief shows a warning, and the reading call is told the page is
// suspect. Flagging changes nothing else: every brief item still needs a quote found on its page,
// and links only ever come from the URLs fetched.
const INJECTION: RegExp[] = [
  /\b(ignore|disregard|forget|override|skip)\b[^.\n]{0,40}\b(previous|prior|above|earlier|preceding|all|any|your|the|these)\b[^.\n]{0,20}\b(instructions?|prompts?|rules|directions|guidelines|context)\b/i,
  /\byou are (now |no longer )?(an? |the )?(ai|a\.i\.|artificial intelligence|language model|llm|large language model|assistant|chatbot|bot|gemini|chatgpt|gpt|claude)\b/i,
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
// university.relations@, campus-recruiting@), never a personal one (jane.doe@) and never at a
// personal mail provider. Found by code in the page text before masking; the AI never sees them.
const ROLE_WORDS = new Set([
  "careers", "career", "jobs", "job", "recruiting", "recruitment", "recruiters", "recruiter", "campus", "university", "universities",
  "college", "colleges", "relations", "students", "student", "early", "talent", "internships", "internship", "interns", "intern",
  "programs", "program", "sponsorship", "sponsorships", "sponsor", "sponsors", "giving", "donations", "donate", "foundation",
  "community", "communities", "events", "event", "partnerships", "partnership", "partners", "partner", "outreach", "info", "contact",
  "contactus", "hello", "inquiries", "enquiries", "diversity", "inclusion", "dei", "erg", "ergs", "grants", "grant", "philanthropy",
  "csr", "impact", "engagement", "education", "edu", "stem", "team", "office", "hr", "us", "relationsteam", "universityrelations",
  "campusrecruiting", "earlycareers", "studentprograms", "corporate", "social", "responsibility", "citizenship", "volunteer",
  "volunteering", "local", "site", "requests", "request", "support", "general", "media", "press", "news",
]);
const PERSONAL_PROVIDERS = /(^|\.)(gmail|googlemail|yahoo|ymail|outlook|hotmail|live|msn|icloud|me|mac|aol|proton|protonmail|pm|gmx|mail|zoho|yandex|fastmail|hey|tutanota|qq|163)\.[a-z.]+$/i;
const EMAIL = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+/g;

export function teamInboxes(text: string): string[] {
  const found = new Set<string>();
  for (const [address] of text.matchAll(EMAIL)) {
    const email = address.toLowerCase().replace(/\.+$/, "");
    const [local, domain] = email.split("@");
    if (!domain || PERSONAL_PROVIDERS.test(domain)) continue;
    const words = local.split(/[._+-]+/).filter(Boolean);
    if (words.length > 0 && words.every((w) => ROLE_WORDS.has(w))) found.add(email);
    if (found.size >= 10) break;
  }
  return [...found];
}
