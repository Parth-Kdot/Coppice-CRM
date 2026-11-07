import { prisma } from "@/lib/db";
import { READ_SCOPE, WRITE_SCOPE } from "@/lib/mcp/config";
import { safeClientName } from "@/lib/mcp/oauth-limits";
import type { ActionResult } from "@/lib/validation";

// The assistants a person has connected (Settings > AI assistants), and Disconnect.
//
// A connection is the person's consent for one OAuth client plus the tokens issued to that client
// for them. It belongs to the person, not to a workspace: one assistant reaches every workspace the
// person is in that allows assistants. So only the person can see or end their own connections;
// every query below is scoped by their userId, which the caller takes from the signed-in session.
//
// Disconnect is hand-written on purpose: the plugin's own delete-consent removes only the consent
// row (its tokens stay until they expire) and /oauth2/revoke needs the client's own token, which
// Coppice never holds. Here the consent and every access and refresh token of that client for that
// person go in one transaction. The grant check on every MCP request (lib/mcp/grant.ts) then
// refuses the assistant's current access token on its very next call (the consent is gone), and a
// refresh fails (the refresh token is gone). Nothing here issues or signs a token. None of these
// tables holds workspace data, so there is no row-level security to set (no withTenant).

// The most a person sees; open registration means a careless or hostile setup could make many.
export const CONNECTIONS_SHOWN = 50;

export type Connection = {
  clientId: string;
  // Client-supplied: cleaned by safeClientName, and rendered inside <bdi> as text.
  name: string;
  // Where the assistant sends the person back after sign-in: the one thing it can't fake.
  returnsTo: string;
  canWrite: boolean;
  scopes: string[];
  allowedAt: Date;
  // When it last got a token (signed in or renewed its hourly access). Coppice doesn't record each
  // tool call per assistant, so this is the closest "last used" there is; null when not known.
  lastRenewedAt: Date | null;
};

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

// The same wording as the consent page: a host such as "example.com", or an app on this computer.
export function redirectLabel(redirectUris: readonly string[]): string {
  const first = redirectUris[0];
  if (!first) return "an unknown address";
  try {
    const url = new URL(first);
    if (LOCAL_HOSTS.has(url.hostname)) return "an app on this computer";
    return url.protocol === "https:" || url.protocol === "http:" ? url.host : `the app "${url.protocol.replace(/:$/, "")}"`;
  } catch {
    return "an unknown address";
  }
}

const latest = (a: Date | null | undefined, b: Date | null | undefined): Date | null => {
  if (!a) return b ?? null;
  if (!b) return a;
  return a > b ? a : b;
};

export async function listConnections(userId: string): Promise<Connection[]> {
  const consents = await prisma.oauthConsent.findMany({
    where: { userId },
    select: { clientId: true, scopes: true, createdAt: true, oauthclient: { select: { name: true, redirectUris: true } } },
    // The id breaks ties, so rows never swap places between renders.
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: CONNECTIONS_SHOWN,
  });
  if (consents.length === 0) return [];
  const clientIds = [...new Set(consents.map((c) => c.clientId))];
  // The newest token of each client for this person, one table after the other: Settings runs this
  // beside three other queries, and keeps to one connection per query.
  const refresh = await prisma.oauthRefreshToken.groupBy({ by: ["clientId"], where: { userId, clientId: { in: clientIds } }, _max: { createdAt: true } });
  const access = await prisma.oauthAccessToken.groupBy({ by: ["clientId"], where: { userId, clientId: { in: clientIds } }, _max: { createdAt: true } });
  const lastToken = new Map<string, Date | null>();
  for (const row of [...refresh, ...access]) lastToken.set(row.clientId, latest(lastToken.get(row.clientId), row._max.createdAt));

  // One row per client, even if the plugin kept more than one consent for it.
  const byClient = new Map<string, Connection>();
  for (const consent of consents) {
    const seen = byClient.get(consent.clientId);
    if (seen) {
      seen.scopes = [...new Set([...seen.scopes, ...consent.scopes])];
      seen.canWrite ||= consent.scopes.includes(WRITE_SCOPE);
      if (consent.createdAt < seen.allowedAt) seen.allowedAt = consent.createdAt;
      continue;
    }
    byClient.set(consent.clientId, {
      clientId: consent.clientId,
      name: safeClientName(consent.oauthclient.name) || "An unnamed app",
      returnsTo: redirectLabel(consent.oauthclient.redirectUris),
      canWrite: consent.scopes.includes(WRITE_SCOPE),
      scopes: consent.scopes,
      allowedAt: consent.createdAt,
      lastRenewedAt: lastToken.get(consent.clientId) ?? null,
    });
  }
  return [...byClient.values()];
}

// What a connection may do, in a few words for its row.
export function accessLabel(connection: Pick<Connection, "canWrite" | "scopes">): string {
  if (connection.canWrite) return "Can read and make changes";
  if (connection.scopes.includes(READ_SCOPE)) return "Can read";
  return "Can't read workspaces";
}

export const NOT_CONNECTED = "That assistant isn't connected any more.";

// Ends one assistant's access for this person: their consent for it and every access and refresh
// token it was issued for them, in one transaction. Other people's connections to the same
// assistant, and this person's other assistants, are untouched (every delete is scoped by both ids).
export async function disconnect(userId: string, clientId: string): Promise<ActionResult<{ consents: number; accessTokens: number; refreshTokens: number }>> {
  const where = { userId, clientId };
  const counts = await prisma.$transaction(async (tx) => {
    // The consent first: it is what the grant check reads, so from here the old access token is refused.
    const consents = await tx.oauthConsent.deleteMany({ where });
    // Access tokens before refresh tokens: an access token row can point at its refresh token.
    const accessTokens = await tx.oauthAccessToken.deleteMany({ where });
    const refreshTokens = await tx.oauthRefreshToken.deleteMany({ where });
    return { consents: consents.count, accessTokens: accessTokens.count, refreshTokens: refreshTokens.count };
  });
  if (counts.consents === 0 && counts.accessTokens === 0 && counts.refreshTokens === 0) return { ok: false, error: NOT_CONNECTED };
  return { ok: true, data: counts };
}
