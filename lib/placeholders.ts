// The names in an AI draft. The model writes {{firstName}}, {{senderName}} and {{orgName}}, and
// code fills them in, so Gemini's free tier never sees a person's name. Before an edited draft
// goes back to the AI for checking, unfill() turns the names back into placeholders.

export const PLACEHOLDERS = ["firstName", "senderName", "orgName"] as const;
export type Names = Record<(typeof PLACEHOLDERS)[number], string>;

export const fill = (text: string, names: Names) => text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: keyof Names) => names[key]);

// Longest name first, so "Sam Lee" is replaced before "Sam". A null name is left alone: with no
// contact the greeting says "there", which must not turn every "there" into a placeholder.
export function unfill(text: string, names: Partial<Record<keyof Names, string | null>>): string {
  const pairs = Object.entries(names)
    .filter((pair): pair is [string, string] => Boolean(pair[1]?.trim()))
    .sort((a, b) => b[1].length - a[1].length);
  return pairs.reduce((out, [key, value]) => out.split(value).join(`{{${key}}}`), text);
}
