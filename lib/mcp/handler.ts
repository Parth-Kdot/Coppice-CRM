import { requireMcpAuth } from "@better-auth/mcp";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { auth } from "@/lib/auth";
import { READ_SCOPE, WRITE_SCOPE, mcpResourceUrl } from "@/lib/mcp/config";
import { buildMcpServer } from "@/lib/mcp/server";
import type { McpPrincipal } from "@/lib/mcp/tools";

// POST /api/mcp, end to end:
// 1. requireMcpAuth (Better Auth's MCP plugin) checks the bearer token: signature against our own
//    keys, issuer, expiry, that it was issued for this MCP URL (the audience), and that it carries
//    coppice:read. Anything else gets a 401 or 403 with the WWW-Authenticate challenge MCP clients
//    use to start or step up sign-in. No token logic is written here.
// 2. The MCP SDK serves the request statelessly: a fresh server per request, nothing kept between
//    requests (no MCP sessions), so it works on Vercel's short-lived functions. Clients on the
//    current protocol (2026-07-28) are served directly; older clients (2025 protocol) get the SDK's
//    stateless fallback, which answers each POST on its own and refuses session GET/DELETE.
// 3. Each tool then checks membership and the workspace's MCP switch (lib/mcp/tools.ts).

const mcp = createMcpHandler(({ authInfo }) => buildMcpServer(principalFrom(authInfo?.extra)), {
  legacy: "stateless",
  // One JSON reply per request; nothing streams, so nothing is held open on the server.
  responseMode: "json",
  // Tool arguments are small; 64 KB is plenty and keeps a flood of large bodies cheap to refuse.
  maxRequestBodySize: 64 * 1024,
});

type Extra = { userId?: unknown; clientId?: unknown; scopes?: unknown } | undefined;
function principalFrom(extra: Extra): McpPrincipal {
  // Only ever set by the verified-token step below, so a missing value is a bug, not a client error.
  if (typeof extra?.userId !== "string" || typeof extra.clientId !== "string" || !Array.isArray(extra.scopes)) {
    throw new Error("MCP request reached the server without a verified token.");
  }
  return { userId: extra.userId, clientId: extra.clientId, scopes: new Set(extra.scopes as string[]) };
}

const unauthorized = () =>
  Response.json({ jsonrpc: "2.0", error: { code: -32001, message: "This token can't be used with Coppice." }, id: null }, { status: 401 });

export const handleMcpRequest = requireMcpAuth(
  auth,
  async (request, claims) => {
    // Assistant tokens always name the client they were issued to (azp) and the person (sub).
    // A session token signed with the same key has no azp, so it is refused here as well
    // (Better Auth 1.7.12 adds the same check inside requireMcpAuth).
    if (typeof claims.sub !== "string" || typeof claims.azp !== "string" || claims.sub === claims.azp) return unauthorized();
    const scopes = typeof claims.scope === "string" ? claims.scope.split(" ") : [];
    return mcp.fetch(request, {
      authInfo: {
        token: "",
        clientId: claims.azp,
        scopes,
        expiresAt: claims.exp,
        resource: new URL(mcpResourceUrl()),
        extra: { userId: claims.sub, clientId: claims.azp, scopes },
      },
    });
  },
  // Every call needs coppice:read; a client with no token is told to ask for read and write, and the
  // consent page shows the person exactly that.
  { resource: mcpResourceUrl(), requiredScopes: [READ_SCOPE], challengeScopes: [READ_SCOPE, WRITE_SCOPE] },
);
