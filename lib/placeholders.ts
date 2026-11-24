// The names in an AI draft. The model writes {{firstName}}, {{senderName}} and {{orgName}}, and
// code fills them in, so the drafting prompt carries placeholders, not names. Before saved text that
// holds names goes back to the AI (an edited draft for the Claim Checker, an earlier draft's subject
// in a follow-up prompt), unfill() turns the names back into placeholders.

export const PLACEHOLDERS = ["firstName", "senderName", "orgName"] as const;
export type Names = Record<(typeof PLACEHOLDERS)[number], string>;

export const fill = (text: string, names: Names) => text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: keyof Names) => names[key]);

// Longest name first, so "Sam Lee" is replaced before "Sam". A null name is left alone: with no
// contact the greeting says "there", which must not turn every "there" into a placeholder.
// Whole words only: a contact named "Ed" leaves "Education" and "Edison" as they are (a letter or
// digit on either side means the name is part of another word).
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function unfill(text: string, names: Partial<Record<keyof Names, string | null>>): string {
  const pairs = Object.entries(names)
    .filter((pair): pair is [string, string] => Boolean(pair[1]?.trim()))
    .sort((a, b) => b[1].length - a[1].length);
  return pairs.reduce(
    (out, [key, value]) => out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(value)}(?![\\p{L}\\p{N}])`, "gu"), () => `{{${key}}}`),
    text,
  );
}

// Templates may use only the three placeholders above, so whatever fills them in later
// (an officer by hand, or the drafter) knows every one. Returns what is wrong, or null if nothing is.
export function placeholderProblem(text: string): string | null {
  const unknown = [...new Set([...text.matchAll(/\{\{([^{}]*)\}\}/g)].map((m) => m[1].trim()))].filter(
    (key) => !(PLACEHOLDERS as readonly string[]).includes(key),
  );
  if (unknown.length > 0) {
    const list = unknown.map((key) => `{{${key}}}`).join(", ");
    return `Templates can only use {{firstName}}, {{senderName}} and {{orgName}}. Fix ${list}.`;
  }
  if (/\{\{|\}\}/.test(text.replace(/\{\{[^{}]*\}\}/g, ""))) return "A placeholder isn't closed. Write it like {{firstName}}.";
  return null;
}
