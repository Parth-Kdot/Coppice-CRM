// Text that reads as a question for Ask Coppice rather than the name of a company or a page: it ends
// with "?" or has four or more words. The search palette offers "Ask Coppice: <text>" first for it.
export const asksQuestion = (text: string): boolean => {
  const trimmed = text.trim();
  return trimmed.endsWith("?") || trimmed.split(/\s+/).filter(Boolean).length >= 4;
};

// A question handed over in the address (?q=) goes into the question box, trimmed and cut to the
// longest question the server takes. It is never asked on its own: a link someone else wrote must not
// spend an AI call or put words in the person's mouth, so they press Ask.
export const handedOverDraft = (param: string | null, max: number): string => (param ?? "").replace(/\s+/g, " ").trim().slice(0, max);
