// Limits on open client registration (POST /api/auth/oauth2/register). It is the one write
// endpoint on the site that needs no account, and the OAuth plugin stores whatever metadata it is
// sent, so without these one address could fill the database with megabyte-sized client rows.
// Nothing here is OAuth logic: it bounds the input before the plugin sees it.
// - The body is capped (checked in app/api/auth/[...all]/route.ts, before Better Auth reads it).
// - client_name is capped, since it is shown on the consent page.
// - backchannel_logout_uri and jwks_uri are refused: the server would later send requests to
//   those addresses, and no MCP client needs them.

export const REGISTRATION_PATH = "/api/auth/oauth2/register";
export const REGISTRATION_BODY_LIMIT = 16 * 1024;
export const CLIENT_NAME_LIMIT = 100;
const REFUSED_FIELDS = ["backchannel_logout_uri", "jwks_uri"] as const;

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
