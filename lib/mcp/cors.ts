// CORS for the few routes a browser-based MCP client (such as the MCP Inspector) calls from its own
// site: the MCP endpoint, the two discovery documents, and the OAuth token and registration
// endpoints. Nowhere else: the rest of the app stays same-origin only.
//
// "*" without credentials is safe here: none of these routes reads cookies to decide anything
// (the MCP endpoint takes a bearer token, the others are public or authenticate the client
// itself), and browsers never send cookies on a "*" response.
export const MCP_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, DPoP, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID",
  "Access-Control-Expose-Headers": "WWW-Authenticate, DPoP-Nonce, Mcp-Protocol-Version, Mcp-Session-Id",
  "Access-Control-Max-Age": "86400",
};

// The OAuth endpoints under /api/auth that MCP clients call from a browser.
export const OAUTH_CORS_PATHS = new Set(["/api/auth/oauth2/token", "/api/auth/oauth2/register"]);

export function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(MCP_CORS_HEADERS)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

// The answer to a browser's preflight OPTIONS request.
export function preflight(methods: string): Response {
  return new Response(null, { status: 204, headers: { ...MCP_CORS_HEADERS, "Access-Control-Allow-Methods": methods } });
}
