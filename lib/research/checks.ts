import { maskPhones } from "@/lib/ai/phones";
import { maskContactDetails, matchKey, quoteFound } from "@/lib/ai/text";
import type { Door } from "@/lib/research/doors";
import { isApprovedHost, isSameSite } from "@/lib/research/urls";

// The checks on what the AI wrote for a research brief (lib/research/brief.ts). Model output is
// untrusted: anything that fails is dropped, never repaired.

const PASSAGES_MAX = 25;
const ITEMS_MAX = 12;

// A page as the checks see it: its number in the prompt, where it was fetched from, and the
// stored text the AI was shown (null when it was skipped).
export type CheckedPage = { position: number; url: string; finalUrl: string | null; text: string | null };
export type Passage = { page: number; door: Door; quote: string };
export type DraftItem = { door: Door; title: string; detail: string; deadline: string | null; passage: number; quote: string };
export type BriefItem = { id: string; door: Door; title: string; detail: string; deadline: string | null; page: number; quote: string };

// ----- Sites named in a line -----

// Anything that names a site: a web address with any scheme ("https://", "ftp://"), and any
// host-shaped token, whatever its ending ("acme-giving.xyz/apply", "acme.de", "give.acme.foundation",
// "bit.do/acme", "acme-giving.xn--p1ai"), or a numeric address in any form a browser accepts. A
// host-shaped token is labels joined by dots, ending in a label of letters only (or a punycode
// "xn--" label), so "2.5" and "U.S." are not hosts. Labels take combining marks too, so "acme" with
// a mark under one letter is read as the different site it is. A percent escape ("%2E") is
// refused outright: a browser decodes it in a host, so "acme.org%2Eevil%2Ecom" goes to
// acme.org.evil.com.
const SCHEME_URL = /[\p{L}][\p{L}\p{N}+.-]*:\/\/[^\s"'<>]*/giu;
const HOSTLIKE = /(?<![\p{L}\p{M}\p{N}_-])(?:[\p{L}\p{M}\p{N}_-]+\.)+(?:\p{L}[\p{L}\p{M}]+|xn--[\p{L}\p{N}-]+)(?![\p{L}\p{M}\p{N}_-])/giu;
// Numbers joined by dots, or one hex number: "93.184.215.14", and the forms a browser also reads
// as that address: hex ("0x5d.0xb8.0xd7.0x0e", "0x5db8d70e"), octal ("0135.0270.0327.016") and
// short ("93.184.55054", "93.12113678"). Which of them count as a site is decided below.
const NUMERIC = /(?<![\p{L}\p{M}\p{N}_.-])(?:0x[0-9a-f]*|\d+)(?:\.(?:0x[0-9a-f]*|\d+)){0,3}(?!\.?[\p{L}\p{M}\p{N}_-])/giu;
const IPV6 = /\[[0-9a-f.]*:[0-9a-f:.]*\]/gi;
// Addresses written so a filter won't see them: "evil[.]com", "evil(dot)com", "hxxp://".
const DEFANGED = /[[({]\s*(?:\.|dot)\s*[\])}]|\bhxxps?\b|\s(?:dot|punkt)\s+\p{L}{2,}\b/iu;
// Characters a browser drops from a web address but a reader never sees: soft hyphen (which a page
// can write as "&#173;"), zero-width space, word joiner, variation selectors ...
const INVISIBLE = /\p{Default_Ignorable_Code_Point}/u;
// A percent escape, which a browser decodes in a host before reading it ("evil%2Ecom", "%78yz").
const PERCENT_ESCAPE = /%[0-9a-f]{2}/i;
// The dots a browser reads as a dot between labels ("acme-giving。xyz"), besides ".": NFKC
// turns the fullwidth one into ".", but the halfwidth one only into the ideographic one.
const IDNA_DOTS = /[\u3002\uff0e\uff61]/g;
// Numbers that are dates or decimals, not addresses: "15.03.2027", "2027.03.15", "03.2027", "2.5", "0.75".
const NUMBER_SHAPE = /^(?:\d{1,2}\.\d{1,2}\.\d{2,4}|\d{4}\.\d{1,2}\.\d{1,2}|\d{1,2}\.\d{4}|(?:0|[1-9]\d*)\.\d+)$/;

function hostOf(link: string): string | null {
  try {
    const url = new URL(/^[\p{L}][\p{L}\p{N}+.-]*:\/\//iu.test(link) ? link : `https://${link}`);
    return url.protocol === "http:" || url.protocol === "https:" ? url.hostname : null;
  } catch {
    return null;
  }
}

// A numeric token is a site when a browser would read it as an IP address and it isn't plainly a
// date or a decimal number. Hex is always a site, and so is a date or decimal followed by a path
// or a port ("2.5/apply"), since that is written to be typed into a browser. A plain whole number
// is one only when a path or port follows it and it reads as an address past 0.255.255.255
// ("16909060/apply" is 1.2.3.4), so "2027", "24/7" and "50/50" are not.
function numericSite(token: string, next: string): string | null {
  const hex = /0x/i.test(token);
  const plain = !hex && !token.includes(".");
  const host = hostOf(token);
  if (!host || !/^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;
  // A browser drops one trailing dot from an address ("16909060./apply").
  const linkish = /^\.?(?:[/\\]|[?#]\S|:[\d/\\?#])/.test(next);
  if (plain) return linkish && !host.startsWith("0.") ? host : null;
  return hex || linkish || !NUMBER_SHAPE.test(token) ? host : null;
}

// Every word with a dot in it, read the way a browser reads an address: the text is split where an
// address ends (spaces, "/", "?", "#", "@", ":" ...), punctuation around a word is trimmed, and
// what is left is parsed as a host. It is a site if the browser gets a name ending in letters or
// a punycode label ("evil!.com", "evil¡.com" and "evil.c¡om" all are). This catches what the
// patterns above would split apart.
const ADDRESS_END = /[\s/?#@:<>[\]\\^|%]+/u;
const EDGES = /^[^\p{L}\p{N}]+|[^\p{L}\p{M}\p{N}]+$/gu;

function wordSite(word: string): string | null {
  const token = word.replace(EDGES, "");
  if (!token.includes(".")) return null;
  const host = hostOf(token);
  if (!host || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;
  const labels = host.split(".");
  if (labels.some((l) => !l)) return null;
  return /^(?:[a-z]{2,}|xn--[a-z0-9-]+)$/.test(labels[labels.length - 1]) ? host : null;
}

// Every site the text names, as hostnames; null when it names one that can't be read as a web
// host at all (another scheme, a defanged address), or holds a character a browser would drop
// from an address or a percent escape it would decode, which callers treat as a refusal.
export function sitesIn(text: string): string[] | null {
  // Fullwidth and other compatibility forms ("ｅｖｉｌ．ｃｏｍ") become plain letters first.
  const line = text.normalize("NFKC").replace(IDNA_DOTS, ".");
  if (INVISIBLE.test(line) || DEFANGED.test(line) || PERCENT_ESCAPE.test(line)) return null;
  const hosts: string[] = [];
  for (const pattern of [SCHEME_URL, HOSTLIKE, IPV6]) {
    for (const [link] of line.matchAll(pattern)) {
      const host = hostOf(link);
      if (!host) return null;
      hosts.push(host);
    }
  }
  for (const match of line.matchAll(NUMERIC)) {
    const end = (match.index ?? 0) + match[0].length;
    const host = numericSite(match[0], line.slice(end, end + 3));
    if (host) hosts.push(host);
  }
  for (const word of line.split(ADDRESS_END)) {
    const host = wordSite(word);
    if (host) hosts.push(host);
  }
  return hosts;
}

// A line of the brief (title, detail, deadline) may name a site only if it is one of the pages
// fetched, exactly, and may hold no contact details in any format (fullwidth ones included, read
// as plain ones). It is one line of plain text: no tabs or line breaks, which a browser also drops
// from an address pasted into it.
export function cleanLine(text: string, fetchedHosts: string[]): boolean {
  if (/\p{Cc}/u.test(text)) return false;
  const plain = text.normalize("NFKC");
  if (maskPhones(maskContactDetails(plain)) !== plain || /\[(email|phone)\]|@/i.test(plain)) return false;
  const sites = sitesIn(text);
  return sites !== null && sites.every((host) => isApprovedHost(host, fetchedHosts));
}

// A quote is copied from the page, so it may name the fetched site or its parent or subdomains
// ("acme.com" on careers.acme.com's page), but nothing else: an injected "apply at evil.example"
// can't ride along next to a suggested door. Like a line, it holds no tabs or line breaks, which
// would split "evil<br>.com" for this check while a browser joins it again.
export function cleanQuote(quote: string, fetchedHosts: string[]): boolean {
  if (/\p{Cc}/u.test(quote)) return false;
  const sites = sitesIn(quote);
  return sites !== null && sites.every((host) => isSameSite(host, fetchedHosts));
}

// ----- People's names -----
//
// A brief is about a company's channels, never its people, and the prompt says so; this enforces it
// in code. A passage or item that names an individual is dropped, so a name on a public page never
// reaches the writing call (RESEARCH_BRIEF) or the brief. A passage holding a masked "[email]" or
// "[phone]" is about reaching a person too, and is dropped; team inboxes are kept, since the page
// text calls them "[team inbox]" and the brief lists them itself (lib/research/brief.ts).
//
// The test is simple and errs on the side of dropping: a title (Dr., Ms. ...) before a capitalized
// word, or two capitalized words in a row ("Jane Doe", "Jane Q. Doe") where neither is part of the
// company's name or a word that names a team, a role, a program, a place or a time ("University
// Relations", "Women in Engineering", "West Lafayette", "Spring Career Fair"). A real channel named
// after a person ("Grace Hopper Celebration") is dropped too; the page is still linked.
const NAME_WORD = /^\p{Lu}\p{Ll}+(?:[-'’]\p{Lu}?\p{Ll}+)*$/u;
const INITIAL = /^\p{Lu}$/u;
const TITLES = new Set(["mr", "mrs", "ms", "mx", "dr", "prof", "professor", "sir", "dame"]);
const NOT_NAMES = new Set(
  (
    // teams, roles and programs
    "university universities college colleges campus campuses career careers recruiting recruitment recruiter recruiters relations relation " +
    "program programs programme team teams office offices department division group groups network networks council committee board " +
    "foundation fund funds giving gift gifts grant grants sponsorship sponsorships sponsor sponsors partner partners partnership partnerships " +
    "employee employees resource resources talent early student students intern interns internship internships fellowship fellowships " +
    "scholarship scholarships alumni community communities outreach engagement diversity inclusion equity belonging impact philanthropy " +
    "corporate social responsibility citizenship volunteer volunteering events event fair fairs expo summit conference day days week weekend " +
    "women woman men veterans veteran black hispanic latino latina latinx asian pacific islander native indigenous pride lgbtq disability " +
    "engineering engineer engineers science sciences technology technologies tech research development innovation design product products " +
    "software hardware data analytics business marketing sales finance financial operations manufacturing supply chain legal human people " +
    "services service solutions systems global national international regional local america american americas north south east west " +
    "northern southern eastern western central midwest new old saint st fort port lake mount mountain river valley city county state states " +
    "united kingdom republic center centre hall park street avenue road drive lane building tower plaza campus headquarters hq site sites " +
    "lab labs laboratory laboratories studio institute academy school schools society association club clubs chapter chapters " +
    "inc incorporated corp corporation company companies co llc ltd limited group holdings enterprises " +
    "january february march july september october november december spring summer fall autumn winter " +
    "monday tuesday wednesday thursday friday saturday sunday today annual year years month months history heritage awareness " +
    "the a an our your their we you they this that these those its for and of in on at to with from by " +
    "apply visit contact join learn read see email call find meet explore discover submit register sign request follow get start view " +
    "click download check send share connect support ask welcome thank thanks please note deadline deadlines open opens closes due " +
    "application applications portal portals form forms page pages website online web home about overview faq faqs news press media " +
    "matching match volunteer grants request requests proposal proposals guidelines eligibility criteria opportunity opportunities " +
    "general manager director coordinator specialist lead leads head chief officer president vice senior junior associate assistant " +
    "executive representative ambassador ambassadors liaison advisor adviser counselor chair"
  ).split(" "),
);

// Whether the text names an individual person, by the test above. `company` is the company's name,
// whose words are never a person's ("Eli Lilly").
export function namesPerson(text: string, company = ""): boolean {
  const companyWords = new Set(company.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  // "Women's" is checked as "women".
  const ordinary = (word: string) => {
    const key = word.toLowerCase().replace(/['’]s$/, "");
    return NOT_NAMES.has(key) || companyWords.has(key);
  };
  const line = text.normalize("NFKC");
  const tokens = [...line.matchAll(/[\p{L}\p{M}][\p{L}\p{M}'’-]*/gu)].map((m) => ({
    word: m[0].replace(/['’-]+$/, ""),
    start: m.index ?? 0,
    end: (m.index ?? 0) + m[0].length,
  }));
  const gap = (i: number) => line.slice(tokens[i].end, tokens[i + 1]?.start ?? tokens[i].end);
  for (let i = 0; i < tokens.length - 1; i++) {
    const { word } = tokens[i];
    // "Dr. Patel", "Ms Rivera"
    if (TITLES.has(word.toLowerCase()) && /^\.?\s+$/.test(gap(i)) && NAME_WORD.test(tokens[i + 1].word)) return true;
    if (!NAME_WORD.test(word) || ordinary(word)) continue;
    let j = i + 1;
    // A middle initial: "Jane Q. Doe".
    if (INITIAL.test(tokens[j].word) && /^\s+$/.test(gap(i)) && /^\.\s+$/.test(gap(j)) && tokens[j + 1]) j++;
    else if (!/^\s+$/.test(gap(i))) continue;
    const next = tokens[j].word;
    if (NAME_WORD.test(next) && !ordinary(next)) return true;
  }
  return false;
}

// A masked contact detail of a person (a team inbox is "[team inbox]", which stays).
const PERSON_CONTACT = /\[(?:email|phone)\]/i;

// ----- Passages and items -----

export function checkPassages(passages: Passage[], pages: Map<number, CheckedPage>, company = ""): Passage[] {
  const seen = new Set<string>();
  return passages
    .map((p) => ({ ...p, quote: p.quote.trim() }))
    .filter((p) => {
      const page = pages.get(p.page);
      if (!page?.text || !quoteFound(p.quote, page.text, "")) return false;
      if (PERSON_CONTACT.test(p.quote) || namesPerson(p.quote, company)) return false;
      const key = matchKey(p.quote);
      return !seen.has(key) && Boolean(seen.add(key));
    })
    .slice(0, PASSAGES_MAX);
}

export function checkItems(items: DraftItem[], passages: Passage[], pages: Map<number, CheckedPage>, company = ""): BriefItem[] {
  const fetchedHosts = [...pages.values()].flatMap((p) => (p.finalUrl ? [new URL(p.finalUrl).hostname, new URL(p.url).hostname] : []));
  const seen = new Set<string>();
  const kept: BriefItem[] = [];
  for (const item of items) {
    const passage = passages[item.passage - 1];
    const page = passage ? pages.get(passage.page) : undefined;
    if (!passage || !page?.text) continue;
    const title = item.title.trim();
    const detail = item.detail.trim();
    const deadline = item.deadline?.trim() || null;
    const quote = item.quote.trim();
    if (!title || !detail) continue;
    // The quote is on the page it cites, and every number in the line is in the quote.
    if (!quoteFound(quote, page.text, `${title} ${detail} ${deadline ?? ""}`)) continue;
    // A deadline must be stated in the quote, word for word.
    if (deadline && !matchKey(quote).includes(matchKey(deadline))) continue;
    if (![title, detail, deadline ?? ""].every((line) => cleanLine(line, fetchedHosts))) continue;
    if (!cleanQuote(quote, fetchedHosts)) continue;
    // Never a person: not in the quote, the title or the detail.
    if (PERSON_CONTACT.test(quote) || [quote, title, detail].some((line) => namesPerson(line, company))) continue;
    const key = matchKey(title);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push({ id: `i${kept.length + 1}`, door: item.door, title, detail, deadline, page: page.position, quote });
    if (kept.length >= ITEMS_MAX) break;
  }
  return kept;
}
