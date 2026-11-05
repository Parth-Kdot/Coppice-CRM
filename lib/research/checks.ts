import { maskContactDetails, matchKey, quoteFound } from "@/lib/ai/text";
import type { Door } from "@/lib/research/doors";
import { maskPhones } from "@/lib/research/scan";
import { isApprovedHost, isSameSite } from "@/lib/research/urls";

// The checks on what the AI wrote for a research brief (lib/research/brief.ts). Model output is
// untrusted: anything that fails is dropped, never repaired.

export const PASSAGES_MAX = 25;
export const ITEMS_MAX = 12;

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
// a mark under one letter is read as the different site it is.
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
// ("2027", "24/7") never is.
function numericSite(token: string, next: string): string | null {
  const hex = /0x/i.test(token);
  if (!hex && !token.includes(".")) return null;
  const host = hostOf(token);
  if (!host || !/^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;
  const linkish = /^(?:\/|:\d)/.test(next);
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
// from an address, which callers treat as a refusal.
export function sitesIn(text: string): string[] | null {
  // Fullwidth and other compatibility forms ("ｅｖｉｌ．ｃｏｍ") become plain letters first.
  const line = text.normalize("NFKC").replace(IDNA_DOTS, ".");
  if (INVISIBLE.test(line) || DEFANGED.test(line)) return null;
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
    const host = numericSite(match[0], line.slice(end, end + 2));
    if (host) hosts.push(host);
  }
  for (const word of line.split(ADDRESS_END)) {
    const host = wordSite(word);
    if (host) hosts.push(host);
  }
  return hosts;
}

// A line of the brief (title, detail, deadline) may name a site only if it is one of the pages
// fetched, exactly, and may hold no contact details in any format. It is one line of plain text:
// no tabs or line breaks, which a browser also drops from an address pasted into it.
export function cleanLine(text: string, fetchedHosts: string[]): boolean {
  if (/\p{Cc}/u.test(text)) return false;
  if (maskPhones(maskContactDetails(text)) !== text || /\[(email|phone)\]|@/i.test(text)) return false;
  const sites = sitesIn(text);
  return sites !== null && sites.every((host) => isApprovedHost(host, fetchedHosts));
}

// A quote is copied from the page, so it may name the fetched site or its parent or subdomains
// ("acme.com" on careers.acme.com's page), but nothing else: an injected "apply at evil.example"
// can't ride along next to a suggested door.
export function cleanQuote(quote: string, fetchedHosts: string[]): boolean {
  const sites = sitesIn(quote);
  return sites !== null && sites.every((host) => isSameSite(host, fetchedHosts));
}

// ----- Passages and items -----

export function checkPassages(passages: Passage[], pages: Map<number, CheckedPage>): Passage[] {
  const seen = new Set<string>();
  return passages
    .map((p) => ({ ...p, quote: p.quote.trim() }))
    .filter((p) => {
      const page = pages.get(p.page);
      if (!page?.text || !quoteFound(p.quote, page.text, "")) return false;
      const key = matchKey(p.quote);
      return !seen.has(key) && Boolean(seen.add(key));
    })
    .slice(0, PASSAGES_MAX);
}

export function checkItems(items: DraftItem[], passages: Passage[], pages: Map<number, CheckedPage>): BriefItem[] {
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
    const key = matchKey(title);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push({ id: `i${kept.length + 1}`, door: item.door, title, detail, deadline, page: page.position, quote });
    if (kept.length >= ITEMS_MAX) break;
  }
  return kept;
}
