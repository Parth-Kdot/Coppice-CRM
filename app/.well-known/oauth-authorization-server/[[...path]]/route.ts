import { notFound } from "next/navigation";
import { oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider";
import { auth } from "@/lib/auth";
import { MCP_CORS_HEADERS, preflight } from "@/lib/mcp/cors";

// RFC 8414 authorization server metadata, from Better Auth's OAuth provider. Our issuer is
// <site>/api/auth, so clients look for it at /.well-known/oauth-authorization-server/api/auth;
// older clients try the bare path, which gets the same document.
const metadata = oauthProviderAuthServerMetadata(auth, { headers: MCP_CORS_HEADERS });

export async function GET(request: Request, ctx: RouteContext<"/.well-known/oauth-authorization-server/[[...path]]">) {
  const { path = [] } = await ctx.params;
  if (path.length > 0 && path.join("/") !== "api/auth") notFound();
  return metadata(request);
}

export function OPTIONS() {
  return preflight("GET, OPTIONS");
}
