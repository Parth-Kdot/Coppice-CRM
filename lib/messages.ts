// Refusals that several places say in the same words. Pure text, so it can be imported anywhere.

// "Company not found.", "Workspace not found.": the answer for an id that matches nothing the person
// may see, so a stranger can't tell a missing record from one in someone else's workspace.
export const notFoundMessage = (noun: string) => `${noun} not found.`;
export const notFound = (noun: string) => ({ ok: false, error: notFoundMessage(noun) }) as const;

// The answer to an officer who tries an owner-only change (the templates have their own wording).
export const OWNERS_ONLY = { ok: false, error: "Only the workspace owner can do that." } as const;
