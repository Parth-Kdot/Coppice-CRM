import { auth } from "@/lib/auth";
import { preflight, withCors } from "@/lib/mcp/cors";

// RFC 9728 protected resource metadata: tells an MCP client that /api/mcp is protected and which
// authorization server (ours) issues its tokens. Served by Better Auth's MCP plugin, at both
// /.well-known/oauth-protected-resource and /.well-known/oauth-protected-resource/api/mcp; any
// other path is a 404 from the plugin.
export async function GET(request: Request) {
  return withCors(await auth.handler(request));
}

export function OPTIONS() {
  return preflight("GET, OPTIONS");
}
