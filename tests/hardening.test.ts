import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, test, vi } from "vitest";
import nextConfig from "@/next.config";
import { config as proxyConfig, proxy } from "@/proxy";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { contentSecurityPolicy, createNonce, securityHeaders } from "@/lib/security-headers";
import { notFound, redirect } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import { APIError } from "better-auth";
import { BUSY_MESSAGE, LAST_OWNER_MESSAGE, SAVE_FAILED_MESSAGE, failure } from "@/lib/action-failure";
import { AuthzError } from "@/lib/authz";
import { DEFAULT_POOL_MAX, poolMax } from "@/lib/db";
import * as limits from "@/lib/limits";
import {
  aiSettingsSchema,
  boardFiltersSchema,
  claimWindowSchema,
  companyFieldsSchema,
  contactFieldsSchema,
  createCompanySchema,
  createWorkspaceSchema,
  inviteMemberSchema,
  logOutreachSchema,
  memberSchema,
  templateFieldsSchema,
} from "@/lib/validation";
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

describe("failure(): what a server action returns when something goes wrong", () => {
  const known = (code: string) => new Prisma.PrismaClientKnownRequestError(`Prisma said ${code}`, { code, clientVersion: "7.10.1" });
  // What the pg driver adapter throws for a Postgres error Prisma has no code for.
  const driverError = (cause: Record<string, unknown>) => Object.assign(new Error("db said no"), { name: "DriverAdapterError", cause });

  test.each([
    ["P2024 (no pooled connection in time)", known("P2024")],
    ["P2028 (transaction timed out)", known("P2028")],
    ["P2034 (serialization failure)", known("P2034")],
    ["a driver error (serialization failure)", driverError({ kind: "postgres", code: "40001" })],
    ["a driver error (statement timeout)", driverError({ kind: "postgres", code: "57014" })],
    ["a driver error (connection lost)", driverError({ kind: "postgres", code: "08006" })],
    ["a driver error (too many connections)", driverError({ kind: "TooManyConnections" })],
    ["a driver error (a write conflict, as the adapter maps it)", driverError({ kind: "TransactionWriteConflict", originalCode: "40001" })],
    ["a busy error wrapped as the cause of another", Object.assign(new Error("outer"), { cause: known("P2024") })],
  ])("maps %s to the busy message instead of the error page", (_, error) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(failure(error, "testAction")).toEqual({ ok: false, error: BUSY_MESSAGE });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("testAction"), error);
    log.mockRestore();
  });

  // Trying again can't help these, so the message doesn't say to.
  test.each([
    ["a driver error (a NUL byte Postgres refused)", driverError({ kind: "postgres", code: "22021" })],
    ["a driver error (numeric overflow)", driverError({ kind: "postgres", code: "22003" })],
    ["a driver error wrapped as the cause of another", Object.assign(new Error("outer"), { cause: driverError({ kind: "postgres", code: "22003" }) })],
    ["a RangeError", new RangeError("Invalid time value")],
  ])("maps %s to a plain failure instead of the error page, not to busy", (_, error) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(failure(error, "testAction")).toEqual({ ok: false, error: SAVE_FAILED_MESSAGE });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("testAction"), error);
    log.mockRestore();
  });

  it("keeps the expected refusals as they were", () => {
    expect(failure(new AuthzError("Only the workspace owner can do that."))).toEqual({ ok: false, error: "Only the workspace owner can do that." });
    expect(failure(new APIError("BAD_REQUEST", { message: "You are not a member of this organization" }))).toEqual({
      ok: false,
      error: "You are not a member of this workspace",
    });
    expect(failure(new Error(`raise: ${LAST_OWNER_MESSAGE}`))).toEqual({ ok: false, error: LAST_OWNER_MESSAGE });
    // The trigger's message arriving inside a driver error is still the last-owner message, not "busy".
    expect(failure(driverError({ message: LAST_OWNER_MESSAGE }))).toEqual({ ok: false, error: LAST_OWNER_MESSAGE });
  });

  it("rethrows redirect() and notFound(), so Next can carry them out", () => {
    const thrown = (run: () => never) => {
      try {
        run();
      } catch (e) {
        return e;
      }
    };
    const toRedirect = thrown(() => redirect("/workspaces"));
    const toNotFound = thrown(() => notFound());
    expect(() => failure(toRedirect)).toThrow();
    expect(() => failure(toRedirect)).toThrow(expect.objectContaining({ digest: expect.stringContaining("/workspaces") }));
    expect(() => failure(toNotFound)).toThrow(expect.objectContaining({ digest: expect.stringContaining("404") }));
  });

  test.each([
    ["a plain bug", new TypeError("x is undefined")],
    ["a unique-constraint error (a real conflict, not busy)", known("P2002")],
  ])("still rethrows %s", (_, error) => {
    expect(() => failure(error)).toThrow(error);
  });
});

describe("the database pool size (lib/db.ts)", () => {
  it("defaults to a small pool per instance", () => {
    expect(poolMax({})).toBe(DEFAULT_POOL_MAX);
    expect(DEFAULT_POOL_MAX).toBe(5);
  });

  test.for([
    ["1", 1],
    ["12", 12],
    [" 20 ", 20],
  ] as const)("DATABASE_POOL_MAX=%j gives %i", ([raw, n]) => {
    expect(poolMax({ DATABASE_POOL_MAX: raw })).toBe(n);
  });

  test.for(["0", "51", "2.5", "lots"])("refuses DATABASE_POOL_MAX=%j at startup", (raw) => {
    expect(() => poolMax({ DATABASE_POOL_MAX: raw })).toThrow("DATABASE_POOL_MAX");
  });
});

describe("readable validation messages", () => {
  const message = (result: { success: boolean; error?: { issues: { message: string }[] } }) => result.error?.issues[0].message;

  it("a claim window of letters asks for a number of days", () => {
    expect(message(claimWindowSchema.safeParse({ workspaceId: "a", days: "abc" }))).toBe("Enter a number of days.");
  });

  it("an AI limit of letters asks for a number", () => {
    expect(message(aiSettingsSchema.safeParse({ workspaceId: "a", enabled: "on", limit: "abc" }))).toBe("Enter a number.");
  });

  it("an 81-character workspace name says how long it may be", () => {
    expect(message(createWorkspaceSchema.safeParse({ name: "x".repeat(81) }))).toBe("Keep the name to 80 characters or fewer.");
    expect(createWorkspaceSchema.safeParse({ name: "x".repeat(80) }).success).toBe(true);
  });

  it("more than 20 look-alikes kept apart reads as a sentence", () => {
    const ids = Array.from({ length: 21 }, (_, i) => `c${i}`).join(",");
    expect(message(createCompanySchema.safeParse({ workspaceId: "a", name: "Acme", industry: null, website: null, notes: null, separateFrom: ids }))).toBe(
      "Too many look-alikes to keep apart at once; save again.",
    );
  });

  const NUL = "This text has a character Coppice can't save.";
  test.each([
    ["a company name", () => companyFieldsSchema.safeParse({ name: "Ac\u0000me", industry: null, website: null, notes: null })],
    ["company notes", () => companyFieldsSchema.safeParse({ name: "Acme", industry: null, website: null, notes: "a\u0000b" })],
    ["an industry", () => companyFieldsSchema.safeParse({ name: "Acme", industry: "Te\u0000ch", website: null, notes: null })],
    ["a contact name", () => contactFieldsSchema.safeParse({ name: "Sam\u0000", email: null, title: null })],
    ["a template body", () => templateFieldsSchema.safeParse({ name: "Intro", body: "Hi\u0000" })],
    ["a workspace name", () => createWorkspaceSchema.safeParse({ name: "Org\u0000A" })],
    [
      "an outreach note",
      () => logOutreachSchema.safeParse({ workspaceId: "a", companyId: "c", channel: "EMAIL", note: "hi\u0000", followUpOn: "2026-12-01" }),
    ],
  ])("refuses a NUL character in %s, before it reaches Postgres", (_, parse) => {
    expect(message(parse())).toBe(NUL);
  });
});

describe("board URL search text", () => {
  it("cuts a search longer than 100 characters instead of dropping it", () => {
    const long = "acme ".repeat(40);
    const filters = boardFiltersSchema.parse({ q: long, industry: null, show: null, all: null, archived: null, dupes: null });
    expect(filters.q).toBe(long.trim().slice(0, 100).trim());
    expect(filters.q.length).toBeLessThanOrEqual(100);
  });

  it("cuts a long industry the same way", () => {
    const filters = boardFiltersSchema.parse({ q: null, industry: "x".repeat(500), show: null, all: null, archived: null, dupes: null });
    expect(filters.industry).toBe("x".repeat(limits.COMPANY_LIMITS.industry));
  });

  it("still drops something that isn't text", () => {
    const filters = boardFiltersSchema.parse({ q: ["a", "b"], industry: 5, show: null, all: null, archived: null, dupes: null });
    expect(filters).toMatchObject({ q: "", industry: "" });
  });
});

describe("lib/limits.ts stays free of zod and Prisma (it is bundled into the browser)", () => {
  it("imports nothing at all", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("lib/limits.ts", "utf8");
    expect(source).not.toMatch(/^\s*import\s/m);
  });

  it("matches what lib/validation re-exports", async () => {
    const validation = await import("@/lib/validation");
    for (const [name, value] of Object.entries(limits)) {
      expect(validation[name as keyof typeof validation], name).toBe(value);
    }
  });
});
