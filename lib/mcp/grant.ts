import { prisma } from "@/lib/db";

// Whether the grant an assistant's access token came from still stands, checked on every MCP
// request (lib/mcp/handler.ts). Access tokens are self-contained JWTs, which Better Auth can't
// revoke, so without this a token kept working for up to its hour after the person's consent was
// removed, its refresh token was revoked (/oauth2/revoke), or the plugin's reuse detection threw the
// whole refresh family away (the stolen-token case). Two indexed reads of the plugin's own tables;
// nothing here issues, signs or changes a token.
// - The person's consent for this client must still exist, so deleting it disconnects the
//   assistant at once.
// - A token granted with offline_access must still have a live refresh token for this client and
//   person: revoking it, or a reuse that deletes the family, cuts off the access tokens too.
//   (Rotating a refresh token leaves its successor live, so ordinary refreshes are unaffected.)
export async function grantIsLive(clientId: string, userId: string, scopes: readonly string[], now = new Date()): Promise<boolean> {
  const consent = await prisma.oauthConsent.findFirst({ where: { clientId, userId }, select: { id: true } });
  if (!consent) return false;
  if (!scopes.includes("offline_access")) return true;
  const refresh = await prisma.oauthRefreshToken.findFirst({
    where: { clientId, userId, revoked: null, expiresAt: { gt: now } },
    select: { id: true },
  });
  return refresh !== null;
}
