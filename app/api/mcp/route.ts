import { handleMcpRequest } from "@/lib/mcp/handler";
import { preflight, withCors } from "@/lib/mcp/cors";

// The MCP server for outside AI assistants (lib/mcp). POST only: the transport is stateless, so
// there is no event stream (GET) or session to end (DELETE); Next.js answers those with 405.
export async function POST(request: Request) {
  return withCors(await handleMcpRequest(request));
}

export function OPTIONS() {
  return preflight("POST, OPTIONS");
}
