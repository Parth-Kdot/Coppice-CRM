import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";
import { OAUTH_CORS_PATHS, preflight, withCors } from "@/lib/mcp/cors";
import { readCappedText, withBody } from "@/lib/mcp/body";
import { OAUTH_BODY_LIMIT, OAUTH_PATH_PREFIX, REGISTRATION_PATH } from "@/lib/mcp/oauth-limits";

// Every /api/auth/* request (Google redirect, callback, session, sign-out) goes to Better Auth.
const handlers = toNextJsHandler(auth);

export const { GET } = handlers;

// MCP clients that run in a browser call the OAuth token and registration endpoints from their own
// site, so those two answer with CORS headers (lib/mcp/cors.ts). Every other path is unchanged.
const needsCors = (request: Request) => OAUTH_CORS_PATHS.has(new URL(request.url).pathname);

// Every OAuth POST (registration, consent, token and the rest) has its body capped before Better
// Auth reads it (lib/mcp/oauth-limits.ts): registration needs no account and a refresh needs only a
// refresh token, and the plugin stores what they send.
async function boundedOAuthBody(request: Request): Promise<Request | Response> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith(OAUTH_PATH_PREFIX)) return request;
  const body = await readCappedText(request, OAUTH_BODY_LIMIT);
  if (body === null) {
    const error = path === REGISTRATION_PATH ? "invalid_client_metadata" : "invalid_request";
    return Response.json({ error, error_description: "The request is too large." }, { status: 413 });
  }
  return withBody(request, body);
}

export async function POST(request: Request) {
  const bounded = await boundedOAuthBody(request);
  const response = bounded instanceof Response ? bounded : await handlers.POST(bounded);
  return needsCors(request) ? withCors(response) : response;
}

export function OPTIONS(request: Request) {
  if (needsCors(request)) return preflight("POST, OPTIONS");
  return new Response(null, { status: 204, headers: { Allow: "GET, POST, OPTIONS" } });
}
