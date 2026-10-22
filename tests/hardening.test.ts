import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, test } from "vitest";
import nextConfig from "@/next.config";
import { config as proxyConfig, proxy } from "@/proxy";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { contentSecurityPolicy, createNonce, securityHeaders } from "@/lib/security-headers";
import { inviteMemberSchema, memberSchema } from "@/lib/validation";
import { resetAndSeed } from "./helpers/seed";

const directives = (policy: string) => Object.fromEntries(policy.split("; ").map((d) => [d.split(" ")[0], d]));

describe("Content-Security-Policy", () => {
  const production = directives(contentSecurityPolicy({ nonce: "abc123", isDev: false, isHttps: true }));

  it("in production, only scripts with this request's nonce may run", () => {
    expect(production["script-src"]).toBe("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(production["style-src"]).toBe("style-src 'self' 'nonce-abc123'");
  });

  it("in production, nothing allows inline code or eval", () => {
    const policy = contentSecurityPolicy({ nonce: "abc123", isDev: false, isHttps: true });
    expect(policy).not.toContain("unsafe-inline");
    expect(policy).not.toContain("unsafe-eval");
  });

  it.each([
    ["frame-ancestors", "frame-ancestors 'none'"],
    ["object-src", "object-src 'none'"],
    ["base-uri", "base-uri 'self'"],
    ["form-action", "form-action 'self'"],
    ["default-src", "default-src 'self'"],
  ])("sets %s", (name, value) => {
    expect(production[name]).toBe(value);
  });

  it("upgrades insecure requests only when served over HTTPS", () => {
    expect(production["upgrade-insecure-requests"]).toBeDefined();
    const local = directives(contentSecurityPolicy({ nonce: "n", isDev: false, isHttps: false }));
    expect(local["upgrade-insecure-requests"]).toBeUndefined();
  });

  it("loosens only what development tools need", () => {
    const dev = directives(contentSecurityPolicy({ nonce: "n", isDev: true, isHttps: false }));
    expect(dev["script-src"]).toBe("script-src 'self' 'nonce-n' 'strict-dynamic' 'unsafe-eval'");
    expect(dev["style-src"]).toBe("style-src 'self' 'unsafe-inline'");
    expect(dev["frame-ancestors"]).toBe("frame-ancestors 'none'");
  });

  it("nonces are unpredictable and never repeat", () => {
    const nonces = new Set(Array.from({ length: 1000 }, createNonce));
    expect(nonces.size).toBe(1000);
    for (const nonce of nonces) expect(nonce).toMatch(/^[A-Za-z0-9+/]{40,}={0,2}$/);
  });
});

describe("proxy.ts", () => {
  const run = (path: string) => proxy(new NextRequest(`http://localhost:3000${path}`));

  it("sends a policy with a fresh nonce on each page request", () => {
    const first = run("/workspaces").headers.get("Content-Security-Policy");
    const second = run("/workspaces").headers.get("Content-Security-Policy");
    expect(first).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
    expect(first).not.toBe(second);
  });

  it("passes the same policy to the page renderer, so Next.js stamps that nonce on its scripts", () => {
    const response = run("/workspaces");
    expect(response.headers.get("x-middleware-request-content-security-policy")).toBe(
      response.headers.get("Content-Security-Policy"),
    );
  });

  it("covers pages but skips the auth API and static files", () => {
    const pattern = new RegExp(`^${proxyConfig.matcher[0].source}$`);
    expect(pattern.test("/workspaces")).toBe(true);
    expect(pattern.test("/abc123/settings")).toBe(true);
    expect(pattern.test("/api/auth/get-session")).toBe(false);
    expect(pattern.test("/_next/static/chunks/app.js")).toBe(false);
  });
});

describe("headers on every response (next.config.ts)", () => {
  it("applies all security headers to every path and hides X-Powered-By", async () => {
    const rules = await nextConfig.headers!();
    expect(rules).toEqual([{ source: "/:path*", headers: securityHeaders }]);
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  it.each([
    ["X-Frame-Options", "DENY"],
    ["X-Content-Type-Options", "nosniff"],
    ["Referrer-Policy", "strict-origin-when-cross-origin"],
    ["Strict-Transport-Security", "max-age=63072000; includeSubDomains"],
  ])("includes %s: %s", (key, value) => {
    expect(securityHeaders).toContainEqual({ key, value });
  });

  it("switches off camera, microphone and location", () => {
    const policy = securityHeaders.find((h) => h.key === "Permissions-Policy")?.value;
    expect(policy).toContain("camera=()");
    expect(policy).toContain("microphone=()");
    expect(policy).toContain("geolocation=()");
  });
});

describe("rate limiting on /api/auth (stored in the database)", () => {
  const BASE = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
  // A random valid client address per test, so earlier runs' counts don't interfere. (It must be
  // a real IP: Better Auth ignores malformed addresses and falls back to one shared bucket.)
  const octet = () => Math.floor(Math.random() * 254) + 1;
  const ip = () => `10.${octet()}.${octet()}.${octet()}`;

  const signIn = (clientIp: string) =>
    auth.handler(
      new Request(`${BASE}/api/auth/sign-in/social`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": clientIp },
        body: JSON.stringify({ provider: "google", callbackURL: "/workspaces" }),
      }),
    );

  beforeEach(resetAndSeed);
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("allows 3 sign-in attempts per 10 seconds, then answers 429", async () => {
    const attacker = ip();
    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await signIn(attacker)).status);
    expect(statuses).toEqual([200, 200, 200, 429, 429]);
  });

  it("counts each client separately", async () => {
    const attacker = ip();
    for (let i = 0; i < 4; i++) await signIn(attacker);
    expect((await signIn(ip())).status).toBe(200);
  });

  it("keeps the count in the database, where every server instance can see it", async () => {
    const attacker = ip();
    await signIn(attacker);
    const rows = await prisma.rateLimit.findMany({ where: { key: { contains: attacker } } });
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(1);
  });
});

describe("input size caps", () => {
  test.for([
    ["a 64-character id is accepted", "x".repeat(64), true],
    ["a 65-character id is rejected", "x".repeat(65), false],
    ["a megabyte id is rejected", "x".repeat(1_000_000), false],
  ] as const)("%s", ([, memberId, ok]) => {
    expect(memberSchema.safeParse({ workspaceId: "a", memberId }).success).toBe(ok);
  });

  test.for([
    ["a normal email is accepted", "sam@purdue.edu", true],
    ["a 254-character email is accepted", `${"a".repeat(64)}@${"b".repeat(185)}.com`, true],
    ["a 255-character email is rejected", `${"a".repeat(64)}@${"b".repeat(186)}.com`, false],
  ] as const)("%s", ([, email, ok]) => {
    expect(inviteMemberSchema.safeParse({ workspaceId: "a", email, role: "member" }).success).toBe(ok);
  });
});
