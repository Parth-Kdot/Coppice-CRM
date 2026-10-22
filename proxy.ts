import { NextResponse, type NextRequest } from "next/server";
import { contentSecurityPolicy, createNonce } from "@/lib/security-headers";

// Runs before every page request (Next.js 16's replacement for middleware). It creates a fresh
// nonce and sends the Content-Security-Policy. Next.js reads the policy from the request headers
// and stamps the nonce onto every script it renders, which is why pages must render per request
// (app/layout.tsx makes sure of that).
export function proxy(request: NextRequest) {
  const policy = contentSecurityPolicy({
    nonce: createNonce(),
    isDev: process.env.NODE_ENV === "development",
    isHttps: request.nextUrl.protocol === "https:",
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("Content-Security-Policy", policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  matcher: [
    {
      // Pages only: not the auth API, static files, images or the favicon, which run no scripts.
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      // Link prefetches don't render a page, so they don't need a nonce.
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
