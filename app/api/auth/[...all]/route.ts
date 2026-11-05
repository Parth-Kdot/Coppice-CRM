import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";
import { OAUTH_CORS_PATHS, preflight, withCors } from "@/lib/mcp/cors";
import { readCappedText, withBody } from "@/lib/mcp/body";
import { REGISTRATION_BODY_LIMIT, REGISTRATION_PATH } from "@/lib/mcp/registration";

// Every /api/auth/* request (Google redirect, callback, session, sign-out) goes to Better Auth.
const handlers = toNextJsHandler(auth);

export const { GET } = handlers;

// MCP clients that run in a browser call the OAuth token and registration endpoints from their own
// site, so those two answer with CORS headers (lib/mcp/cors.ts). Every other path is unchanged.
const needsCors = (request: Request) => OAUTH_CORS_PATHS.has(new URL(request.url).pathname);

// Open client registration needs no account, so its body is capped before Better Auth reads it
// (lib/mcp/registration.ts).
async function boundedRegistration(request: Request): Promise<Request | Response> {
  if (new URL(request.url).pathname !== REGISTRATION_PATH) return request;
  const body = await readCappedText(request, REGISTRATION_BODY_LIMIT);
  if (body === null) {
    return Response.json({ error: "invalid_client_metadata", error_description: "The registration is too large." }, { status: 413 });
  }
  return withBody(request, body);
}

export async function POST(request: Request) {
  const bounded = await boundedRegistration(request);
  const response = bounded instanceof Response ? bounded : await handlers.POST(bounded);
  return needsCors(request) ? withCors(response) : response;
}

export function OPTIONS(request: Request) {
  if (needsCors(request)) return preflight("POST, OPTIONS");
  return new Response(null, { status: 204, headers: { Allow: "GET, POST, OPTIONS" } });
}
