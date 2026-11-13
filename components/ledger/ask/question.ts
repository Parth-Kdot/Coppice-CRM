// Text that reads as a question for Ask Coppice rather than the name of a company or a page: it ends
// with "?" or has four or more words. The search palette offers "Ask Coppice: <text>" first for it.
export const asksQuestion = (text: string): boolean => {
  const trimmed = text.trim();
  return trimmed.endsWith("?") || trimmed.split(/\s+/).filter(Boolean).length >= 4;
};
