import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";
import { OAUTH_CORS_PATHS, preflight, withCors } from "@/lib/mcp/cors";

// Every /api/auth/* request (Google redirect, callback, session, sign-out) goes to Better Auth.
const handlers = toNextJsHandler(auth);

export const { GET } = handlers;

// MCP clients that run in a browser call the OAuth token and registration endpoints from their own
// site, so those two answer with CORS headers (lib/mcp/cors.ts). Every other path is unchanged.
const needsCors = (request: Request) => OAUTH_CORS_PATHS.has(new URL(request.url).pathname);

export async function POST(request: Request) {
  const response = await handlers.POST(request);
  return needsCors(request) ? withCors(response) : response;
}

export function OPTIONS(request: Request) {
  if (needsCors(request)) return preflight("POST, OPTIONS");
  return new Response(null, { status: 204, headers: { Allow: "GET, POST, OPTIONS" } });
}
