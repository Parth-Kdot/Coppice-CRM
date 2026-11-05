// Readable text from a fetched page. No parser library and nothing is ever executed: one linear
// pass drops comments and the contents of script, style and other non-text elements, turns block
// elements into line breaks, removes every other tag, and decodes character references. The
// result is plain text; it is only ever shown as text (React escapes it) or sent to the AI as data.

// Elements whose contents are never text a person reads on the page.
const SKIP = new Set(["script", "style", "noscript", "template", "svg", "math", "iframe", "object", "embed", "canvas", "select", "textarea"]);
// Elements that start a new line.
const BLOCK = new Set([
  "address", "article", "aside", "blockquote", "br", "dd", "details", "div", "dl", "dt", "figcaption", "figure", "footer",
  "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "main", "nav", "ol", "p", "pre", "section", "summary",
  "table", "tbody", "thead", "title", "tr", "ul",
]);

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ensp: " ", emsp: " ", thinsp: " ",
  ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", sbquo: "‚", ldquo: "“", rdquo: "”", bdquo: "„",
  hellip: "…", bull: "•", middot: "·", copy: "©", reg: "®", trade: "™", deg: "°", laquo: "«", raquo: "»",
  times: "×", divide: "÷", euro: "€", pound: "£", cent: "¢", yen: "¥", sect: "§", para: "¶",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", agrave: "à", egrave: "è", ograve: "ò",
  acirc: "â", ecirc: "ê", ocirc: "ô", auml: "ä", euml: "ë", ouml: "ö", uuml: "ü", ntilde: "ñ", ccedil: "ç",
  Aacute: "Á", Eacute: "É", Oacute: "Ó", Uacute: "Ú", Auml: "Ä", Ouml: "Ö", Uuml: "Ü", Ntilde: "Ñ", szlig: "ß",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z]{2,8});?/g, (whole, ref: string) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      // Nothing outside Unicode, no surrogates and no NUL.
      if (!code || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return "�";
      return String.fromCodePoint(code);
    }
    return NAMED[ref] ?? whole;
  });
}

// The tag name at `at` (just after "<" or "</"), lowercased.
function tagName(html: string, at: number): string {
  let end = at;
  while (end < html.length && /[A-Za-z0-9-]/.test(html[end])) end++;
  return html.slice(at, end).toLowerCase();
}

export function htmlToText(html: string): string {
  const lower = html.toLowerCase();
  const out: string[] = [];
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt < 0) {
      out.push(html.slice(i));
      break;
    }
    out.push(html.slice(i, lt));
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      i = end < 0 ? html.length : end + 3;
      continue;
    }
    const closing = html[lt + 1] === "/";
    const name = tagName(html, lt + (closing ? 2 : 1));
    if (!name) {
      // "<!DOCTYPE", "<?xml", or a bare "<" in text: skip a declaration, keep a lone "<".
      if (html[lt + 1] === "!" || html[lt + 1] === "?") {
        const end = html.indexOf(">", lt);
        i = end < 0 ? html.length : end + 1;
      } else {
        out.push("<");
        i = lt + 1;
      }
      continue;
    }
    const tagEnd = html.indexOf(">", lt);
    if (tagEnd < 0) break;
    i = tagEnd + 1;
    if (!closing && SKIP.has(name) && html[tagEnd - 1] !== "/") {
      // Jump past the matching close tag (no nesting to track: these hold no real markup).
      const close = lower.indexOf(`</${name}`, i);
      if (close < 0) break;
      const closeEnd = html.indexOf(">", close);
      i = closeEnd < 0 ? html.length : closeEnd + 1;
      continue;
    }
    if (BLOCK.has(name)) out.push("\n");
    else if (name === "td" || name === "th") out.push(" ");
  }
  return tidy(decodeEntities(out.join("")));
}

// Spaces collapsed, each line trimmed, no blank lines.
export function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}
