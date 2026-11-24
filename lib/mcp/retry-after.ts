import { OAUTH_PATH_PREFIX } from "@/lib/mcp/oauth-limits";

// After a failed or refused metadata document fetch, the plugin answers 429 for that client for 60
// seconds and sends no Retry-After. A 429 under /api/auth/oauth2/ that has none gets Retry-After: 60
// (app/api/auth/[...all]/route.ts, on GET and POST). A 429 that already has a Retry-After, any other
// status, and any path outside /api/auth/oauth2/ are returned as they are. Nothing else about the
// response changes. Better Auth's own rate limit answers on those paths have no Retry-After either,
// so they get the 60 too, which for the 10 second general window is longer than needed.
export function withRetryAfter(request: Request, response: Response): Response {
  if (response.status !== 429 || response.headers.has("retry-after")) return response;
  if (!new URL(request.url).pathname.startsWith(OAUTH_PATH_PREFIX)) return response;
  const headers = new Headers(response.headers);
  headers.set("Retry-After", "60");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
