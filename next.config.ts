import type { NextConfig } from "next";
import { securityHeaders } from "./lib/security-headers";

const nextConfig: NextConfig = {
  // Don't advertise the framework in an X-Powered-By header.
  poweredByHeader: false,
  experimental: {
    // CSV import sends a file of up to 3 MB with each step (lib/validation.ts IMPORT_MAX_BYTES).
    // The default limit is 1 MB; Vercel's own request limit is 4.5 MB.
    serverActions: { bodySizeLimit: "4mb" },
  },
  async headers() {
    // The Content-Security-Policy is set per request in proxy.ts (it needs a fresh nonce).
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
