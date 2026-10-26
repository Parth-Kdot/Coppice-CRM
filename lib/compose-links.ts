// Links that open a draft in the officer's own mail app. The app never sends email (project rule
// 6): these only pre-fill a compose window, and the officer presses Send there.
//
// encodeURIComponent, never URLSearchParams: the latter turns spaces into "+", which Gmail and
// Outlook show literally. Line breaks in the recipient or subject could smuggle extra headers into
// a mailto link, so they're flattened.

// Past this, some browsers and mail apps cut a link off, so the body is left out and copied
// instead.
export const LINK_MAX = 2000;

export type Compose = { to: string; subject: string; body: string };
export type ComposeLinks = { gmail: string; outlook: string; mailto: string; bodyIncluded: boolean };

const oneLine = (text: string) => text.replace(/[\r\n]+/g, " ").trim();
const enc = encodeURIComponent;

function build({ to, subject, body }: Compose) {
  const t = enc(oneLine(to));
  const s = enc(oneLine(subject));
  // mailto bodies use CRLF line breaks (RFC 6068).
  const mailBody = body ? `&body=${enc(body.replace(/\r?\n/g, "\r\n"))}` : "";
  return {
    gmail: `https://mail.google.com/mail/?view=cm&fs=1&tf=cm&to=${t}&su=${s}${body ? `&body=${enc(body)}` : ""}`,
    // Purdue mail is Microsoft 365; this deeplink is the one that works for work and school accounts.
    outlook: `https://outlook.office.com/mail/deeplink/compose?to=${t}&subject=${s}${body ? `&body=${enc(body)}` : ""}`,
    mailto: `mailto:${t}?subject=${s}${mailBody}`,
  };
}

export function composeLinks(draft: Compose): ComposeLinks {
  const full = build(draft);
  if (Object.values(full).every((link) => link.length <= LINK_MAX)) return { ...full, bodyIncluded: true };
  return { ...build({ ...draft, body: "" }), bodyIncluded: false };
}
