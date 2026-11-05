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
// "bit.do/acme"), or a numeric address. A host-shaped token is labels joined by dots, ending in a
// label of letters only, so "2.5" and "U.S." are not hosts.
const SCHEME_URL = /[\p{L}][\p{L}\p{N}+.-]*:\/\/[^\s"'<>]*/giu;
const HOSTLIKE = /(?<![\p{L}\p{N}-])(?:[\p{L}\p{N}-]+\.)+\p{L}{2,}(?![\p{L}\p{N}-])/giu;
const IPV4 = /(?<![\d.])\d{1,3}(?:\.\d{1,3}){3}(?![\d.])/g;
// Addresses written so a filter won't see them: "evil[.]com", "evil(dot)com", "hxxp://".
const DEFANGED = /[[({]\s*(?:\.|dot)\s*[\])}]|\bhxxps?\b|\s(?:dot|punkt)\s+\p{L}{2,}\b/iu;

function hostOf(link: string): string | null {
  try {
    const url = new URL(/^[\p{L}][\p{L}\p{N}+.-]*:\/\//iu.test(link) ? link : `https://${link}`);
    return url.protocol === "http:" || url.protocol === "https:" ? url.hostname : null;
  } catch {
    return null;
  }
}

// Every site the text names, as hostnames; null when it names one that can't be read as a web
// host at all (another scheme, a defanged address), which callers treat as a refusal.
export function sitesIn(text: string): string[] | null {
  // Fullwidth and other compatibility forms ("ｅｖｉｌ．ｃｏｍ") become plain letters first.
  const line = text.normalize("NFKC");
  if (DEFANGED.test(line)) return null;
  const hosts: string[] = [];
  for (const pattern of [SCHEME_URL, HOSTLIKE, IPV4]) {
    for (const [link] of line.matchAll(pattern)) {
      const host = hostOf(link);
      if (!host) return null;
      hosts.push(host);
    }
  }
  return hosts;
}

// A line of the brief (title, detail, deadline) may name a site only if it is one of the pages
// fetched, exactly, and may hold no contact details in any format.
export function cleanLine(text: string, fetchedHosts: string[]): boolean {
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
