// Settings shared by the auth config (lib/auth.ts), the MCP route (app/api/mcp) and the pages
// that explain it. Kept apart from lib/auth.ts so pages can import them without loading auth.

// What an assistant can ask for. coppice:read lets it look at the workspaces you turned MCP on
// for; coppice:write also lets it claim companies, log outreach and move stages as you. The
// others are the standard sign-in scopes MCP clients ask for (offline_access allows a refresh
// token, so the assistant doesn't send you back to the consent page every hour).
export const READ_SCOPE = "coppice:read";
export const WRITE_SCOPE = "coppice:write";
export const MCP_SCOPES = ["openid", "profile", "email", "offline_access", READ_SCOPE, WRITE_SCOPE] as const;

// Plain words for the consent page, one line per scope.
export const SCOPE_LABELS: Record<string, string> = {
  openid: "Know who you are on Coppice",
  profile: "See your name and picture",
  email: "See your email address",
  offline_access: "Stay connected without asking again (access renews every hour)",
  [READ_SCOPE]: "Read companies, contacts, notes, outreach history, the follow-up queue and claims in workspaces that allow assistants",
  [WRITE_SCOPE]: "Claim companies, log outreach and move stages as you, in workspaces that allow assistants",
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
