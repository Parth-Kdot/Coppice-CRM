import { oauthScopeListSchema } from "@/lib/validation";

// Limits on what the OAuth endpoints (/api/auth/oauth2/*) accept. The plugin stores what it is sent
// (client metadata on registration, the scope list on every consent, code and token row), and the
// token endpoint needs no session, only a refresh token, so without these one address could fill
// the database with megabyte-sized rows. Nothing here is OAuth logic: it bounds the input before
// the plugin sees it.
// - Every POST body is capped (checked in app/api/auth/[...all]/route.ts, before Better Auth reads
//   it). Real bodies are far smaller: a consent is about 1 KB, a token request a few hundred bytes.
// - A scope list may name each scope once, and no more scopes than Coppice defines.
// - On open registration, which needs no account: client_name is capped, since it is shown on the
//   consent page, and backchannel_logout_uri and jwks_uri are refused: the server would later send
//   requests to those addresses, and no MCP client needs them.

export const OAUTH_PATH_PREFIX = "/api/auth/oauth2/";
export const REGISTRATION_PATH = "/api/auth/oauth2/register";
export const OAUTH_BODY_LIMIT = 16 * 1024;
export const CLIENT_NAME_LIMIT = 100;
const REFUSED_FIELDS = ["backchannel_logout_uri", "jwks_uri"] as const;

// The Better Auth paths (relative to /api/auth) whose scope list is checked.
export const SCOPE_CHECKED_PATHS = new Set(["/oauth2/authorize", "/oauth2/consent", "/oauth2/token"]);

// What is wrong with a registration body, or null if these limits allow it. The plugin then checks
// everything else (redirect URIs, grants, skip_consent and so on).
export function registrationProblem(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const fields = body as Record<string, unknown>;
  if (typeof fields.client_name === "string" && fields.client_name.length > CLIENT_NAME_LIMIT) {
    return `client_name can be at most ${CLIENT_NAME_LIMIT} characters.`;
  }
  for (const field of REFUSED_FIELDS) {
    if (fields[field] !== undefined) return `${field} is not accepted by Coppice.`;
  }
  return null;
}

// What is wrong with the scope list in an authorize, consent or token request (from the query on
// a GET, the body on a POST), or null if there is none or it is allowed. The plugin then checks
// that each name is one the client may have.
export function scopeProblem(...sources: unknown[]): string | null {
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    const scope = (source as Record<string, unknown>).scope;
    if (scope === undefined) continue;
    const parsed = oauthScopeListSchema.safeParse(scope);
    if (!parsed.success) return parsed.error.issues[0]?.message ?? "The scope list is not accepted.";
  }
  return null;
}
