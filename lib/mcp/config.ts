// Settings shared by the auth config (lib/auth.ts), the MCP route (app/api/mcp) and the pages
// that explain it. Kept apart from lib/auth.ts so pages can import them without loading auth.

// What an assistant can ask for. coppice:read lets it look at the workspaces that allow assistants,
// as you can see them; coppice:write also lets it make changes as you (companies, contacts, claims,
// outreach, follow-ups, stages, imports and, for owners, facts, templates, experiments and the
// handoff). Every change an assistant makes is listed in Settings for the whole workspace, except that
// lines about who is leaving show to owners only. The others are the standard sign-in scopes MCP
// clients ask for (offline_access allows a refresh token, so the assistant doesn't send you back to
// the consent page every hour).
export const READ_SCOPE = "coppice:read";
export const WRITE_SCOPE = "coppice:write";
export const MCP_SCOPES = ["openid", "profile", "email", "offline_access", READ_SCOPE, WRITE_SCOPE] as const;

// Plain words for the consent page, one line per scope.
export const SCOPE_LABELS: Record<string, string> = {
  openid: "Know who you are on Coppice",
  profile: "See your name and picture",
  email: "See your email address",
  offline_access: "Stay connected without asking again (access renews every hour)",
  [READ_SCOPE]:
    "Read what you can see in workspaces that allow assistants: companies, contacts, notes, the values a change replaced in the last hour, outreach history, claims, the follow-up queue, members' names (owners also see emails), facts, templates, stats, research briefs and the year-end handoff",
  [WRITE_SCOPE]:
    "Make changes as you in workspaces that allow assistants: add and edit companies and contacts and put back a value changed in the last hour, claim and release, log outreach, set follow-up dates and stages, resolve duplicates and import companies. For owners also facts, templates, research pages, template experiments and the handoff. Permanent deletes happen only after you agree. Every change is listed in Settings, and lines about who is leaving show to owners only",
};

// The site's public address. BETTER_AUTH_URL is already required for Google sign-in; locally it
// falls back to the dev server.
export function appUrl(): string {
  return process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
}

// The MCP server's address, which is also the "resource" every assistant token is bound to.
// A token for any other address is refused.
export function mcpResourceUrl(): string {
  return new URL("/api/mcp", appUrl()).toString();
}
