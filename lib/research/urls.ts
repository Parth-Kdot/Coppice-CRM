// The rules a research URL must pass before the server will fetch it: the owner's form checks them
// when a source is added (lib/validation.ts), and the fetcher checks them again on every request
// and every redirect (lib/research/fetch.ts). Pure code with no Node imports, so the browser
// bundle can share it. Address checks (private ranges, DNS) live in the fetcher.

export const SOURCE_URL_MAX = 500;
// Redirect targets can be longer than what an owner types, but not unbounded.
const URL_MAX = 2000;

// Why a URL was refused or a page was skipped. Shown to people through SKIP_MESSAGES.
export type SkipReason =
  | "invalid"
  | "scheme"
  | "credentials"
  | "port"
  | "ip_literal"
  | "local_host"
  | "blocked_site"
  | "too_long"
  | "not_approved"
  | "dns"
  | "private_address"
  | "too_many_redirects"
  | "bad_redirect"
  | "timeout"
  | "too_large"
  | "content_type"
  | "http_status"
  | "robots"
  | "robots_unreachable"
  | "network"
  | "empty";

export const SKIP_MESSAGES: Record<SkipReason, string> = {
  invalid: "That isn't a web address.",
  scheme: "Only http and https pages can be read.",
  credentials: "Addresses with a user name or password in them are refused.",
  port: "Only the standard web ports are used.",
  ip_literal: "Use the site's name, not a numeric IP address.",
  local_host: "That isn't a public website.",
  blocked_site: "Coppice doesn't read LinkedIn or people-search sites.",
  too_long: "The address is too long.",
  not_approved: "It redirected to a site that isn't on the approved list.",
  dns: "The site's name couldn't be looked up.",
  private_address: "The site points at a private or reserved network address.",
  too_many_redirects: "It redirected too many times.",
  bad_redirect: "It sent a broken redirect.",
  timeout: "The site took too long to answer.",
  too_large: "The page is over 2 MB.",
  content_type: "It isn't a web page or plain text.",
  http_status: "The site didn't return the page.",
  robots: "The site's robots.txt asks crawlers not to read this page.",
  robots_unreachable: "The site's robots.txt couldn't be read, so the page was left alone.",
  network: "The site couldn't be reached.",
  empty: "The page had no readable text.",
};

// LinkedIn, people-search sites and contact-data brokers. Never fetched, even if an owner lists
// one: briefs are about a company's official doors, not about finding people.
const BLOCKED_DOMAINS = [
  "linkedin.com",
  "lnkd.in",
  "licdn.com",
  "spokeo.com",
  "whitepages.com",
  "beenverified.com",
  "truepeoplesearch.com",
  "fastpeoplesearch.com",
  "peoplefinders.com",
  "peoplelooker.com",
  "peoplesearchnow.com",
  "searchpeoplefree.com",
  "intelius.com",
  "instantcheckmate.com",
  "truthfinder.com",
  "radaris.com",
  "mylife.com",
  "pipl.com",
  "zabasearch.com",
  "peekyou.com",
  "thatsthem.com",
  "usphonebook.com",
  "ussearch.com",
  "familytreenow.com",
  "clustrmaps.com",
  "nuwber.com",
  "addresses.com",
  "cyberbackgroundchecks.com",
  "smartbackgroundchecks.com",
  "advancedbackgroundchecks.com",
  "publicrecordsnow.com",
  "idcrawl.com",
  "zoominfo.com",
  "rocketreach.co",
  "apollo.io",
  "contactout.com",
  "signalhire.com",
  "lusha.com",
  "hunter.io",
  "seamless.ai",
] as const;

// Lowercase, without a trailing dot ("Example.com." and "example.com" are one host).
const normalizeHost = (host: string) => host.toLowerCase().replace(/\.+$/, "");

// After WHATWG parsing every IPv4 spelling (0x7f.1, 2130706433, 017700000001) has become dotted
// decimal, and IPv6 is in brackets, so these two shapes cover every IP literal.
function isIpLiteral(host: string): boolean {
  return host.startsWith("[") || /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

function isBlockedDomain(host: string): boolean {
  const h = normalizeHost(host);
  return BLOCKED_DOMAINS.some((d) => h === d || h.endsWith(`.${d}`));
}

// Names that only mean something on a private network.
function isLocalName(host: string): boolean {
  const h = normalizeHost(host);
  if (!h.includes(".")) return true;
  return /(^|\.)(localhost|local|internal|intranet|lan|home\.arpa|localdomain|corp)$/.test(h);
}

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: SkipReason };

// Everything that can be said about a URL without looking anything up. Called on the owner's
// input and again on every request and redirect.
export function checkUrl(input: string | URL): UrlCheck {
  const text = typeof input === "string" ? input : input.href;
  if (text.length > URL_MAX) return { ok: false, reason: "too_long" };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, reason: "scheme" };
  if (url.username || url.password) return { ok: false, reason: "credentials" };
  // URL drops a port that is the scheme's default (":443" on https), so any port left is non-standard.
  if (url.port !== "") return { ok: false, reason: "port" };
  if (isIpLiteral(url.hostname)) return { ok: false, reason: "ip_literal" };
  if (isLocalName(url.hostname)) return { ok: false, reason: "local_host" };
  if (isBlockedDomain(url.hostname)) return { ok: false, reason: "blocked_site" };
  // The fragment never reaches the server; dropping it keeps stored URLs tidy.
  url.hash = "";
  return { ok: true, url };
}

// "careers.acme.com/students" is taken as https://careers.acme.com/students.
export function parseSourceUrl(raw: string): UrlCheck {
  const text = raw.trim();
  if (text.length > SOURCE_URL_MAX) return { ok: false, reason: "too_long" };
  // A scheme is a word and a colon not followed by a digit, so "acme.com:8080" is a host and port.
  const hasScheme = /^[a-z][a-z0-9+.-]*:(?!\d)/i.test(text);
  return checkUrl(hasScheme ? text : `https://${text}`);
}

// Hosts count as the same site with or without "www.", so https://acme.com redirecting to
// https://www.acme.com still counts as staying on the approved host.
const siteOf = (host: string) => normalizeHost(host).replace(/^www\./, "");

export function isApprovedHost(host: string, approvedHosts: Iterable<string>): boolean {
  const site = siteOf(host);
  for (const approved of approvedHosts) if (siteOf(approved) === site) return true;
  return false;
}

// Looser than isApprovedHost, for text that only names a site and is never fetched (a quote, a
// team inbox): the same host, or one is a subdomain of the other ("acme.com" and
// "careers.acme.com"). Never decides what the server fetches.
export function isSameSite(host: string, sites: Iterable<string>): boolean {
  const h = siteOf(host);
  for (const site of sites) {
    const s = siteOf(site);
    if (s && (h === s || h.endsWith(`.${s}`) || s.endsWith(`.${h}`))) return true;
  }
  return false;
}
