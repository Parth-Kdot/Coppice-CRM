// Security headers, in one place so they can be tested. proxy.ts sends the Content-Security-Policy
// (it needs a fresh nonce per request); next.config.ts sends the rest on every response.

type CspOptions = { nonce: string; isDev: boolean; isHttps: boolean };

// The Content-Security-Policy tells the browser what a page may load and run. The key line is
// script-src: only scripts carrying this request's random nonce may run (Next.js adds it to its
// own scripts automatically), and 'strict-dynamic' lets those scripts load the chunks they need.
// An injected <script> has no nonce, so it's blocked even if it somehow reached the page.
export function contentSecurityPolicy({ nonce, isDev, isHttps }: CspOptions): string {
  return [
    "default-src 'self'",
    // React needs eval in development only, to rebuild server error stacks in the browser.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Development tools inject unnonced styles; production styles come from files or carry the nonce.
    `style-src 'self' ${isDev ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // No other site may show BoilerPitch inside a frame (clickjacking).
    "frame-ancestors 'none'",
    // Only over HTTPS: on plain-HTTP localhost it would break loading our own files.
    ...(isHttps ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

// A new unpredictable value for every page request.
export function createNonce(): string {
  return Buffer.from(crypto.randomUUID()).toString("base64");
}

// Sent on every response, pages and API alike.
export const securityHeaders = [
  // Older browsers that don't understand frame-ancestors.
  { key: "X-Frame-Options", value: "DENY" },
  // Never guess a file's type; a text file can't be treated as a script.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Other sites see only our domain, not full URLs with workspace ids.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The app uses none of these, so nothing on the page may either.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  // Once a browser has seen the site over HTTPS, it refuses plain HTTP for two years.
  // Browsers ignore this header on http://localhost.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];
